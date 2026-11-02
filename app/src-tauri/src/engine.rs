//! Engine process lifecycle and the stdin/stdout JSON-lines bridge (AD-2, AD-14).
//!
//! Only this module spawns or kills the engine; JavaScript can only send a line
//! (`engine_send`) and receive lines (`engine-message` events). The bridge uses
//! `std::process`, not `tauri-plugin-shell`, so no spawn API is ever exposed to JS.
//! Restart and backoff arrive in Story 1.2; the release sidecar (`externalBin`) in Story 3.9.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};

pub const ENGINE_MESSAGE_EVENT: &str = "engine-message";

/// How long the engine gets to exit by itself after its stdin closes.
const EXIT_GRACE: Duration = Duration::from_secs(2);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct EngineState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    /// Last `ready` line, so a page that loads (or reloads) after the engine started still sees it.
    last_ready: Mutex<Option<String>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Development: run the engine from source with uv, validating every message against `protocol/`.
#[cfg(debug_assertions)]
fn engine_command() -> Option<Command> {
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|app| app.parent())
        .expect("app/src-tauri sits two levels below the repository root");
    let engine_dir = repo.join("engine");
    let mut cmd = Command::new("uv");
    cmd.arg("run")
        .arg("--project")
        .arg(&engine_dir)
        .arg("python")
        .arg("main.py")
        .current_dir(&engine_dir)
        .env("FB2_VALIDATE_PROTOCOL", "1");
    Some(cmd)
}

/// Release builds get the packaged sidecar in Story 3.9; until then there is no engine to start.
#[cfg(not(debug_assertions))]
fn engine_command() -> Option<Command> {
    None
}

pub fn spawn(app: &AppHandle) -> std::io::Result<()> {
    let Some(mut cmd) = engine_command() else {
        eprintln!("engine: no packaged engine in this build (Story 3.9)");
        return Ok(());
    };
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let state = app.state::<EngineState>();
    *lock(&state.stdin) = child.stdin.take();
    *lock(&state.child) = Some(child);

    let handle = app.clone();
    thread::Builder::new()
        .name("engine-reader".into())
        .spawn(move || read_lines(handle, stdout))?;
    Ok(())
}

/// Emits every engine stdout line to the UI as an `engine-message` event (payload: the raw JSON line).
fn read_lines(app: AppHandle, stdout: ChildStdout) {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buf)
                    .trim_end_matches(|c| c == '\r' || c == '\n')
                    .to_string();
                if line.is_empty() {
                    continue;
                }
                remember_if_ready(&app.state::<EngineState>().last_ready, &line);
                let _ = app.emit(ENGINE_MESSAGE_EVENT, line);
            }
        }
    }
}

/// Caches `line` if it is the engine's `ready` event.
fn remember_if_ready(cache: &Mutex<Option<String>>, line: &str) {
    if is_ready(line) {
        *lock(cache) = Some(line.to_string());
    }
}

fn is_ready(line: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(|t| t == "ready"))
        .unwrap_or(false)
}

/// Writes one protocol line to the engine's stdin.
#[tauri::command]
pub fn engine_send(state: State<'_, EngineState>, line: String) -> Result<(), String> {
    if line.contains('\n') || line.contains('\r') {
        return Err("a protocol message must be a single line".into());
    }
    let mut guard = lock(&state.stdin);
    let stdin = guard.as_mut().ok_or("engine is not running")?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

/// The engine's last `ready` line, if it has sent one.
#[tauri::command]
pub fn engine_ready(state: State<'_, EngineState>) -> Option<String> {
    lock(&state.last_ready).clone()
}

/// Closes the engine's stdin (it exits on EOF), waits briefly, then kills it if still running.
/// If a write to a hung engine holds the stdin lock, it kills at once instead of waiting on it.
pub fn shutdown(app: &AppHandle) {
    let state = app.state::<EngineState>();
    let stdin_closed = match state.stdin.try_lock() {
        Ok(mut guard) => {
            drop(guard.take());
            true
        }
        Err(TryLockError::Poisoned(poisoned)) => {
            drop(poisoned.into_inner().take());
            true
        }
        Err(TryLockError::WouldBlock) => false,
    };
    let Some(mut child) = lock(&state.child).take() else {
        return;
    };
    if stdin_closed {
        let deadline = Instant::now() + EXIT_GRACE;
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    const READY: &str = include_str!("../../../protocol/examples/ready.json");
    const PONG: &str = include_str!("../../../protocol/examples/pong.json");
    const ERROR: &str = include_str!("../../../protocol/examples/error-unknown-request.json");

    #[test]
    fn is_ready_only_for_the_ready_event() {
        assert!(is_ready(READY.trim()));
        assert!(!is_ready(PONG.trim()));
        assert!(!is_ready(ERROR.trim()));
        assert!(!is_ready("not json"));
        assert!(!is_ready(""));
    }

    #[test]
    fn last_ready_cache_keeps_only_ready_lines() {
        let cache = Mutex::new(None);
        remember_if_ready(&cache, PONG.trim());
        assert_eq!(*lock(&cache), None);
        remember_if_ready(&cache, READY.trim());
        remember_if_ready(&cache, ERROR.trim());
        remember_if_ready(&cache, "not json");
        assert_eq!(lock(&cache).as_deref(), Some(READY.trim()));
    }
}
