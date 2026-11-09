//! Opening a file in its Windows default app: the shell's only direct OS call (AD-4).
//!
//! The UI names an absolute path from a listing; the shell hands it to `ShellExecuteExW` with the
//! default verb, as a double-click in File Explorer does. The shell never reads the file. Windows'
//! own dialogs (no app for the type, a file that is gone) are the feedback on a failure; the shell
//! only logs it, and the UI shows nothing.

use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use crate::shell_log;

/// Opens `path` with its default app, on a worker thread: the call may wait on the shell (a
/// Windows dialog, a slow share) and must not hold up the window.
#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    let result = tauri::async_runtime::spawn_blocking(move || open_with(&path, shell_open))
        .await
        .unwrap_or_else(|err| Err(format!("the open worker failed: {err}")));
    if let Err(reason) = &result {
        shell_log::write(&format!("open: {reason}"));
    }
    result
}

/// Refuses anything but an absolute path to an item that isn't a folder, then calls `shell`.
/// A folder opens inside the app, never in File Explorer; a relative path would resolve against
/// the shell's working folder, and a URL is never opened at all (no network, NFR-1).
fn open_with(path: &str, shell: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    let target = Path::new(path);
    if path.contains('\0') || !target.is_absolute() {
        return Err(format!("refused a path that is not absolute: {path:?}"));
    }
    if std::fs::metadata(target).is_ok_and(|meta| meta.is_dir()) {
        return Err(format!("refused a folder: {path:?}"));
    }
    shell(target)
}

/// `ShellExecuteExW` with the default verb on a COM-initialized thread, as the Shell asks.
fn shell_open(path: &Path) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide = |text: &std::ffi::OsStr| -> Vec<u16> { text.encode_wide().chain(Some(0)).collect() };
    let file = wide(path.as_os_str());
    // The app starts in the file's folder, as from File Explorer; null when there is no parent.
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| wide(parent.as_os_str()));
    // Shell extensions behind the default verb may use COM. A pool thread that already joined
    // another apartment keeps it (the call fails), and then must not be uninitialized here.
    let flags = (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32;
    let initialized = unsafe { CoInitializeEx(std::ptr::null(), flags) } >= 0;
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        // The worker thread may end right after the call: finish any DDE conversation first.
        fMask: SEE_MASK_NOASYNC,
        lpFile: file.as_ptr(),
        lpDirectory: directory.as_ref().map_or(std::ptr::null(), |dir| dir.as_ptr()),
        nShow: SW_SHOWNORMAL,
        ..Default::default() // lpVerb null: the default verb
    };
    let opened = unsafe { ShellExecuteExW(&mut info) } != 0;
    let error = if opened { 0 } else { unsafe { GetLastError() } };
    if initialized {
        unsafe { CoUninitialize() };
    }
    if opened {
        Ok(())
    } else {
        Err(format!("ShellExecuteExW failed (error {error}) for {}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    /// `open_with` with a shell stand-in that records what it was asked to open.
    fn open_recorded(path: &str) -> (Result<(), String>, Vec<PathBuf>) {
        let calls = RefCell::new(Vec::new());
        let result = open_with(path, |target| {
            calls.borrow_mut().push(target.to_path_buf());
            Ok(())
        });
        (result, calls.into_inner())
    }

    #[test]
    fn relative_and_drive_relative_paths_are_refused_without_calling_the_shell() {
        for path in ["report.pdf", r"docs\report.pdf", r"C:report.pdf", r"\report.pdf", "", "https://example.com/a.pdf"] {
            let (result, calls) = open_recorded(path);
            assert!(result.is_err(), "{path:?} was not refused");
            assert!(calls.is_empty(), "{path:?} reached the shell");
        }
    }

    #[test]
    fn a_path_with_a_nul_is_refused_without_calling_the_shell() {
        let file = std::env::temp_dir().join(format!("fb2-open-nul-{}.txt", std::process::id()));
        let (result, calls) = open_recorded(&format!("{}\0.exe", file.display()));
        assert!(result.is_err());
        assert!(calls.is_empty());
    }

    #[test]
    fn a_folder_is_refused_without_calling_the_shell() {
        let dir = std::env::temp_dir().join(format!("fb2-open-folder-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (result, calls) = open_recorded(&dir.to_string_lossy());
        assert!(result.unwrap_err().contains("folder"));
        assert!(calls.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_absolute_file_path_goes_to_the_shell_as_is() {
        let dir = std::env::temp_dir().join(format!("fb2-open-file-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("סיכום ישיבה 3.docx");
        std::fs::write(&file, b"").unwrap();
        let (result, calls) = open_recorded(&file.to_string_lossy());
        assert_eq!(result, Ok(()));
        assert_eq!(calls, vec![file.clone()]);
        // A file that is gone still goes to the shell: Windows' own dialog says so.
        let gone = dir.join("gone.pdf");
        let (result, calls) = open_recorded(&gone.to_string_lossy());
        assert_eq!(result, Ok(()));
        assert_eq!(calls, vec![gone]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_shell_failure_is_passed_back() {
        let result = open_with(r"C:\gone\report.pdf", |_| Err("no".to_string()));
        assert_eq!(result, Err("no".to_string()));
    }

    /// The command's name and argument come from protocol/ipc.json, like engine.rs's commands.
    #[test]
    fn ipc_names_match_protocol_ipc_json() {
        let ipc: serde_json::Value =
            serde_json::from_str(include_str!("../../../protocol/ipc.json")).expect("ipc.json is JSON");
        let text = |pointer: &str| ipc.pointer(pointer).and_then(|v| v.as_str()).expect(pointer).to_string();
        let name = text("/commands/openFile");
        let source = include_str!("open.rs").replace("\r\n", "\n");
        let main = include_str!("main.rs");
        let signature = format!("#[tauri::command]\npub async fn {name}(");
        assert!(source.contains(&signature), "no #[tauri::command] async fn {name} in open.rs");
        assert!(main.contains(&format!("open::{name}")), "{name} is not registered in main.rs");
        let after = source.split(&format!("pub async fn {name}(")).nth(1).expect("open command");
        let params = &after[..after.find(')').expect("parameter list")];
        let argument = text("/openFileArgument");
        assert_eq!(params, format!("{argument}: String"), "{name} must take exactly `{argument}: String`");
    }
}
