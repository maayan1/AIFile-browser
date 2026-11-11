---
title: 'Story 1.5: Navigate folders'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd0210bf918b075067124d7665cbca12be2cee69b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app only shows Documents. Dana can't open a subfolder, go up or back, jump to an ancestor, type a path or pick another place, so the browser stops at one folder.

**Approach:** Navigate like File Explorer: open a folder from its row; Up/Back/Forward with a UI-side history; a breadcrumb bar whose segments the engine supplies, editable with Alt+D or a click on its empty area; and a nav pane of known folders and local drives that the engine lists. The engine normalizes every incoming path (AD-9) and gives each failure a code. After an engine restart the current folder is listed again.

## Boundaries & Constraints

**Always:**
- The engine owns path rules: it normalizes each incoming path (trim, strip surrounding quotes, absolute only, `normpath`, upper-case drive letter, on-disk casing per segment from directory enumeration, trailing `\` only on roots), and it computes `parent` and breadcrumb `segments`. The UI may only join a listed folder's path with a child name (`path + "\" + name`) before sending it.
- Breadcrumb segments are anchored at the deepest known folder (Documents, Desktop, Downloads) that contains the path, else at the drive or share root. A known-folder segment carries a code that the catalog words ("Documents"). A drive segment reads "{label} ({letter})", or "Local Disk ({letter})" without a label.
- Segments keep the real path order, each one isolated with `<bdi dir="auto">`. Separators are a chevron mirrored under `rtl:`.
- Failures carry codes: `folderNotFound` for a missing path, not a folder, an invalid name or a relative path; `accessDenied`; `folderUnavailable` for any other OS error (drive not ready, unreachable share).
- Every word comes from the catalog. Logical CSS only. The nav pane and breadcrumb take part in the existing tab order.

**Never:**
- Alt+←/→/↑ or other shortcuts besides Alt+D, and ↑/↓ row movement (1.8). Opening files (1.6). Special access-denied behavior beyond today's empty state (1.7). Live drive-change detection.
- Making a hanging enumeration abandonable: split off as its own build (deferred-work.md).
- No new dependencies. No Rust changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open subfolder | double-click, or Enter on the selected folder row | lists `path\name`; pushed on history; Forward cleared | files do nothing yet |
| Up / Back / Forward | buttons | parent / previous / next folder | each disabled when there's nowhere to go (`parent: null` at a root) |
| Breadcrumb | `Documents › Volunteering`, click `Documents` | that ancestor opens | N/A |
| Typed path | Alt+D, `"c:\users\dana\documents\"` + Enter | opens `C:\Users\dana\Documents`; breadcrumb `Documents` | Esc or blur cancels the edit |
| Invalid typed path | `C:\nope` or `relative` + Enter | "This folder doesn't exist." under the field; the current folder stays open | `folderUnavailable` shows "This folder can't be shown right now." the same way |
| Nav pane | app open | "Search folders" (empty), "Quick access": Documents, Desktop, Downloads; "This PC": fixed and removable drives | a known folder that doesn't exist is left out |
| Highlight | inside `Documents\Volunteering` | Documents is highlighted (the first breadcrumb segment's entry) | none highlighted if no entry matches |
| Restart | engine restarts while in `D:\Work` | `D:\Work` is listed again, history kept | N/A |

</frozen-after-approval>

## Code Map

- `engine/core/browse.py` `list_folder` -- add `fs.resolve(path)` first; build `parent` and `segments` in the core from the resolved path and `fs.known_folders()` (string splitting on `\`, casefold for comparison; core may not import `os`/`pathlib`/`ntpath`).
- `engine/core/ports/filesystem.py` `FileSystemPort` -- add `resolve(path) -> str`, `known_folders() -> dict[code, path]`, `drives() -> list[Drive]`.
- `engine/adapters/windows_fs.py` -- `known_folder_path` exists; add Desktop `{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}` and Downloads `{374DE290-123F-4565-9164-39C4925E467B}`. Casing via `FindFirstFileW` per segment. Drives via `GetLogicalDrives`/`GetDriveTypeW` (fixed and removable only) and `GetVolumeInformationW` (label, or null when not ready).
- `engine/main.py` `list_folder_handler` -- error mapping; add the `folderUnavailable` code (winerror 123 stays `folderNotFound`). Register a `listLocations` request on its own `locations` channel (`GetVolumeInformationW` can block on a removable drive).
- `engine/adapters/stdio_transport.py` -- `register_channel` and `Channel` unchanged.
- `protocol/` -- `folderListing` gains `parent` and `segments`; new `listLocations` / `locations` schemas and examples; `codes.json` + `folderUnavailable`. `examples.test.ts` and `test_protocol_examples.py` parse every example; the `TYPE_CODES`-vs-schema test pattern can pin the known-folder codes.
- `app/src/browse/session.ts` `BrowseSession` -- today lists Documents on every `ready` and replaces the listing on any reply. It becomes the navigation model: current folder, back/forward stacks, typed-path error, locations.
- `app/src/components/shell/TopBar.tsx` -- disabled `IconButton`s for back/forward/up and an empty breadcrumb `div` (`role="group"`); `mirrored` flag for rtl icons. `panes.tsx` `NavPane` is an empty `<nav>`.
- `app/src/browse/BrowseList.tsx` `Row` -- add selection (`bg-selection`, `aria-selected`), double-click and Enter.
- `app/src/i18n/catalog.ts` -- `browse.folderNotFound`, `browse.unavailable` exist; add nav headings (mockup: "Search folders", "Quick access", "This PC", styled `group-label`, uppercase), known-folder names, `Local Disk ({letter})`, `{label} ({letter})`, breadcrumb field label.
- Mockup `mockups/key-states.html`: nav items 6px/10px padding, radius 4, current item `bg-selection`; breadcrumb 14px with muted `›`.

## Tasks & Acceptance

**Execution:**
- [x] `protocol/schemas/` + `examples/` + `codes.json` -- `folderListing.parent` (string | null) and `segments` (`{kind:"knownFolder", code, path}` | `{kind:"drive", letter, label, path}` | `{kind:"folder", name, path}`); `listLocations {id}` → `locations {id, knownFolders:[{code, path}], drives:[{letter, label, path}]}`; `folderUnavailable`.
- [x] `engine/core/ports/filesystem.py`, `engine/adapters/windows_fs.py` -- `resolve`, `known_folders`, `drives` as in the Code Map.
- [x] `engine/core/browse.py`, new `engine/core/locations.py` -- resolve, then list, `parent` and `segments`; the locations reply data (known folders that exist, drives in letter order).
- [x] `engine/main.py` -- error codes and the `listLocations` registration.
- [x] `engine/tests/` -- core: segments and anchoring (inside Documents, drive root, UNC root, a known folder nested in another), parent, codes; adapter: resolve (quotes, case, trailing `\`, relative, missing, invalid name), known folders and drives exist; roundtrip: typed path normalized, `folderUnavailable` via a fake port, `listLocations`.
- [x] `app/src/browse/session.ts` -- `open(path)`, `back()`, `forward()`, `up()`, `openTyped(path)`, `canBack`/`canForward`, `pathError`, `locations`; history entries are listed paths (the reply's normalized `path`); a typed-path failure only sets `pathError` and keeps the current listing; a row/up/breadcrumb/nav failure becomes the current location in the empty state, as today; after `ready` it re-lists the current folder (Documents at first) and requests locations.
- [x] `app/src/browse/BrowseList.tsx` -- click selects a row (one at a time) and focuses it; double-click or Enter on a folder row calls `open`.
- [x] `app/src/components/shell/TopBar.tsx`, new `app/src/browse/Breadcrumb.tsx` -- enabled Up/Back/Forward; segment buttons; edit mode on empty-area click or Alt+D (the whole path selected), Enter submits, Esc/blur cancels; the error sentence under the field (`aria-describedby`).
- [x] `app/src/components/shell/panes.tsx` `NavPane` -- the three groups, entry buttons, highlight from `segments[0]` (known-folder code or drive letter, `aria-current="location"`).
- [x] `AppShell.tsx`, `App.tsx`, `catalog.ts` -- wire the session's actions and snapshot through; strings.
- [x] `app/src/**/*.test.ts(x)` -- session (history push/back/forward/clear, typed failure keeps the folder, restart re-lists the current folder), Breadcrumb (segments in order with `bdi`, click, Alt+D edit/Enter/Esc, error text), NavPane (groups, highlight, click), BrowseList (select, double-click, Enter opens a folder only), App wiring.

**Acceptance Criteria:**
- Given `tauri dev`, when I double-click a subfolder, go Up, then Back and Forward, then the list, breadcrumb and button states follow like File Explorer.
- Given the breadcrumb, when I press Alt+D, type a valid path in lower case and press Enter, then the folder opens and the breadcrumb shows its on-disk casing.
- Given `npm test`, `npm run typecheck`, `uv run pytest` and `cargo test`, when run, then all pass.

### Review Findings

Code review 2026-11-09 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor).

- [x] [Review][Decision] Up and the breadcrumb are dead in a folder that failed to open — resolved: fixed via the engine (user's call). A folder that resolves but can't be listed raises `FolderUnreadable`; the error's `data` carries `{path, parent, segments}`, the session keeps it as `place`, and Up, the breadcrumb and the nav highlight read `place`. A path that doesn't resolve still sends `data: {}`. — After a failed row/Up/breadcrumb/nav open (e.g. `Documents\Private`, accessDenied), `listing` is null: `TopBar` disables Up (`listing?.parent`), `session.up()` returns early and `Breadcrumb` shows the path as plain text, so Back and the nav pane are the only ways out although the folder has a parent. The error reply carries no `parent`/`segments`, and the UI may not compute paths. (medium; acceptance-auditor+blind-hunter+edge-case-hunter)
- [x] [Review][Patch] Scroll position carries over to the next folder [app/src/components/shell/panes.tsx:79] — `<main overflow-auto>` stays mounted, so a folder opened from far down a long list shows already scrolled. (medium)
- [x] [Review][Patch] `resolve` fails with accessDenied when an ancestor can't be listed [engine/adapters/windows_fs.py] — one `FindFirstFileW` per segment needs list rights on each parent; a folder reachable by traverse rights only (another profile's shared subfolder, ABE shares) fails before `list()` is tried. Keep the typed segment on ERROR_ACCESS_DENIED and let `list()` decide. (medium; blind-hunter+edge-case-hunter)
- [x] [Review][Patch] NavPane has no tests [app/src/components/shell/panes.tsx:24] — the task lists "NavPane (groups, highlight, click)"; nothing asserts the three headings, the drive highlight or "none highlighted". (medium; acceptance-auditor+verification-gap)
- [x] [Review][Patch] Up's disabled state at a root is untested [app/src/components/shell/TopBar.tsx:35] — no test renders a `parent: null` listing; dropping `.parent` from the gate passes every test. (low; verification-gap)
- [x] [Review][Patch] `drives()` type filter and per-letter bypass are untested [engine/adapters/windows_fs.py] — a fake kernel32 can pin "network/optical left out" and "`drives("Z")` still returns it". (low; verification-gap)
- [x] [Review][Patch] Device-path check runs before `normpath` [engine/adapters/windows_fs.py] — `/\?\C:\` slips past the raw-prefix test and normalizes to `\\?\C:\`, listed as a share. Check after `normpath`. (low; edge-case-hunter)
- [x] [Review][Patch] A `listLocations` error reply is dropped silently [app/src/browse/session.ts:180] — the nav pane stays empty with nothing logged. (low; edge-case-hunter)
- [x] [Review][Patch] `listFolder` request schema doesn't describe typed paths [protocol/schemas/listFolder.schema.json] — the description should say the engine normalizes `path` and which codes it replies with. (low; blind-hunter)
- [x] [Review][Patch] deferred-work.md still lists the 1.4→1.5 handoff as open [_bmad-output/implementation-artifacts/deferred-work.md:37] — this story delivers all three items. (low; acceptance-auditor)
- [x] [Review][Defer] No tab stop into the list, and focus drops after opening a folder [app/src/browse/BrowseList.tsx:151] — deferred: pre-existing (1.4 rows took no focus); Story 1.8 owns Tab order and ↑/↓.
- [x] [Review][Defer] `GetVolumeInformationW` may raise a "no disk" system dialog on an empty removable drive [engine/adapters/windows_fs.py] — deferred: maybe-false (medium if true); settle by trying an empty card reader / USB slot under `tauri dev`, or calling `SetErrorMode(SEM_FAILCRITICALERRORS)` at engine start.

Rejected:
- `low` Failed navigations put the requested (not normalized) path in history — those paths all come from engine data; typed failures don't commit.
- `low` Drive label read on the `listFolder` channel / unlabelled network or USB drive reads "Local Disk" — the label is read only for the drive being listed, which the listing touches anyway; the wording is the spec's rule.
- `low` After Enter, an engine-restart re-list closes the path field as if the typed path opened — needs an engine crash during a typed request; fixing it needs a typed-outcome signal from the session.
- `low` Esc after Enter doesn't cancel a slow typed request — File Explorer behaves the same; fixing it adds a cancel path.
- `low` Two quick Back clicks, or Up while a listing is pending, act on the folder still on screen — local replies arrive in milliseconds; fixing it needs a pending history cursor.
- `low` UNC server/share casing isn't normalized (duplicate history entries) — rare at home; fixing it needs network lookups.
- `false` Nav pane never refreshes — live drive-change detection is in the spec's Never list.
- `false` `aria-current="location"` on an ancestor known folder, and an always-empty "Search folders" group — both are what the spec asks for.
- `low` Known folder reported in another form (8.3, subst) than the resolved path — `SHGetKnownFolderPath` returns long-form paths and comparison casefolds.

## Implementation Notes

- Implemented by a fresh subagent from this spec. It stopped at the very end when the account hit its usage limit; its work was intact and its last step (the App wiring test) was done. I finished the run inline: one fix, typing the `fakeActions()` mocks in `Breadcrumb.test.tsx` as `Mock<BrowseActions[K]>` (`tsc` rejected the untyped `vi.fn()`s).
- Engine: `resolve` in `windows_fs.py` (one `FindFirstFileW` per segment for casing; invalid characters, device paths and relative paths are `FileNotFoundError`); `parent`/`segments` built in `core/browse.py` by string splitting with casefold comparison; `core/locations.py`; `folder_error_code` in `main.py` decides by winerror first, because Python maps ERROR_NOT_READY to `PermissionError` and an unreachable share to `FileNotFoundError`. `listLocations` runs on its own `locations` channel.
- UI: `BrowseSession` implements `BrowseActions` (open, openTyped, back, forward, up, clearPathError, plus reload); history changes only when a reply arrives, so a replaced or restart-ended request leaves it as it was. `childPath` is the only path the UI builds. New `Breadcrumb.tsx`; `NavPane` with three groups; rows select on click and open folders on double-click or Enter.
- Choices where the spec was silent: opening the current folder again pushes nothing; Up is a push; a failed row/up/nav navigation becomes the location (path shown in the breadcrumb, sentence in the empty state); the typed-path error is a small popover under the field, and typing again clears it.
- Verified 2026-11-09: `uv run pytest` 163 passed, `npm test` 167 passed, `npm run typecheck` clean, `cargo test` 22 passed. Under `tauri dev` on the real profile: nav pane shows Search folders (empty), Quick access (Documents, Desktop, Downloads) and This PC (OS (C:)), with Documents highlighted; double-click, Up, Back and Forward followed the expected history with the right button states; a lower-case, quoted, trailing-backslash typed path opened with on-disk casing; `C:\no such folder here` showed "This folder doesn't exist." under the field with the current folder kept; the drive entry opened `C:\` with Up disabled and the drive highlighted.
- Completeness check 2026-11-09: every Execution task and matrix row is in the code. One fix: a typed path that failed after the field was left (a slow share, then a click elsewhere) showed its stale error on the next Alt+D; `Breadcrumb` now shows only an error for a path typed in the current edit and clears the session's on open (new test). `npm test` 168 passed, typecheck clean; pytest 163 and cargo 22 unchanged.
- Acceptance re-check against epics.md (all four ACs) under `tauri dev`: Enter on a selected folder row opened it; a click on the breadcrumb's empty area opened the path field with the full path, and Esc returned to the segments; killing the engine in `Documents > Programming` showed the banner, then re-listed the same folder with Back still enabled; `dir="rtl"` put the nav pane on the right and the segments right-to-left (Documents first) with the chevron mirrored (`scale: -1 1`); dark mode kept the highlight and chevrons. Nothing missing.

## Spec Change Log

## Review Triage Log

- 2026-11-09, review 1: 1 decision (fixed via the engine), 9 patches applied, 2 deferred, 9 rejected. After the fixes: `uv run pytest` 170 passed, `npm test` 179 passed, `npm run typecheck` clean, `cargo test` 22 passed. Not re-checked under `tauri dev`: Up and the breadcrumb from an access-denied folder, and the scroll reset.

## Verification

**Commands:**
- `cd engine && uv run pytest` -- expected: all pass
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd app/src-tauri && cargo test` (from PowerShell) -- expected: all pass

**Manual checks:**
- Under `tauri dev`: rows, Up/Back/Forward, breadcrumb clicks, Alt+D typed paths (valid and invalid) and nav pane entries behave as in the matrix; light/dark and `dir="rtl"` keep the layout and chevrons correct.
