---
title: 'Story 1.4: Browse a folder'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '450c9d6f11b5c0b3bc3fa9d67ddec86b2aea244b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The main list is an empty frame. Dana can't see any folder's contents, and the engine has no way to read the file system yet.

**Approach:** Add a `listFolder` request that the engine answers through a new FileSystemPort and the core's `is_candidate()`, on a latest-wins `listFolder` channel off the reader thread. The UI asks for Documents after every `ready` and renders a sortable browse list (icon, name, type, size, modified) with skeleton and empty states. All words and formatting come from the catalog.

## Boundaries & Constraints

**Always:**
- The core reaches files only through `FileSystemPort.list()`. Attributes come from directory enumeration (`os.scandir`, `DirEntry.stat(follow_symlinks=False)`), and no file is ever opened. AD-1's import guard stays green.
- `is_candidate(entry)` skips hidden or system items, names starting with `~$`, and directory junctions/symlinks (name-surrogate reparse points). OneDrive placeholders are listed.
- The engine sends codes and data, never words. `typeCode` comes from an extension map in `engine/core/rules/`. The UI catalog words every column, type, size and date.
- Every request still ends with exactly one terminal reply. A superseded `listFolder` ends with `cancelled`. Ping keeps working while a listing runs.
- Names are isolated with `<bdi>` inside `dir="auto"` cells. Logical CSS only. Rows are 36px high.

**Never:**
- No navigation, row selection, opening, context menu or keyboard row movement (1.5, 1.6, 1.8). No nav-pane entries. Access-denied handling beyond showing the message is 1.7's.
- No multi-part replies; oversized listings are deferred. No new dependencies. No changes to the Rust shell.
- No sorting, filtering or wording in the engine beyond `is_candidate` and the type map. No product rules in the UI: sorting the shown rows is presentation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start | `ready` arrives | `listFolder {}` → `folderListing {path, entries}` for Documents (Known Folder, OneDrive-redirected too); skeleton until it arrives | N/A |
| Filtered | hidden, system, `~$x.docx`, junction, normal file | only the normal file listed | N/A |
| Empty | folder with no candidates | "This folder is empty." with an outline folder icon | N/A |
| Superseded | 2nd `listFolder` before the 1st finishes | 1st ends `{id, type:"cancelled"}`, 2nd gets the listing | UI ignores `cancelled` |
| Missing / denied | path gone, or `PermissionError` | error `folderNotFound` / `accessDenied` | UI shows "This folder doesn't exist." / "You don't have permission to open this folder." in the empty state |
| Restart | engine dies mid-listing | last listing stays on screen; after the next `ready` it lists again | pending request ends with `EngineStoppedError`, silently |

</frozen-after-approval>

## Code Map

- `engine/adapters/stdio_transport.py` -- `HANDLERS` (ping, status) run on the reader thread; keep them and `HANDLERS` patchable (the roundtrip test patches it). Add channel dispatch: `register_channel(type, channel, handler)`, one worker thread per channel, a `CancelToken` per request. A newer request on the channel cancels the old token; the old one's terminal is `cancelled` unless its reply was already queued. Validator, encode and the writer queue are reused as is.
- `engine/main.py` -- composition root: build `WindowsFileSystem` and register `listFolder` before sending `ready`.
- `engine/core/` -- empty today. The import guard bans `os`, `pathlib`, `json`, `io` and `open()`; `threading` is allowed.
- `protocol/` -- schemas + examples are parsed by both sides (`app/src/protocol/examples.test.ts`, `engine/tests/test_protocol_examples.py`); `codes.json` lists error codes; TS types are generated (`npm run gen:protocol`).
- `app/src/protocol/client.ts` -- `Reply` union: add `FolderListing | Cancelled`. `request()` resolves on the first message with the id; that's enough without multi-part replies.
- `app/src/engine/session.ts` -- model for the new `BrowseSession`: a non-React class, testable with a fake transport (`session.test.ts`).
- `app/src/components/shell/panes.tsx` `MainArea`, `AppShell.tsx`, `App.tsx` -- the list renders inside `<main>`, whose catalog-only text test renders `AppShell` without a listing.
- `app/src/i18n/catalog.ts` -- `t(key)` only; add a `{name}` placeholder formatter.
- Mockup `_bmad-output/planning-artifacts/ux-designs/ux-AIFile-browser-2026-10-30/mockups/key-states.html` rows: "Word document", "38 KB", "2.4 MB", "Oct 14, 2025"; header 13px muted, cells body-sm muted, names body.

## Tasks & Acceptance

**Execution:**
- [x] `protocol/schemas/{listFolder,folderListing,cancelled}.schema.json`, `protocol/examples/` (listFolder with and without `path`, a listing with Hebrew and mixed names, cancelled, both new errors), `protocol/codes.json` -- the message contract. Entry: `name`, `kind` (`folder`|`file`), `typeCode` (files only), `size` (bytes, files only), `modified` (ISO 8601 with local offset, or null).
- [x] `engine/core/ports/filesystem.py` -- `FsEntry` (name, is_dir, size, mtime_ns, attributes, reparse_tag) + `FileSystemPort` Protocol (`documents_folder()`, `list(path)`; raises `FileNotFoundError`/`PermissionError`).
- [x] `engine/core/candidates.py`, `engine/core/rules/file_types.py`, `engine/core/browse.py` -- `is_candidate`, the extension → `typeCode` map (folder, pdf, word, excel, powerpoint, text, markdown, image, audio, video, archive, other), and `list_folder(fs, path|None, token)`: resolve the path, filter, map, check the token every 200 entries, raise `Cancelled`.
- [x] `engine/adapters/windows_fs.py` -- `WindowsFileSystem` (scandir; `SHGetKnownFolderPath(FOLDERID_Documents)` via ctypes).
- [x] `engine/adapters/stdio_transport.py`, `engine/main.py` -- channel dispatch and wiring as in the Code Map; map `FileNotFoundError`/`NotADirectoryError` → `folderNotFound` and `PermissionError` → `accessDenied`.
- [x] `engine/tests/` -- core tests with a fake port (filter, type map, cancel); adapter tests on a temp folder (hidden/system via `SetFileAttributesW`, `~$`, junction via `mklink /J`, Hebrew names); roundtrip tests for listing, both errors, supersede → `cancelled`, and ping answered during a slow listing.
- [x] `app/src/protocol/client.ts` -- extend `Reply`.
- [x] `app/src/browse/session.ts` -- `BrowseSession`: list Documents after every `ready`, keep the last listing through restarts, ignore `cancelled` and `EngineStoppedError`, keep the error code.
- [x] `app/src/browse/sort.ts` -- sort by column and direction: folders always before files; names compared with `Intl.Collator` (numeric, base); type by its displayed label; size and modified numeric; ties by name.
- [x] `app/src/i18n/catalog.ts`, `app/src/i18n/format.ts` -- strings: column names, "This folder is empty.", both error sentences, one label per `typeCode` ("File folder", "Word document", "PDF document", "Text document", …), `{ext} file` for `other` ("File" without an extension). `formatSize` ("0 KB", "38 KB" rounded up below 1 MB, then "2.4 MB" / "1.2 GB") and `formatDate` ("Oct 14, 2025").
- [x] `app/src/browse/BrowseList.tsx`, `panes.tsx`, `AppShell.tsx`, `App.tsx` -- table with a sticky header. Header buttons carry `aria-sort` and toggle direction on a second click (default name ascending). Rows show an icon per `typeCode` (lucide, `text-muted-foreground`), the name, type, size (`text-end`) and modified. Skeleton rows (`aria-busy`) while loading; the empty state with an icon and sentence.
- [x] `app/src/browse/*.test.ts(x)` -- session (ready → list, restart re-lists, cancelled ignored), sort (every column both ways, folders first, natural order), format, and a jsdom render: header toggle, `<bdi dir="auto">` names with `סיכום ישיבה 3.docx` and `Budget תקציב.pdf`, skeleton, empty state.

**Acceptance Criteria:**
- Given `tauri dev`, when the window opens, then the main list shows the real Documents folder's folders and files, with no hidden or system items and no `~$` files.
- Given a listed folder, when a column header is clicked, then rows sort by it, and a second click reverses them.
- Given a folder with Hebrew and mixed names, when listed, then each name reads in its own direction with the extension at the end.
- Given `npm test`, `npm run typecheck`, `uv run pytest` and `cargo test`, when run, then all pass.

## Implementation Notes

- Implemented by a fresh subagent from this spec. Files: `protocol/` (3 schemas, 6 examples, 2 codes), `engine/core/{ports/filesystem,cancel,candidates,browse}.py`, `engine/core/rules/file_types.py`, `engine/adapters/windows_fs.py`, channel dispatch in `stdio_transport.py`, wiring in `main.py`, `app/src/browse/{session,sort,BrowseList}`, `app/src/i18n/format.ts`, catalog strings and `t(key, values)`, plus tests on both sides.
- Deviations: `dir="auto"` sits on the `<bdi>`, not the `<td>`, so a Hebrew name doesn't move its row's icon to the other side. Any other `OSError` and relative paths map to `folderNotFound`, and an unknown error code shows the new `browse.unavailable` string. `gen-protocol-types.mjs` now names each message type from the schema `title`, since `folderListing`'s definitions broke the old first-export rule. The catalog plain-text test ignores `{name}` placeholders, and the AppShell test's "Type" chip query is scoped to the filter bar.
- Choices where the spec was silent: labels Excel workbook, PowerPoint presentation, Markdown document, Image, Audio file, Video file, Compressed file. An error clears the listing. Empty and error states show without the table header. A re-list after a restart keeps the old rows visible (busy). Unknown modified times sort oldest. Closing stdin cancels a running listing, which ends `cancelled`.
- Deferred: splitting oversized listings across several replies (AD-2) waits for search's multi-message replies in Epic 2; recorded in deferred-work.md.
- Verified 2026-11-09: `uv run pytest` 100 passed, `npm test` 134 passed, `npm run typecheck` clean, `cargo test` 22 passed. Under `tauri dev`, the real Documents folder (OneDrive-redirected) listed 24 of its 25 entries; the missing one is `desktop.ini` (hidden + system). Size header: ascending, then descending on a second click, folders first. Hebrew names render RTL with the extension at their end, as the mockup's `<bdi>` does. Light and dark checked.

## Spec Change Log

## Review Triage Log

| ID | Finding | Verdict | Evidence | Route |
|----|---------|---------|----------|-------|
| VG1 / BH13 | App → AppShell → MainArea → BrowseList wiring is untested; dropping `browse=` keeps every test green | medium | Pre-verified: every prop is optional, `App.test.tsx` never answers `listFolder`, and `AppShell.test.tsx` passes no `browse`. | patch P1 |
| VG2 | The `except OSError` → `folderNotFound` fallback in `list_folder_handler` is untested | low | Pre-verified: no test sends a path that raises a plain `OSError`; deleting the branch turns it into `invalidRequest` with every test green. | patch P2 |
| VG3 / BH7 | `Channel` has no unit tests (handler exception → `invalidRequest`, worker survives; reply finished after a cancel → `cancelled`; cancelled while queued) | low | Pre-verified: only reached end-to-end through `list_folder_handler`, which never raises. Every future channel depends on these rules. | patch P3 |
| VG-other / ECH1 | A name with an unpaired surrogate makes the whole folder unlistable | low | Real: NTFS allows it, and `scandir` keeps it in the `str`. `encode()` raises in `_write_loop`, so the listing becomes `invalidRequest`. Rare, but one bad name hides the whole folder; one rule in `is_candidate` skips it. | patch P4 |
| ECH5 / ECH11 / BH3b | After an error, a new `list()` keeps showing the old error sentence instead of skeleton rows | low | Real: `BrowseList` checks `!listing && error` before `loading`. The fix is one condition. | patch P5 |
| BH6 | The type-code lists (engine `TYPE_CODES`, schema enum, catalog `type.*`, `ICONS`) are never checked against each other; `` `type.${type}` as CatalogKey `` hides a missing label | low | Real: a code added to the engine and schema without a catalog key renders an empty type cell. `ICONS` is exhaustive by type; the label lookup is not. | patch P6 |
| ECH2 / BH1 | A blocking `scandir` (unreachable share, drive not ready) holds the channel thread, so newer listings queue behind it | medium (from 1.5) | Not reachable in 1.4: the only listing is Documents and nothing sends a second one, except after a restart, which starts a new engine. It becomes real when 1.5 adds typed paths, and the fix (an abandonable enumeration) is a design change. | defer D1 |
| BH9 / BH2 / BH4 | Paths aren't normalized (AD-9); a restart returns to Documents; other `OSError`s read "doesn't exist" | low (from 1.5) | Not reachable in 1.4: no request carries a path and Documents is the only folder. All three belong to 1.5's navigation and typed paths. | defer D2 |
| ECH3 / BH8 | `Channel.close` can time out, and the late `cancelled` is lost after the writer stops | low | Only during engine shutdown with a handler blocked past 5 s. By then the shell has stopped reading the old engine's lines and the UI has ended the request. No consumer exists. | reject |
| ECH4 / ECH10 | The newest request getting `cancelled` leaves `loading` true | false | The engine only answers `cancelled` for the latest request when its stdin closes. The shell has already left `watch()` by then, so the line is never forwarded, and `restarting` ends the request with `EngineStoppedError` (loading false). | reject |
| ECH6 | An unknown `typeCode` makes `ICONS[...]` undefined and crashes React | false | The engine and UI ship together and generate from one schema, so a version skew can't occur. Drift is handled by P6. | reject |
| ECH7 | 1023.95 MB–1 GB shows "1,024 MB" | low | Real but cosmetic and rare, and the fix adds unit-promotion logic. | reject |
| ECH8 / BH10 | Accent-equal names tie in enumeration order | low | NTFS is case-insensitive, so only accent-only twins tie, which is rare. A tie-breaker adds a comparator. | reject |
| ECH9 / BH5 | The type generator accepts only interfaces; duplicate definition titles would collide | false | Both fail the build loudly on a schema that doesn't exist yet. Every current schema compiles. | reject |
| BH3a | With the engine stopped before any listing, skeleton rows pulse forever | low | Real only when the engine never becomes ready, and then the banner already explains. Before the first `ready` the skeleton is the specified state. | reject |
| BH11 | The catalog test's placeholder regex differs from `t()`'s, and a missing value leaves `{ext}` on screen | low | A camelCase placeholder would fail the test loudly. Every current caller passes its value. | reject |
| BH12 | The ping-during-listing test depends on timing | low | Pong takes milliseconds on a free reader thread; a 1 s bound on a local run is generous. | reject |

## Design Notes

Latest-wins without blocking ping: the reader thread only queues channelled requests.

```
reader: listFolder#2 → channel["listFolder"].cancel(#1); submit(#2)
worker: list_folder(..., token#1) raises Cancelled → send {id:#1, type:"cancelled"}
        then runs #2 → send folderListing
```

Skeleton: rows show as soon as a listing starts and stay until the reply arrives. A fast reply (under 300 ms) replaces them right away.

## Verification

**Commands:**
- `cd engine && uv run pytest` -- expected: all pass
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd app/src-tauri && cargo test` (from PowerShell) -- expected: all pass

**Manual checks:**
- Under `tauri dev`: the list shows Documents; header clicks sort and reverse; the light/dark screenshots match the mockup's row style.
