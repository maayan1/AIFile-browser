//! Engine process lifecycle and the stdin/stdout JSON-lines bridge (AD-2, AD-14, AD-16).
//!
//! Only this module spawns, restarts or kills the engine; JavaScript can only send a line
//! (`engine_send`), receive lines (`engine-message` events) and learn the engine's state
//! (`engine-state` events, `engine_state`). The bridge uses `std::process`, not
//! `tauri-plugin-shell`, so no spawn API is ever exposed to JS.
//!
//! The [`Supervisor`] runs one thread that owns the engine. Each engine *generation* lives in
//! its own Job Object (kill-on-close). After `ready` it pings every `ping_interval`; a failure is
//! an exit, a missed pong, no `ready` in time, or a spawn error. On a failure it clears the
//! cached `ready`, reports `restarting`, kills the whole job, waits until the job is empty and
//! respawns after an exponential backoff. After `max_failures` consecutive failures it reports
//! `stopped` and spawns no more. The release sidecar (`externalBin`) arrives in Story 3.9.

use std::io::{self, BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use crate::job::Job;

pub const ENGINE_MESSAGE_EVENT: &str = "engine-message";
pub const ENGINE_STATE_EVENT: &str = "engine-state";

/// Ids of the shell's own requests. Their replies are consumed here and never reach the UI.
const SHELL_ID_PREFIX: &str = "shell:";

/// The supervisor wakes at least this often to notice an engine that exited without EOF
/// (for example when a grandchild still holds its stdout).
const POLL: Duration = Duration::from_millis(100);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineStatus {
    Starting,
    Running,
    Restarting,
    Stopped,
}

impl EngineStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            EngineStatus::Starting => "starting",
            EngineStatus::Running => "running",
            EngineStatus::Restarting => "restarting",
            EngineStatus::Stopped => "stopped",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Timings {
    pub ping_interval: Duration,
    /// A pong must arrive within this time. The engine handles requests one at a time on its
    /// reader thread, so a ping waits behind the request before it: any handler that can take
    /// longer than a few seconds must run off that thread (AD-10), or it is killed as a hang.
    pub ping_timeout: Duration,
    pub ready_timeout: Duration,
    /// Backoff before respawn n (1-based) is `backoff_base × 2^(n-1)`.
    pub backoff_base: Duration,
    pub max_failures: u32,
    /// Running this long resets the consecutive-failure count.
    pub healthy_after: Duration,
    /// How long a killed job may take to become empty before the supervisor gives up.
    pub kill_wait: Duration,
    /// On app exit: how long the engine gets to exit by itself after its stdin closes.
    pub exit_grace: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Timings {
            ping_interval: Duration::from_secs(5),
            ping_timeout: Duration::from_secs(5),
            ready_timeout: Duration::from_secs(15),
            backoff_base: Duration::from_secs(1),
            max_failures: 5,
            healthy_after: Duration::from_secs(60),
            kill_wait: Duration::from_secs(10),
            exit_grace: Duration::from_secs(2),
        }
    }
}

/// Where the supervisor reports to. The app forwards to Tauri events; tests record.
pub trait EngineSink: Send + Sync + 'static {
    /// One engine stdout line for the UI (never a reply to a `shell:` request).
    fn message(&self, line: &str);
    /// The engine state changed.
    fn state(&self, state: EngineStatus);
}

/// Builds the command for one engine generation. The supervisor adds stdio and window flags.
pub type CommandFactory = Box<dyn Fn() -> io::Result<Command> + Send>;

struct Shared {
    state: Mutex<EngineStatus>,
    /// Last `ready` line of the current engine, so a page that loads late still sees it.
    last_ready: Mutex<Option<String>>,
    /// Queue to the current engine's stdin writer; `None` while no engine is running.
    writer: Mutex<Option<Sender<String>>>,
}

enum Msg {
    Line(u64, String),
    Eof(u64),
    Stop,
}

pub struct Supervisor {
    shared: Arc<Shared>,
    control: Mutex<Option<(Sender<Msg>, JoinHandle<()>)>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Supervisor {
    pub fn start(factory: CommandFactory, timings: Timings, sink: Arc<dyn EngineSink>) -> Supervisor {
        let shared = Arc::new(Shared {
            state: Mutex::new(EngineStatus::Starting),
            last_ready: Mutex::new(None),
            writer: Mutex::new(None),
        });
        let (tx, rx) = mpsc::channel();
        let worker = Worker {
            factory,
            timings,
            sink,
            shared: shared.clone(),
            tx: tx.clone(),
            rx,
            generation: 0,
            failures: 0,
        };
        let thread = thread::Builder::new()
            .name("engine-supervisor".into())
            .spawn(move || worker.run())
            .expect("the supervisor thread starts");
        Supervisor { shared, control: Mutex::new(Some((tx, thread))) }
    }

    /// Queues one protocol line for the engine's stdin. Fails while no engine is running.
    pub fn send(&self, line: &str) -> Result<(), String> {
        if line.contains('\n') || line.contains('\r') {
            return Err("a protocol message must be a single line".into());
        }
        lock(&self.shared.writer)
            .as_ref()
            .ok_or("engine is not running")?
            .send(line.to_string())
            .map_err(|_| "engine is not running".to_string())
    }

    pub fn last_ready(&self) -> Option<String> {
        lock(&self.shared.last_ready).clone()
    }

    pub fn state(&self) -> EngineStatus {
        *lock(&self.shared.state)
    }

    /// Closes the engine's stdin, gives it `exit_grace` to exit, then kills the whole job.
    /// Returns once no engine process is left. Safe to call more than once.
    pub fn stop(&self) {
        if let Some((tx, thread)) = lock(&self.control).take() {
            let _ = tx.send(Msg::Stop);
            let _ = thread.join();
        }
    }
}

enum Outcome {
    /// The app asked the supervisor to stop.
    Stop,
    /// The engine failed; the job is empty again.
    Failed,
    /// The killed job never became empty, so spawning again is unsafe.
    Stuck,
}

struct Worker {
    factory: CommandFactory,
    timings: Timings,
    sink: Arc<dyn EngineSink>,
    shared: Arc<Shared>,
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
    generation: u64,
    failures: u32,
}

impl Worker {
    fn run(mut self) {
        self.sink.state(EngineStatus::Starting);
        loop {
            match self.run_generation() {
                Outcome::Stop => return,
                Outcome::Stuck => return self.stay_stopped(),
                Outcome::Failed => {
                    self.failures += 1;
                    if self.failures >= self.timings.max_failures {
                        eprintln!("engine: {} failures in a row, giving up", self.failures);
                        return self.stay_stopped();
                    }
                    self.set_state(EngineStatus::Restarting);
                    let exponent = (self.failures - 1).min(16);
                    let backoff = self.timings.backoff_base.saturating_mul(1 << exponent);
                    if self.sleep(backoff) {
                        return;
                    }
                }
            }
        }
    }

    fn set_state(&self, state: EngineStatus) {
        let mut current = lock(&self.shared.state);
        if *current != state {
            *current = state;
            drop(current);
            self.sink.state(state);
        }
    }

    /// Reports `stopped` and spawns nothing more; returns when the app stops the supervisor.
    fn stay_stopped(self) {
        self.set_state(EngineStatus::Stopped);
        while let Ok(msg) = self.rx.recv() {
            if let Msg::Stop = msg {
                return;
            }
        }
    }

    /// Waits for `duration`, ignoring stale engine lines. Returns true if asked to stop.
    fn sleep(&self, duration: Duration) -> bool {
        let deadline = Instant::now() + duration;
        loop {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            match self.rx.recv_timeout(deadline - now) {
                Ok(Msg::Stop) => return true,
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return true,
            }
        }
    }

    /// Spawns one engine generation, watches it until it fails or the app stops, then tears it down.
    fn run_generation(&mut self) -> Outcome {
        self.generation += 1;
        let generation = self.generation;

        let job = match Job::new() {
            Ok(job) => job,
            Err(err) => {
                eprintln!("engine: could not create a job object: {err}");
                return Outcome::Failed;
            }
        };
        let mut child = match (self.factory)().and_then(spawn) {
            Ok(child) => child,
            Err(err) => {
                eprintln!("engine: could not start: {err}");
                return Outcome::Failed;
            }
        };
        // Known, accepted race: the child runs before it joins the job, so a child it starts in
        // that instant would escape. `uv` takes milliseconds before its first child, so this
        // does not happen in practice.
        if let Err(err) = job.assign(&child) {
            eprintln!("engine: could not put the engine in its job: {err}");
            let _ = child.kill();
            let _ = child.wait();
            return Outcome::Failed;
        }

        let stdout = child.stdout.take().expect("stdout is piped");
        let stdin = child.stdin.take().expect("stdin is piped");
        let lines = self.tx.clone();
        let reader = thread::Builder::new()
            .name(format!("engine-reader-{generation}"))
            .spawn(move || read_lines(generation, stdout, lines));
        let (writer_tx, writer_rx) = mpsc::channel();
        let writer = thread::Builder::new()
            .name(format!("engine-writer-{generation}"))
            .spawn(move || write_lines(stdin, writer_rx));
        let outcome = if let (Ok(_), Ok(_)) = (reader, writer) {
            *lock(&self.shared.writer) = Some(writer_tx);
            self.watch(generation, &mut child)
        } else {
            eprintln!("engine: could not start the engine's pipe threads");
            Outcome::Failed
        };

        // Teardown. Dropping the writer's queue closes the engine's stdin.
        *lock(&self.shared.writer) = None;
        if let Outcome::Stop = outcome {
            let deadline = Instant::now() + self.timings.exit_grace;
            while Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
                thread::sleep(Duration::from_millis(20));
            }
        } else {
            // Tell the UI before the kill (up to `kill_wait`), and drop the dead engine's `ready`
            // first so a late `engine_ready` can't return it.
            *lock(&self.shared.last_ready) = None;
            self.set_state(EngineStatus::Restarting);
        }
        let emptied = job.terminate_and_wait(self.timings.kill_wait);
        // Only wait on a child the job really killed; a survivor would block here forever.
        if emptied {
            let _ = child.wait();
        } else {
            let _ = child.try_wait();
        }
        *lock(&self.shared.last_ready) = None;
        match outcome {
            Outcome::Stop => Outcome::Stop,
            _ if !emptied => {
                eprintln!("engine: the old engine's processes did not exit; not starting another");
                Outcome::Stuck
            }
            other => other,
        }
    }

    /// Runs until the current engine fails (exit, missed pong, no `ready`) or the app stops.
    fn watch(&mut self, generation: u64, child: &mut Child) -> Outcome {
        let t = self.timings.clone();
        let ready_deadline = Instant::now() + t.ready_timeout;
        let mut ready_at: Option<Instant> = None;
        let mut next_ping = ready_deadline;
        let mut pending_ping: Option<(String, Instant)> = None;
        let mut ping_count = 0u64;
        let mut healthy = false;

        loop {
            let now = Instant::now();
            let mut wake = now + POLL;
            match ready_at {
                None => {
                    if now >= ready_deadline {
                        eprintln!("engine: no ready within {:?}", t.ready_timeout);
                        return Outcome::Failed;
                    }
                    wake = wake.min(ready_deadline);
                }
                Some(at) => {
                    if !healthy {
                        if now >= at + t.healthy_after {
                            healthy = true;
                            self.failures = 0;
                        } else {
                            wake = wake.min(at + t.healthy_after);
                        }
                    }
                    match &pending_ping {
                        Some((_, deadline)) if now >= *deadline => {
                            eprintln!("engine: no pong within {:?}", t.ping_timeout);
                            return Outcome::Failed;
                        }
                        Some((_, deadline)) => wake = wake.min(*deadline),
                        None if now >= next_ping => {
                            ping_count += 1;
                            let id = format!("{SHELL_ID_PREFIX}{generation}-{ping_count}");
                            if let Some(writer) = lock(&self.shared.writer).as_ref() {
                                let _ = writer.send(format!(r#"{{"id":"{id}","type":"ping"}}"#));
                            }
                            let deadline = now + t.ping_timeout;
                            pending_ping = Some((id, deadline));
                            wake = wake.min(deadline);
                        }
                        None => wake = wake.min(next_ping),
                    }
                }
            }

            match self.rx.recv_timeout(wake.saturating_duration_since(Instant::now())) {
                Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return Outcome::Stop,
                Ok(Msg::Eof(g)) if g == generation => {
                    eprintln!("engine: stdout closed");
                    return Outcome::Failed;
                }
                Ok(Msg::Line(g, line)) if g == generation => {
                    if let Some(id) = shell_reply_id(&line) {
                        if pending_ping.as_ref().is_some_and(|(sent, _)| *sent == id) {
                            pending_ping = None;
                            next_ping = Instant::now() + t.ping_interval;
                        }
                        continue;
                    }
                    if ready_at.is_none() && is_ready(&line) {
                        let now = Instant::now();
                        ready_at = Some(now);
                        next_ping = now + t.ping_interval;
                        remember_if_ready(&self.shared.last_ready, &line);
                        self.set_state(EngineStatus::Running);
                    } else {
                        remember_if_ready(&self.shared.last_ready, &line);
                    }
                    self.sink.message(&line);
                }
                // A line or EOF from an older, already killed generation.
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => {
                    if let Ok(Some(status)) = child.try_wait() {
                        eprintln!("engine: exited ({status})");
                        return Outcome::Failed;
                    }
                }
            }
        }
    }
}

fn spawn(mut cmd: Command) -> io::Result<Child> {
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
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

/// The app's engine command; a build without an engine counts as a spawn failure.
pub fn app_command_factory() -> CommandFactory {
    Box::new(|| {
        engine_command().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "no packaged engine in this build (Story 3.9)")
        })
    })
}

/// Sends every engine stdout line, tagged with its generation, to the supervisor; then EOF.
fn read_lines(generation: u64, stdout: ChildStdout, tx: Sender<Msg>) {
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
                if tx.send(Msg::Line(generation, line)).is_err() {
                    return;
                }
            }
        }
    }
    let _ = tx.send(Msg::Eof(generation));
}

/// Writes queued lines to the engine's stdin. A blocked write (hung engine) blocks only this
/// thread; it ends when the queue closes or the engine is killed.
fn write_lines(mut stdin: ChildStdin, rx: Receiver<String>) {
    for line in rx {
        let framed = format!("{line}\n");
        if stdin.write_all(framed.as_bytes()).and_then(|_| stdin.flush()).is_err() {
            return;
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

/// The id of a reply to one of the shell's own requests, if `line` is one.
fn shell_reply_id(line: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let id = value.get("id")?.as_str()?;
    id.starts_with(SHELL_ID_PREFIX).then(|| id.to_string())
}

/// Forwards supervisor reports to the UI as Tauri events.
pub struct TauriSink(pub AppHandle);

impl EngineSink for TauriSink {
    fn message(&self, line: &str) {
        let _ = self.0.emit(ENGINE_MESSAGE_EVENT, line);
    }
    fn state(&self, state: EngineStatus) {
        let _ = self.0.emit(ENGINE_STATE_EVENT, state.as_str());
    }
}

/// Writes one protocol line to the engine's stdin; fails while no engine is running.
#[tauri::command]
pub fn engine_send(supervisor: State<'_, Supervisor>, line: String) -> Result<(), String> {
    supervisor.send(&line)
}

/// The engine's last `ready` line, if the current engine has sent one.
#[tauri::command]
pub fn engine_ready(supervisor: State<'_, Supervisor>) -> Option<String> {
    supervisor.last_ready()
}

/// The current engine state, for a page that loads after the last `engine-state` event.
#[tauri::command]
pub fn engine_state(supervisor: State<'_, Supervisor>) -> &'static str {
    supervisor.state().as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::OnceLock;

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

    #[test]
    fn shell_reply_id_matches_only_shell_ids() {
        assert_eq!(shell_reply_id(r#"{"id":"shell:1-2","type":"pong"}"#).as_deref(), Some("shell:1-2"));
        assert_eq!(shell_reply_id(PONG.trim()), None);
        assert_eq!(shell_reply_id(READY.trim()), None);
        assert_eq!(shell_reply_id("not json"), None);
    }

    // ----- supervisor tests against tests/fixtures/fake_engine.py -----------------------------

    #[derive(Default)]
    struct Recorder {
        states: Mutex<Vec<EngineStatus>>,
        messages: Mutex<Vec<String>>,
    }

    impl EngineSink for Recorder {
        fn message(&self, line: &str) {
            lock(&self.messages).push(line.to_string());
        }
        fn state(&self, state: EngineStatus) {
            lock(&self.states).push(state);
        }
    }

    impl Recorder {
        fn states(&self) -> Vec<EngineStatus> {
            lock(&self.states).clone()
        }
        fn messages(&self) -> Vec<String> {
            lock(&self.messages).clone()
        }
    }

    use EngineStatus::{Restarting, Running, Starting, Stopped};

    fn python() -> &'static str {
        static PYTHON: OnceLock<String> = OnceLock::new();
        PYTHON.get_or_init(|| {
            let out = Command::new("uv")
                .args(["python", "find", "3.14"])
                .output()
                .expect("uv is on PATH");
            assert!(out.status.success(), "uv python find 3.14 failed");
            String::from_utf8(out.stdout).unwrap().trim().to_string()
        })
    }

    fn fake_engine() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_engine.py")
    }

    fn fake(args: &[&str]) -> Command {
        let mut cmd = Command::new(python());
        cmd.arg("-I").arg(fake_engine()).args(args);
        cmd
    }

    /// A factory whose n-th spawn (0-based) runs `modes[min(n, last)]`; also counts spawns.
    fn sequence(modes: Vec<Vec<String>>) -> (CommandFactory, Arc<AtomicUsize>) {
        let count = Arc::new(AtomicUsize::new(0));
        let counter = count.clone();
        let factory: CommandFactory = Box::new(move || {
            let n = counter.fetch_add(1, Ordering::SeqCst);
            let args = &modes[n.min(modes.len() - 1)];
            Ok(fake(&args.iter().map(String::as_str).collect::<Vec<_>>()))
        });
        (factory, count)
    }

    fn modes(list: &[&[&str]]) -> Vec<Vec<String>> {
        list.iter().map(|m| m.iter().map(|s| s.to_string()).collect()).collect()
    }

    fn fast() -> Timings {
        Timings {
            ping_interval: Duration::from_millis(50),
            ping_timeout: Duration::from_millis(1000),
            ready_timeout: Duration::from_secs(10),
            backoff_base: Duration::from_millis(10),
            max_failures: 5,
            healthy_after: Duration::from_secs(600),
            kill_wait: Duration::from_secs(5),
            exit_grace: Duration::from_millis(500),
        }
    }

    fn wait_for(what: &str, timeout: Duration, mut done: impl FnMut() -> bool) {
        let deadline = Instant::now() + timeout;
        while !done() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn start(factory: CommandFactory, timings: Timings) -> (Supervisor, Arc<Recorder>) {
        let recorder = Arc::new(Recorder::default());
        let supervisor = Supervisor::start(factory, timings, recorder.clone());
        (supervisor, recorder)
    }

    fn ready_count(recorder: &Recorder) -> usize {
        recorder.messages().iter().filter(|m| is_ready(m)).count()
    }

    #[test]
    fn healthy_engine_stays_running_and_shell_pongs_never_reach_the_ui() {
        let (factory, spawns) = sequence(modes(&[&["serve"]]));
        let (sup, rec) = start(factory, fast());
        wait_for("running", Duration::from_secs(10), || sup.state() == Running);
        // Many ping rounds, each well inside the pong timeout.
        thread::sleep(Duration::from_millis(1500));
        sup.send(r#"{"id":"u1","type":"ping"}"#).unwrap();
        wait_for("the UI's pong", Duration::from_secs(5), || {
            rec.messages().iter().any(|m| m.contains(r#""u1""#))
        });
        assert_eq!(rec.states(), vec![Starting, Running]);
        assert_eq!(spawns.load(Ordering::SeqCst), 1);
        assert!(rec.messages().iter().all(|m| !m.contains(SHELL_ID_PREFIX)));
        assert_eq!(sup.last_ready().as_deref(), Some(READY.trim()));
        sup.stop();
    }

    #[test]
    fn crash_kills_clears_ready_reports_restarting_and_respawns() {
        let (factory, spawns) = sequence(modes(&[&["crash-after-ready", "200"], &["serve"]]));
        let timings = Timings { backoff_base: Duration::from_millis(600), ..fast() };
        let (sup, rec) = start(factory, timings);
        wait_for("restarting", Duration::from_secs(10), || sup.state() == Restarting);
        // During the backoff: no cached ready and no engine to send to.
        assert_eq!(sup.last_ready(), None);
        assert!(sup.send(r#"{"id":"u1","type":"ping"}"#).is_err());
        wait_for("running again", Duration::from_secs(10), || sup.state() == Running);
        assert_eq!(rec.states(), vec![Starting, Running, Restarting, Running]);
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        assert_eq!(ready_count(&rec), 2);
        assert!(sup.last_ready().is_some());
        sup.stop();
    }

    #[test]
    fn hang_is_detected_by_a_missed_pong() {
        let (factory, spawns) = sequence(modes(&[&["hang-after-ready"], &["serve"]]));
        let timings = Timings { ping_timeout: Duration::from_millis(400), ..fast() };
        let (sup, rec) = start(factory, timings);
        wait_for("recovery", Duration::from_secs(10), || {
            rec.states() == vec![Starting, Running, Restarting, Running]
        });
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        sup.stop();
    }

    #[test]
    fn never_ready_counts_as_a_failure_until_give_up() {
        let (factory, spawns) = sequence(modes(&[&["never-ready"]]));
        let timings = Timings { ready_timeout: Duration::from_millis(300), max_failures: 2, ..fast() };
        let started = Instant::now();
        let (sup, rec) = start(factory, timings);
        wait_for("stopped", Duration::from_secs(10), || sup.state() == Stopped);
        assert!(started.elapsed() >= Duration::from_millis(600));
        assert_eq!(rec.states(), vec![Starting, Restarting, Stopped]);
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        assert!(rec.messages().is_empty());
        sup.stop();
    }

    #[test]
    fn give_up_after_max_failures_and_spawn_no_more() {
        let count = Arc::new(AtomicUsize::new(0));
        let counter = count.clone();
        let factory: CommandFactory = Box::new(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(Command::new("fb2-no-such-program-exists"))
        });
        let (sup, rec) = start(factory, Timings { max_failures: 3, ..fast() });
        wait_for("stopped", Duration::from_secs(10), || sup.state() == Stopped);
        thread::sleep(Duration::from_millis(300));
        assert_eq!(count.load(Ordering::SeqCst), 3);
        assert_eq!(rec.states(), vec![Starting, Restarting, Stopped]);
        assert_eq!(sup.send(r#"{"id":"u1","type":"ping"}"#), Err("engine is not running".into()));
        assert_eq!(sup.last_ready(), None);
        sup.stop();
    }

    #[test]
    fn running_for_healthy_after_resets_the_failure_count() {
        // Without the reset, the second failure would already reach max_failures = 2.
        let (factory, spawns) = sequence(modes(&[
            &["crash-after-ready", "100"],
            &["crash-after-ready", "900"],
            &["crash-after-ready", "100"],
        ]));
        let timings = Timings { max_failures: 2, healthy_after: Duration::from_millis(300), ..fast() };
        let (sup, _rec) = start(factory, timings);
        wait_for("stopped", Duration::from_secs(15), || sup.state() == Stopped);
        assert_eq!(spawns.load(Ordering::SeqCst), 3);
        sup.stop();
    }

    // ----- process helpers for the tree tests -------------------------------------------------

    mod process {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
        };

        pub fn is_running(pid: u32) -> bool {
            // SAFETY: the handle is checked and closed.
            unsafe {
                let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
                if handle.is_null() {
                    return false;
                }
                let running = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
                CloseHandle(handle);
                running
            }
        }

        /// What Task Manager's "End task" does to one process.
        pub fn kill(pid: u32) {
            // SAFETY: the handle is checked and closed.
            unsafe {
                let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
                assert!(!handle.is_null(), "could not open process {pid}");
                TerminateProcess(handle, 1);
                CloseHandle(handle);
            }
        }
    }

    /// True once `pid` no longer runs. The job's process count reaches 0 a few milliseconds
    /// before the killed process object is signaled, so allow a short settle time.
    fn gone(pid: u32) -> bool {
        let deadline = Instant::now() + Duration::from_secs(1);
        while process::is_running(pid) {
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(10));
        }
        true
    }

    fn read_pids(path: &std::path::Path) -> Option<(u32, u32)> {
        let text = std::fs::read_to_string(path).ok()?;
        let mut lines = text.lines().map(|l| l.trim().parse::<u32>());
        match (lines.next(), lines.next()) {
            (Some(Ok(engine)), Some(Ok(child))) => Some((engine, child)),
            _ => None,
        }
    }

    fn pid_file(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("fb2-{name}-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn restart_after_the_engine_is_killed_also_kills_its_grandchild() {
        let pids = pid_file("grandchild-restart");
        let path = pids.to_string_lossy().to_string();
        let (factory, spawns) = sequence(modes(&[&["grandchild", &path], &["serve"]]));
        let (sup, rec) = start(factory, fast());
        wait_for("running", Duration::from_secs(10), || sup.state() == Running);
        let (engine_pid, child_pid) = read_pids(&pids).expect("fake engine wrote its pids");
        assert!(process::is_running(child_pid));

        process::kill(engine_pid);
        wait_for("recovery", Duration::from_secs(10), || {
            rec.states() == vec![Starting, Running, Restarting, Running]
        });
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        assert!(gone(engine_pid));
        assert!(gone(child_pid), "the grandchild survived the restart");
        sup.stop();
        let _ = std::fs::remove_file(&pids);
    }

    #[test]
    fn stop_leaves_no_engine_process() {
        let pids = pid_file("grandchild-stop");
        let path = pids.to_string_lossy().to_string();
        let (factory, _spawns) = sequence(modes(&[&["grandchild", &path]]));
        let (sup, _rec) = start(factory, fast());
        wait_for("running", Duration::from_secs(10), || sup.state() == Running);
        let (engine_pid, child_pid) = read_pids(&pids).expect("fake engine wrote its pids");
        sup.stop();
        assert!(gone(engine_pid));
        assert!(gone(child_pid), "the grandchild survived app exit");
        assert!(sup.send(r#"{"id":"u1","type":"ping"}"#).is_err());
        sup.stop(); // a second stop is harmless
        let _ = std::fs::remove_file(&pids);
    }

    #[test]
    fn state_names_and_event_name_are_what_the_ui_expects() {
        assert_eq!(Starting.as_str(), "starting");
        assert_eq!(Running.as_str(), "running");
        assert_eq!(Restarting.as_str(), "restarting");
        assert_eq!(Stopped.as_str(), "stopped");
        assert_eq!(ENGINE_STATE_EVENT, "engine-state");
    }

    #[test]
    fn stop_during_the_backoff_returns_promptly_and_spawns_nothing() {
        let pids = pid_file("backoff-stop");
        let path = pids.to_string_lossy().to_string();
        let (factory, spawns) = sequence(modes(&[&["crash-after-ready", "200", &path], &["serve"]]));
        let (sup, _rec) = start(factory, Timings { backoff_base: Duration::from_secs(5), ..fast() });
        wait_for("restarting", Duration::from_secs(10), || sup.state() == Restarting);
        let engine_pid: u32 = std::fs::read_to_string(&pids).unwrap().trim().parse().unwrap();
        let stopping = Instant::now();
        sup.stop();
        assert!(stopping.elapsed() < Duration::from_secs(1), "stop waited out the backoff");
        assert_eq!(spawns.load(Ordering::SeqCst), 1);
        assert!(gone(engine_pid));
        let _ = std::fs::remove_file(&pids);
    }

    #[test]
    fn stop_lets_the_engine_exit_by_itself_when_stdin_closes() {
        let marker = pid_file("graceful-marker");
        let path = marker.to_string_lossy().to_string();
        let (factory, _spawns) = sequence(modes(&[&["serve-mark-on-eof", &path]]));
        let (sup, _rec) = start(factory, fast());
        wait_for("running", Duration::from_secs(10), || sup.state() == Running);
        sup.stop();
        assert!(marker.exists(), "the engine was killed before it saw stdin close");
        let _ = std::fs::remove_file(&marker);
    }

    #[test]
    fn lines_and_eof_from_an_older_generation_are_ignored() {
        let (factory, spawns) = sequence(modes(&[&["crash-after-ready", "200"], &["serve"]]));
        let (sup, rec) = start(factory, fast());
        wait_for("running again", Duration::from_secs(10), || {
            rec.states() == vec![Starting, Running, Restarting, Running]
        });
        let tx = lock(&sup.control).as_ref().expect("supervisor running").0.clone();
        tx.send(Msg::Eof(1)).unwrap();
        tx.send(Msg::Line(1, READY.trim().to_string())).unwrap();
        thread::sleep(Duration::from_millis(500));
        assert_eq!(sup.state(), Running);
        assert_eq!(rec.states(), vec![Starting, Running, Restarting, Running]);
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        assert_eq!(ready_count(&rec), 2, "a stale line reached the UI");
        sup.stop();
    }
}
