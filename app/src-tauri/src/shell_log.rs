//! The shell's own log file, `shell.log`, next to the engine's `engine.log`.
//!
//! Release builds have no console (`windows_subsystem = "windows"`), so the supervisor's
//! diagnostics and the engine's stderr would otherwise be lost. Every line also goes to stderr,
//! so `tauri dev` still shows it. Rotation matches the engine log: 1 MB, 3 backups
//! (`shell.log.1` is the newest backup).

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 1_000_000;
const BACKUPS: u32 = 3;

static LOG: OnceLock<Mutex<Log>> = OnceLock::new();

/// The log folder, by the same rule as the engine's `engine/main.py::log_dir`.
pub fn log_dir() -> PathBuf {
    let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    if let Some(dir) = var("FB2_LOG_DIR") {
        return PathBuf::from(dir);
    }
    let local = var("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| var("USERPROFILE").map(|home| PathBuf::from(home).join("AppData").join("Local")))
        .unwrap_or_default();
    local.join("FileBrowser2").join("logs")
}

/// Starts writing to `dir/shell.log`. Until this succeeds, lines go to stderr only.
pub fn init(dir: &Path) -> io::Result<()> {
    let log = Log::open(dir, MAX_BYTES, BACKUPS)?;
    let _ = LOG.set(Mutex::new(log));
    Ok(())
}

/// Writes one line to stderr and, once [`init`] has run, to the log file. Never fails.
pub fn write(message: &str) {
    eprintln!("{message}");
    if let Some(log) = LOG.get() {
        log.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).write_line(message);
    }
}

struct Log {
    path: PathBuf,
    file: File,
    size: u64,
    max_bytes: u64,
    backups: u32,
}

impl Log {
    fn open(dir: &Path, max_bytes: u64, backups: u32) -> io::Result<Log> {
        fs::create_dir_all(dir)?;
        let path = dir.join("shell.log");
        let file = append(&path)?;
        let size = file.metadata()?.len();
        Ok(Log { path, file, size, max_bytes, backups })
    }

    fn write_line(&mut self, message: &str) {
        let line = format!("{} {message}\n", timestamp(SystemTime::now()));
        if self.size > 0 && self.size + line.len() as u64 > self.max_bytes {
            self.rotate();
        }
        if self.file.write_all(line.as_bytes()).is_ok() {
            self.size += line.len() as u64;
        }
    }

    /// shell.log → shell.log.1 → … → shell.log.{backups}; the oldest is overwritten.
    /// On failure it keeps appending to the current file rather than lose lines.
    fn rotate(&mut self) {
        for n in (1..self.backups).rev() {
            let _ = fs::rename(backup(&self.path, n), backup(&self.path, n + 1));
        }
        if fs::rename(&self.path, backup(&self.path, 1)).is_err() {
            return;
        }
        if let Ok(file) = append(&self.path) {
            self.file = file;
            self.size = 0;
        }
    }
}

fn append(path: &Path) -> io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

fn backup(path: &Path, n: u32) -> PathBuf {
    let mut name = OsString::from(path.as_os_str());
    name.push(format!(".{n}"));
    PathBuf::from(name)
}

/// UTC, ISO 8601 with milliseconds, e.g. `2026-11-09T14:03:07.250Z`.
fn timestamp(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs() as i64;
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    let of_day = secs.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        of_day / 3600,
        of_day % 3600 / 60,
        of_day % 60,
        since.subsec_millis()
    )
}

/// Days since 1970-01-01 to (year, month, day); Howard Hinnant's `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fb2-shell-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn timestamps_are_utc_iso_8601_with_milliseconds() {
        assert_eq!(timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let t = UNIX_EPOCH + Duration::from_millis(1_700_000_000_123);
        assert_eq!(timestamp(t), "2023-11-14T22:13:20.123Z");
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400); // 2000-02-29
        assert_eq!(&timestamp(leap)[..10], "2000-02-29");
    }

    #[test]
    fn appends_timestamped_lines_and_creates_the_folder() {
        let dir = temp_dir("append");
        let mut log = Log::open(&dir.join("logs"), MAX_BYTES, BACKUPS).unwrap();
        log.write_line("engine: could not start: not found");
        log.write_line("engine: exited (exit code: 1)");
        let text = fs::read_to_string(dir.join("logs").join("shell.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("Z engine: could not start: not found"), "{}", lines[0]);
        assert!(lines[1].ends_with(" engine: exited (exit code: 1)"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotates_at_the_size_limit_and_keeps_only_the_backups() {
        let dir = temp_dir("rotate");
        // Each line is 24 (timestamp) + 1 + 5 + 1 = 31 bytes, so a 40-byte limit rotates every line.
        let mut log = Log::open(&dir, 40, 2).unwrap();
        for n in 0..5 {
            log.write_line(&format!("line{n}"));
        }
        let read = |name: &str| fs::read_to_string(dir.join(name)).unwrap();
        assert!(read("shell.log").ends_with("line4\n"));
        assert!(read("shell.log.1").ends_with("line3\n"));
        assert!(read("shell.log.2").ends_with("line2\n"));
        assert!(!dir.join("shell.log.3").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reopening_continues_the_existing_file() {
        let dir = temp_dir("reopen");
        Log::open(&dir, MAX_BYTES, BACKUPS).unwrap().write_line("first run");
        Log::open(&dir, MAX_BYTES, BACKUPS).unwrap().write_line("second run");
        let text = fs::read_to_string(dir.join("shell.log")).unwrap();
        assert_eq!(text.lines().count(), 2);
        let _ = fs::remove_dir_all(&dir);
    }
}
