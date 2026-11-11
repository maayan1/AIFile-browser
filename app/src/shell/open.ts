// Opening a file in its Windows default app: a call to the Rust shell, never to the OS or to a
// shell/opener plugin (AD-4). The UI only names the file; it never reads it. On a failure Windows
// shows its own dialog, and the shell logs it.
import { invoke } from "@tauri-apps/api/core";

/** The shell command and its argument name (protocol/ipc.json). */
export const OPEN_FILE_COMMAND = "open_file";

/** Asks the shell to open `path` (absolute, a file) with its default app. */
export function openFile(path: string): Promise<void> {
  return invoke<void>(OPEN_FILE_COMMAND, { path });
}
