---
title: "Story 1.7: Handle folders I can't open"
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '635cad52c5121bf4436a6f0e2b4e97271768c043'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Browsing already shows "You don't have permission to open this folder." with Back working, skips junctions, and reads attributes only from directory enumeration. But the one folder walker that AD-4 calls for doesn't exist yet: name search (Epic 2) and indexing need one that never follows a junction or symlink loop, never descends into an online-only OneDrive folder, and steps past folders it can't read. Nothing pins the "never opens a file" rule either.

**Approach:** Add the walker to the engine core on top of the port's `list()`, so `is_candidate` and the OneDrive rule sit in one place. Prove the listing path never opens a file. Add the missing tests that show an access-denied folder ends in the plain message with Back still working, from the engine reply through to the app.

## Boundaries & Constraints

**Always:**
- One walker: `core/walk.py` `walk(fs, root, token)`, depth-first, built only on `fs.list()`. It descends only into entries that pass `is_candidate`, are directories, and don't have `FILE_ATTRIBUTE_RECALL_ON_OPEN`. Junctions and symlinks are never followed (`is_candidate` already drops name surrogates). It checks the cancel token before each directory (AD-10).
- An unreadable folder below the root is reported in the walk (its path and OSError) and skipped; the walk goes on. An unreadable root raises, as `list_folder` does.
- Files with `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` and online-only folders are still yielded as entries (findable by name); the walker never opens a file.
- `list()` stays enumeration-only: no `os.stat`, `open` or `CreateFileW` per entry.
- Decision (user, 2026-11-09): opening an online-only (RECALL_ON_OPEN) folder from the browse list lists it as File Explorer does (OneDrive's own process fetches its names; no file is downloaded). Only the walker skips such folders.
- Error codes stay as they are (`accessDenied` from the engine, `browse.accessDenied` in the catalog). No stack trace or OS text ever reaches a reply.

**Never:** No protocol request for walking (Epic 2 adds search). No UI changes beyond tests. No new dependencies. No reading of file contents.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Denied folder, browse | open `Documents\Private` (no list right) | "You don't have permission to open this folder."; Back returns; Up and breadcrumb work | `accessDenied` + place |
| Denied subfolder, walk | walk `D:\Work` containing a denied `Private` | `Private` reported unreadable; its siblings and their subtrees walked | walk continues |
| Junction loop | `Documents\My Music` junction → Documents; a symlink to an ancestor | not listed in browse; never descended in a walk | N/A |
| Online-only file | entry with RECALL_ON_DATA_ACCESS | listed and walked as an entry; never opened | N/A |
| Online-only folder | directory with RECALL_ON_OPEN | listed as an entry; a walk never descends into it | N/A |
| Cancel | token cancelled mid-walk | `Cancelled` before the next directory | N/A |

</frozen-after-approval>

## Code Map

- `engine/core/candidates.py` `is_candidate` -- already skips hidden/system, `~$`, name-surrogate reparse points (junctions, symlinks), non-UTF-8 names. Reuse as is.
- `engine/core/ports/filesystem.py` -- `FILE_ATTRIBUTE_RECALL_ON_OPEN` (0x40000), `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` (0x400000), `FsEntry` (name, is_dir, size, mtime_ns, attributes, reparse_tag). AD-4's "one `walk()`" lives in core, not on the port, so the rules stay in core; update the port docstring to say so.
- New `engine/core/walk.py` -- `walk(fs, root, token) -> Iterator[Walked]`; `Walked` = frozen dataclass `(folder: str, entries: list[FsEntry] | None, error: OSError | None)`, with entries filtered by `is_candidate`. Join child paths like `core/browse.py` (`SEP`, `join_path`); the core may not import `os`/`pathlib`/`ntpath` (`test_import_direction.py`).
- `engine/adapters/windows_fs.py` `list` -- `os.scandir` + `DirEntry.stat(follow_symlinks=False)` (find data, no syscall on Windows). Keep it that way.
- `engine/tests/test_browse_core.py` `FakeFs`, `file()`, `folder()` helpers -- reuse for walk tests.
- `engine/tests/test_windows_fs.py` -- has `deny_listing`-style icacls helpers and a junction fixture pattern (`test_enumeration_reports_attributes_and_reparse_tags`); `mklink /J` needs no admin rights.
- `engine/tests/test_stdio_roundtrip.py::test_denied_folder_is_access_denied` -- engine side of AC1 exists; check it asserts no traceback text in the reply.
- `app/src/App.test.tsx` -- add the access-denied journey (open a folder, `accessDenied` with place, message shown, Back lists the previous folder).

## Tasks & Acceptance

**Execution:**
- [x] `engine/core/walk.py`, `engine/core/ports/filesystem.py` -- the walker and the docstring note.
- [x] `engine/tests/test_walk.py` -- fake-port tests for every walk matrix row (denied subfolder reported and skipped, junction/symlink not followed, RECALL_ON_OPEN not descended but yielded, RECALL_ON_DATA_ACCESS yielded, cancel, unreadable root raises), plus a real-disk test on `tmp_path` with a `mklink /J` loop back to the root and an icacls-denied subfolder.
- [x] `engine/tests/test_windows_fs.py` -- `list()` of a tree with a junction makes no per-entry `os.stat`/`os.lstat`/`open` call (monkeypatch them to fail).
- [x] `engine/tests/test_stdio_roundtrip.py` -- the denied-folder reply holds only `id/type/code/data` with no OS message or traceback.
- [x] `app/src/App.test.tsx` -- the access-denied journey.

**Acceptance Criteria:**
- Given `tauri dev`, when I open a folder I can't read, then the list shows "You don't have permission to open this folder." and Back returns to the previous folder.
- Given `npm test`, `npm run typecheck`, `uv run pytest` and `cargo test`, when run, then all pass.

## Implementation Notes

- Implemented by a fresh subagent from this spec. New `core/walk.py`: `walk()` reads depth-first, using a stack, and `Walked(folder, entries | None, error | None)` is its unit. A folder that fails partway through is reported without its partial entries. `child_path` joins names using `split_path`/`join_path`, so the core still imports no `os`. Port docstrings say that AD-4's one walker lives in the core.
- Tests: `test_walk.py` covers every walk row of the matrix with a fake port, plus a real-disk walk with a `mklink /J` loop and an icacls-denied folder. The no-open listing test is in `test_windows_fs.py`. `test_denied_folder_is_access_denied` now checks the reply shape and that no OS text leaks. App test: the access-denied journey.
- No production code outside `engine/core` changed. The symlink-loop case is covered only by the fake port, because a real symlink needs admin rights or Developer Mode.
- Verified 2026-11-09, before review: `uv run pytest` 219, `npm test` 205, typecheck clean, `cargo test` 28.

## Spec Change Log

## Review Triage Log

- 2026-11-09, review 1 (blind-hunter, edge-case-hunter, verification-gap):
- `medium` patched — the no-open listing test patched only Python-level `os.stat`/`open`. A regression through C-level path helpers (`os.path.isdir`, `Path.is_dir`) or a following `DirEntry.stat()` would pass it, and its `>=` name check couldn't tell what came back. Now it uses `scandir` proxies that fail unless `follow_symlinks=False`, patches the `nt._path_*` helpers, checks the exact name set, and states its limit. (verification-gap, edge-case-hunter, blind-hunter)
- `low` patched — a walk couldn't be cancelled while reading one huge folder; it now checks the token every `CANCEL_CHECK_EVERY` entries, as `list_folder` does. (blind-hunter, edge-case-hunter)
- `low` patched — the module docstring said an unreadable root raises "as `list_folder` does". Walk raises the bare port error and takes the root as given (already resolved); the docstring now says so. (blind-hunter)
- `low` patched — the App access-denied test claimed "nothing else" in the list but checked one name, never replied to the breadcrumb step, and hard-coded the sentence. It now checks there are no rows, replies, and uses `t()`. (blind-hunter)
- `maybe-false` deferred (medium if true) — a directory with RECALL_ON_DATA_ACCESS (contents partly virtualized; enumerating fetches them) is still descended. Skipping it could also stop name search in ordinary OneDrive folders, if those carry the bit. Settle by reading the attributes of populated and online-only OneDrive folders on a real Files On-Demand PC. (edge-case-hunter)
- `false` — a walk stuck in an OS call stalls: the walk runs inside a channel handler, and the abandonable-listing change (3253844) abandons a handler stuck past its cancel.
- `low` rejected — a subfolder deleted mid-walk is reported like a denied one: callers get the OSError and its type. Epic 2 maps it to a code.
- `low` rejected — `Walked` doesn't enforce "entries or error": enforcing it adds a check, and the walker is its only producer.
- `low` rejected — the leak check's English substrings are brittle; the exact key-set assertions carry the guarantee.
- `false` — the junction left in `tmp_path` could make cleanup recurse: Python 3.14's `shutil.rmtree` unlinks junctions without following them, and the target is inside `tmp_path` anyway.
- `low` rejected — an online-only folder passed as the walk root is listed: roots come from the caller (a folder the user is in, or an indexed folder), and the user chose to list online-only folders in browse.
- `low` rejected — OFFLINE (HSM) folders are descended: OneDrive doesn't use that attribute.
- `low` rejected — names ending in a dot or space are mangled by Win32 path normalization: they can only be created with `\\?\`, and browse joins paths the same way.
- `false` — a non-OSError from the port for one subfolder ends the walk: the port raises OSError by contract, and enumerated names can't hold a NUL.
- `low` rejected — a RECALL_ON_DATA_ACCESS folder has no walk test: this follows the deferred item above.
- `false` — the `app/package.json` whitespace change and `mcp-server/` don't belong to this work; they stay out of the commit.
- After the patches: `uv run pytest` 220 passed, `npm test` 205 passed, `npm run typecheck` clean, `cargo test` 28 passed. Not yet checked under `tauri dev`.

## Verification

**Commands:**
- `cd engine && uv run pytest` -- expected: all pass
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd app/src-tauri && cargo test` (from PowerShell) -- expected: all pass

**Manual checks:**
- Under `tauri dev`: open a folder denied with `icacls <dir> /deny *S-1-1-0:(RD)`; the message shows, Back and Up work. In Documents, `My Music`/`My Pictures` junctions are not listed.
