---
title: 'Story 1.6: Open a file and show it in its folder'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1901fb4565aa202d9aa2b9dc48c9ed57930d764b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Files in the browse list do nothing: Yossi can't open one in its usual program, there is no context menu, and nothing can jump to a file's folder, which search results need from Story 2.2.

**Approach:** Double-click or Enter on a file asks the Rust shell to open it with Windows' default app (the shell's only direct OS call, AD-4). A context menu on every row offers only "Open" and "Show in folder". "Show in folder" is in-app: a new `showInFolder {path}` request on the `listFolder` channel lets the engine resolve the item, list its folder and name the item to select; the UI shows that folder with the item selected.

## Boundaries & Constraints

**Always:**
- The UI never reads a file. `open_file` in Rust takes an absolute path, refuses a folder or a relative path, and calls `ShellExecuteExW` with the default verb, on a worker thread with COM initialized. Windows' own dialogs (no app associated, file gone) are the failure feedback; the shell logs the failure and the UI shows nothing.
- The engine owns path rules: it normalizes the `showInFolder` path (AD-9), finds the item's on-disk name in its folder, and sends `selected` only when that name is among the listed entries. The UI builds no path besides `childPath`.
- `showInFolder` shares the `listFolder` channel, so either one cancels the other (latest wins). Its reply is a normal `folderListing` with an optional `selected`; history moves as for any open (a push, nothing when the folder is already current).
- The context menu: `role="menu"`, two `menuitem`s, first item focused on open, ↑/↓ move, Enter/click runs, Esc or a click outside closes and returns focus to the row. Opens at the pointer for a right-click and at the row for Shift+F10 or the Menu key; the row is selected first. Popover look (radius 8, border, shadow). Positioned with logical properties only. Words from the catalog.
- Ctrl+Shift+E on the selected row runs Show in folder.

**Never:** No other menu items, no write/move/delete/rename anywhere (C-4, NFR-8). No global shortcut handling or ↑/↓ row movement (1.8). No new npm or crate dependencies (new `windows-sys` features are fine). No JS permission for shell/opener plugins.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open a file | double-click, Enter, or menu "Open" on `report.pdf` | `open_file("…\\report.pdf")`; list unchanged | Windows' dialog; logged |
| Open a folder | same on a folder row | in-app navigation, as in 1.5 | as in 1.5 |
| Show in folder, other folder | `showInFolder("d:\\work\\Report.PDF")` | `D:\Work` listed, `Report.pdf` selected and scrolled into view, pushed on history | N/A |
| Show in folder, same folder | menu or Ctrl+Shift+E on a row | same folder re-listed, that row selected, no history entry | N/A |
| Item gone | file deleted, folder exists | folder listed, nothing selected | N/A |
| Folder gone or denied | parent missing / unreadable | error state as for a failed open (codes and place as in 1.5) | `folderNotFound` / `accessDenied` / `folderUnavailable` |
| Root | `showInFolder("C:\\")` | `folderNotFound` | as above |

</frozen-after-approval>

## Code Map

- `app/src-tauri/src/main.rs`, new `app/src-tauri/src/open.rs` -- `#[tauri::command] pub async fn open_file(path: String) -> Result<(), String>`; work in `tauri::async_runtime::spawn_blocking`: `CoInitializeEx(APARTMENTTHREADED | DISABLE_OLE1DDE)`, `ShellExecuteExW` (`SEE_MASK_NOASYNC`, `lpVerb` null, `SW_SHOWNORMAL`), `CoUninitialize`; log failures via `shell_log::write`. Register in `generate_handler!`.
- `app/src-tauri/Cargo.toml` -- add `windows-sys` features `Win32_UI_Shell`, `Win32_System_Com`, `Win32_UI_WindowsAndMessaging`.
- `protocol/ipc.json` -- add `commands.openFile: "open_file"`, `openFileArgument: "path"`. Extend `engine.rs`'s `ipc_names_match_protocol_ipc_json` (or a sibling test in `open.rs`) and `app/src/protocol/transport.test.ts` the same way as `send`.
- `protocol/schemas/` -- new `showInFolder.schema.json` (`{id, type, path}`, path required); `folderListing.schema.json` gains optional `selected` (string, the item's name). Examples `show-in-folder.json`, `folder-listing-selected.json`. TS types regenerate from schemas (`npm run gen:protocol`).
- `engine/core/ports/filesystem.py`, `engine/adapters/windows_fs.py` -- new `locate(path) -> tuple[str, str | None]`: normalize like `resolve` (share its code: split `resolve` into a private walk returning the resolved path and attributes), resolve the parent as a folder, then `_find` the last segment for its on-disk name; `None` when not found (ERROR_FILE_NOT_FOUND); a root raises `FileNotFoundError`.
- `engine/core/browse.py` -- `show_in_folder(fs, path, token)`: `folder, name = fs.locate(path)`, `list_folder(fs, folder, token)`, add `selected` when a listed entry has that name. Reuse `FolderUnreadable`.
- `engine/main.py` -- `show_in_folder_handler` with the same error mapping as `list_folder_handler` (factor the shared try/except); `register_channel("showInFolder", "listFolder", …)`.
- `app/src/browse/session.ts` -- `BrowseActions` gains `openFile(path)` and `showInFolder(path)`; `go()` takes the request to send; constructor takes an `openFile` function (default: `invoke(ipc openFile)` in a new `app/src/shell/open.ts`), errors logged with `console.error`.
- `app/src/browse/BrowseList.tsx` -- `selected` falls back to `listing.selected` until the user selects in that listing; scroll the selected row into view and focus it when it came from `listing.selected`. Rows: file double-click/Enter → `openFile`; `onContextMenu`, Shift+F10, `ContextMenu` key → menu; Ctrl+Shift+E → `showInFolder`. New `app/src/browse/RowMenu.tsx`.
- `app/src/components/shell/panes.tsx` `MainArea` -- pass the whole `actions` to `BrowseList`.
- `app/src/i18n/catalog.ts` -- `menu.label` ("File actions"), `menu.open` ("Open"), `menu.showInFolder` ("Show in folder").
- Reuse the Breadcrumb error popover's classes (`rounded-lg border bg-popover … shadow-md`). Style rules (`style-rules.test.ts`) forbid `left`/`right` even in inline styles: use `insetInlineStart` (in RTL, `innerWidth - clientX`) and `top`.

## Tasks & Acceptance

**Execution:**
- [x] `protocol/` -- schemas, examples, `ipc.json` as in the Code Map.
- [x] `engine/core/ports/filesystem.py`, `engine/adapters/windows_fs.py`, `engine/core/browse.py`, `engine/main.py` -- `locate`, `show_in_folder`, handler and registration.
- [x] `engine/tests/` -- adapter `locate` (casing, missing item, a folder item, root, invalid/relative); core `show_in_folder` with a fake port (selected, item gone, hidden item not selected, unreadable folder carries place); roundtrip: `showInFolder` reply validates, and a `showInFolder` cancels a running `listFolder`.
- [x] `app/src-tauri/` -- `open.rs`, registration, features; tests: relative path and folder refused without calling the shell, ipc contract.
- [x] `app/src/shell/open.ts`, `session.ts`, `BrowseList.tsx`, `RowMenu.tsx`, `panes.tsx`, `catalog.ts` -- as in the Code Map.
- [x] `app/src/**/*.test.ts(x)` -- session (`showInFolder` sends the request, commits history, keeps `selected`; `openFile` calls the opener only); BrowseList (file double-click/Enter opens the file, folder still navigates; `listing.selected` shows selected; Ctrl+Shift+E); RowMenu (right-click and Shift+F10/Menu key open it with exactly two items, ↑/↓, Enter, Esc returns focus); an App-level test: `showInFolder` for a file in another folder ends with that folder shown and the file's row `aria-selected`.

**Acceptance Criteria:**
- Given `tauri dev`, when I double-click a `.txt` file, then it opens in Notepad (or the default app) and the app keeps its folder.
- Given `tauri dev`, when I right-click a file, press Shift+F10, or press Ctrl+Shift+E, then the menu shows only "Open" and "Show in folder", and Show in folder selects the file.
- Given `npm test`, `npm run typecheck`, `uv run pytest` and `cargo test`, when run, then all pass.

## Implementation Notes

- Implemented by a fresh subagent from this spec. Engine: `resolve` split into `_split` (AD-9 normalization) and `_walk` (per-segment casing); `locate` reuses both and returns `(folder, on-disk name | None)`. `show_in_folder` lists that folder and sends `selected` only when an entry has that name. `main.py` shares one `folder_handler` error mapping; `showInFolder` is registered on the `listFolder` channel.
- Rust: `open.rs` `open_file` (async; `spawn_blocking`; COM STA; `ShellExecuteExW`, default verb, `SEE_MASK_NOASYNC`). It refuses relative, drive-relative, NUL-containing and folder paths. `windows-sys` also needs `Win32_System_Registry`, because `SHELLEXECUTEINFOW` holds an HKEY.
- UI: `shell/open.ts`; `BrowseSession.openFile` / `showInFolder`; rows open files in their default app and folders in the app; new `RowMenu.tsx`; a `listing.selected` row is selected, scrolled into view and focused until the user selects another.
- Surprise: `MainArea`'s scroll-to-top became a layout effect. As a passive effect it ran after the list's (child effects run first) and undid the scroll to the Show in folder row.
- Choices: besides Esc and a click outside, the menu also closes on Tab, scroll, resize and window blur. A keyboard-made `contextmenu` event (button 0) opens at the row, so a double event from WebView2 lands in the same place.
- Verified 2026-11-09 (before review): `uv run pytest` 200, `npm test` 200, `npm run typecheck` clean, `cargo test` 28. Not yet checked under `tauri dev`.

## Spec Change Log

## Review Triage Log

- 2026-11-09, review 1 (blind-hunter, edge-case-hunter, verification-gap):
- `medium` patched — a showInFolder error without a place committed the item's file path as the location and history entry, so Back/reload listed a file. It now keeps the current location. (edge-case-hunter, verification-gap)
- `low` patched — a held Enter or Ctrl+Shift+E auto-repeats and launches the app once per repeat; repeats are ignored. (edge-case-hunter, blind-hunter)
- `low` patched — nothing pinned the scroll-to-top-before-scrollIntoView order; reverting the layout effect passed every test. New MainArea test. (verification-gap)
- `low` patched — the `locate` traverse-only (ERROR_ACCESS_DENIED) branch was untested. New roundtrip test. (verification-gap, blind-hunter)
- `low` patched — `lpDirectory` was null, so the launched app started in the shell's working folder instead of the file's folder. (blind-hunter)
- `low` patched — `capabilities/default.json` still said no launching permission reaches JavaScript; it now names `open_file`. (blind-hunter)
- `low` patched — the RowMenu comment said the menu flips toward the pointer, but it only clamps; comment corrected, and closing on Tab and blur is now tested. (blind-hunter)
- `low` patched — `typing.Callable` changed to `collections.abc.Callable`. (blind-hunter)
- `maybe-false` deferred (medium if true) — with `hwnd` null, Windows' Open With or error dialog may open behind the app. Settle under `tauri dev` by opening a file type with no associated app. (edge-case-hunter, blind-hunter)
- `low` rejected — if `metadata` fails on a folder, or for a `.lnk` to a folder, the path reaches `ShellExecuteExW` and File Explorer opens. The UI sends folders to in-app navigation, never to `open_file`; resolving shortcuts adds a code path. (edge-case-hunter, blind-hunter)
- `low` rejected — `open_file` accepts device, UNC and executable paths from any script in the WebView. The WebView loads only the app's own bundle, and names render as text. UNC files are files the user browsed; executables open as File Explorer opens them. (edge-case-hunter, blind-hunter)
- `false` — "`metadata` reads the file": `std::fs::metadata` opens a handle with no data access to read attributes. No content is read and no placeholder is recalled; the launched app reads the file, as the user asked.
- `low` rejected — the shell's own refusals (folder, relative path) show nothing, while the comments speak of Windows' dialog. The UI never sends such paths.
- `low` rejected — a new listing (reload, engine restart) while the menu is open unmounts it without `onClose`, and focus drops to the body. This needs a restart while the menu is open; fixing it adds an effect.
- `low` rejected — a showInFolder reply can take focus from the path field. Unreachable in 1.6, because Show in folder starts only from the list; revisit when Story 2.2's result lists call it.
- `low` rejected — `fit` clamps rather than flips, so near the bottom a keyboard-opened menu covers its row. Cosmetic; flipping adds branches.
- `low` rejected — Shift+F10 or the Menu key may fire `onMenu` twice in WebView2. The second call opens at the same row position with the first item focused, so nothing visible changes.
- `low` rejected — ↑ with no item focused goes to the first item. The menu always opens with the first item focused.
- `false` — an injected opener that throws synchronously: the only opener is `invoke`, which returns a promise.
- `low` rejected — the menu lacks `aria-keyshortcuts`, `aria-haspopup` and Home/End. Story 1.8 owns keyboard and ARIA completeness.
- `low` rejected — `show_in_folder` walks the path twice (`locate`, then `resolve` in `list_folder`). This costs microseconds locally; passing the resolved folder through adds a parameter.
- `low` rejected — RowMenu re-adds its listeners on every parent render (`onClose` is a new closure each time). The cost is negligible.
- `false` — "AC 2 expects a menu on Ctrl+Shift+E": the fix would edit this build's spec; the frozen intent says Ctrl+Shift+E runs Show in folder.
- After the patches: `uv run pytest` 201 passed, `npm test` 204 passed, `npm run typecheck` clean, `cargo test` 28 passed. Not yet checked under `tauri dev`.

## Verification

**Commands:**
- `cd engine && uv run pytest` -- expected: all pass
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd app/src-tauri && cargo test` (from PowerShell) -- expected: all pass

**Manual checks:**
- Under `tauri dev`: open a file by double-click, Enter and the menu; the menu by right-click, Shift+F10 and the Menu key, in light, dark and `dir="rtl"`; Show in folder selects the row.
