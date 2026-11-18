---
title: 'Story 2.5: Show a file thumbnail in the Preview Panel'
type: 'feature'
created: '2026-11-17'
status: 'done'
route: 'dispatch'
baseline_commit: '839ccbb5726d87b782f22770ac0f223b0aec81f7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Preview Panel only ever says "Select a file to preview", so the user can't see what a file is before opening it. The project ends at Epic 2, so Epic 4's text preview won't be built.

**Approach:** Selecting a file in the browse list or Name matches shows its name, details and a square thumbnail in the top-end corner of the Preview Panel. Images show the real image. TXT/MD files show their first lines on a "mini page". Every other file shows a page shape with its type icon and extension. A new `preview` request on the engine's latest-wins `preview` channel does the reading.

## Boundaries & Constraints

**Always:**
- Thumbnail: square, `clamp(96px, 50%, 192px)` of the panel content width (≈144px at 320px). It sits at the inline-end of the header row, with the name, type, size and modified beside it at inline-start and the location below. Use logical properties only.
- All reads go through FileSystemPort, opened read-only and only on selection. They are capped by the rules in `engine/core/rules/preview.py`: images ≤ 10 MB (PNG, JPG/JPEG, GIF, WEBP, BMP), text = first 2,048 bytes, 2 s deadline checked between 64 KB chunks and against the cancel token. Nothing is cached or logged except path and outcome code.
- Never open a file with `RECALL_ON_DATA_ACCESS` or `OFFLINE` set. The adapter checks attributes again via `FindFirstFileW` before opening.
- Per-file failures are a core `ReadOutcome` sent as `outcomeCode`, never a protocol error. The UI maps each code to a `preview.<code>` string.
- Strings: English only, in the existing catalog (decision 2026-11-17: there is no Hebrew catalog or language switch). The layout stays RTL-safe through logical properties.
- Show details at once from the selected row and a skeleton for the thumbnail (no animation under reduced motion). Images get `alt` = the file name and `object-fit: contain`. Borders stay visible in forced-colors mode. Names are isolated with `<bdi>`/`dir="auto"`.

**Never:** No image libraries, decoding or resizing in the engine; bytes are sent as base64. No `blob:`/asset protocol and no CSP change (`img-src data:` already allowed). No PDF/DOCX text extraction, no 960–1279px overlay and no Alt+P (Story 4.1). No change to the row menu. Never write to a file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Image | `photo.png` 2 MB | `previewReady` `thumbnail {kind:"image", mime:"image/png", data}`; real image fills the square | `<img>` load error → page shape + "This file can't be read" |
| Text | `notes.md` / `.txt` | `thumbnail {kind:"text", text}` = first 2,048 bytes decoded (UTF-8 with BOM stripped, UTF-16 by BOM, invalid bytes replaced, partial last char dropped) | — |
| Other type | `report.pdf`, `a.docx`, `x.zip` | `thumbnail {kind:"page"}`; page shape with the ICONS type icon and upper-case extension | — |
| Image too big | `big.jpg` 12 MB | `kind:"page"`, `outcomeCode:"tooLarge"` → "This file is too large to preview" | — |
| Online-only | RECALL_ON_DATA_ACCESS or OFFLINE | `kind:"page"`, `storedOnlyInOneDrive` → "Stored only in OneDrive"; file never opened | — |
| Unreadable | access denied, missing, locked, deadline passed | `kind:"page"`, `cannotRead` → "This file can't be read" | — |
| No file | nothing selected, a folder selected, list emptied | "Select a file to preview" (EARS-02); no request sent | — |
| Rapid ↓ | 20 selections in 1 s | only the last selection's thumbnail shows; older ones get `cancelled` from the engine and the UI drops stale replies | — |
| Engine restart | request pending | `cannotRead` state | `EngineStoppedError` caught |

</frozen-after-approval>

## Code Map

- `engine/core/rules/file_types.py` -- `extension()`, `file_type_code()`. Reuse them. Add `engine/core/rules/preview.py` (limits, image extension→mime, the text types `text`/`markdown`).
- `engine/core/ports/filesystem.py` -- `FsEntry` (35), attribute constants (24-25). Add `stat(path) -> FsEntry` and `read_head(path, limit, check) -> bytes`. `check()` raises on cancel or deadline.
- `engine/adapters/windows_fs.py` -- `_find` (92, FindFirstFileW, no open) gives `stat`. `read_head` re-checks the recall/offline attributes, then does `open(path, "rb")` in 64 KB chunks.
- New `engine/core/preview.py` + `engine/core/outcomes.py` (`ReadOutcome` with all spine values; only 3 used). Core may not import `os`/`io`/`pathlib`/`json`/`open()` (`tests/test_import_direction.py`); base64 is allowed. Inject the clock.
- `engine/main.py:159-168` -- `transport.register_channel("preview", "preview", handler)`. Raise `Cancelled` from `check()` on the token; the channel already replies `cancelled`.
- `protocol/schemas/` `preview.schema.json` `{id,type,path}` and `previewReady.schema.json` `{id,type,details{name,path,typeCode,size,modified},thumbnail,outcomeCode?}`, examples in `protocol/examples/`, `codes.json` add `readOutcomeCodes`. `npm run gen:protocol`.
- `app/src/protocol/client.ts:31-50` -- add the request and reply to the hand-kept unions.
- `app/src/browse/BrowseList.tsx:46` and `app/src/search/ResultList.tsx:128` -- selection is local state. Add an `onSelect(item | null)` prop, passing the full path (`childPath`, `browse/session.ts:70`), name, kind, typeCode, size and modified. `FileMatch` has no size; the reply's details fill it.
- New `app/src/preview/session.ts` -- the latest-counter pattern from `browse/session.ts:216-223`.
- `app/src/components/shell/AppShell.tsx:104` and `panes.tsx:112` `PreviewPanel` -- pick the browse or search selection by the active view, and render the states. Use `i18n/format.ts` (`typeLabel`, `formatSize`, `formatDate`), `browse/rows.tsx:26` `ICONS`, and the inline skeleton pattern `BrowseList.tsx:247`.
- `app/src/i18n/catalog.ts:32` -- `preview.*` keys. Extend `protocol/examples.test.ts:49-75` so every `readOutcomeCodes` entry has a `preview.<code>` string.
- Tests to follow: `engine/tests/test_windows_fs.py` (SetFileAttributesW at 28), `test_stdio_roundtrip.py` (`TEST_FS_SCRIPT` 202), `test_browse_core.py` (fake FsEntry), `app/src/components/shell/panes.test.tsx:52`, `browse/session.test.ts:27`.

## Tasks & Acceptance

**Execution:**
- [x] `protocol/` -- the two schemas, examples (image, text, page, each outcome), `readOutcomeCodes`; regenerate the types.
- [x] `engine/core/outcomes.py`, `engine/core/rules/preview.py`, `engine/core/preview.py` -- the matrix logic.
- [x] `engine/core/ports/filesystem.py`, `engine/adapters/windows_fs.py`, `engine/main.py` -- `stat`, `read_head`, the channel.
- [x] `app/src/protocol/client.ts`, `app/src/preview/session.ts` -- the request and the latest-wins session.
- [x] `app/src/browse/BrowseList.tsx`, `app/src/search/ResultList.tsx`, `app/src/components/shell/AppShell.tsx`, `panes.tsx` (or a new `app/src/preview/PreviewPanel.tsx`), `app/src/i18n/catalog.ts` -- the selection wiring, the panel, the strings.
- [x] Tests for every matrix row on the side that owns it, adapter tests for the recall guard and chunked read, and a stdio round trip previewing a real PNG and TXT in `tmp_path`.
- [x] `_bmad-output/planning-artifacts/epics.md`, `prds/.../prd.md`, `implementation-artifacts/sprint-status.yaml` -- add Story 2.5 under Epic 2 with these ACs, a PRD change-log row and a §4.7 note (thumbnail in the MVP, FR-22 text preview out of scope), and the `2-5-…` key.

**Acceptance Criteria:**
- Given `npm test`, `npm run typecheck`, `uv run pytest`, `cargo test` and the Pester suite, when run, then all pass.
- Given `tauri dev`, when I arrow through a folder of PNG, TXT and PDF files, then each one's thumbnail appears within 2 s at ≈144px in the panel's top-right corner, and holding ↓ ends on the last file's thumbnail.

## Implementation Notes

- `readOutcomeCodes` lists only the three codes a preview sends; the core `ReadOutcome` enum holds all six spine values (`core/outcomes.py`, `PREVIEW_OUTCOMES`).
- `details.size` is `integer | null`: null when the engine couldn't look the file up (missing, denied), so the UI never shows a made-up "0 KB". Details for an unreadable file come from the requested path.
- Online-only is checked first, for every type: an online-only PDF also says "Stored only in OneDrive". The adapter raises `StoredOnline` (a port exception) when its own look-up just before opening sees the attributes.
- Images are read with a limit of 10 MB + 1 byte, so an image that grew since its look-up is still `tooLarge`.
- The panel moved to `app/src/preview/PreviewPanel.tsx`; `AppShell` keeps the browse and search selections and sends `select` only when `previewKey` changes (path, size, modified). Closing the search view forgets its selection.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap). The review diff excluded the rename-only files, but a concurrent, uncommitted Rename File feature from another session shares several files with this story, so its hunks were in the diff.

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind-hunter, edge-case-hunter (×3) | The 2 s deadline is only checked between chunks: `locate`/`stat`/`open`/a single blocking read on a dead share is unbounded, a text read (one chunk) is never checked after it, and the UI has no timeout, so the skeleton can hang | medium | patch | `check()` runs only before each chunk in `read_head`, and `PreviewSession.select` has no timer. Fix: a post-read deadline check in core, plus a UI timeout that marks the selection failed. |
| 2 | verification-gap | No `App.test.tsx` case covers App → AppShell → PreviewSession wiring | medium | patch | Pre-verified gap: AppShell tests inject `previewActions`/`preview` themselves, so dropping either prop in `App.tsx` passes every test. |
| 3 | edge-case-hunter | `ONLINE_ONLY_ATTRIBUTES` lacks `FILE_ATTRIBUTE_RECALL_ON_OPEN` | low | patch | `filesystem.py:38`. A file with RECALL_ON_OPEN would be opened. The fix is a one-token direct correction. |
| 4 | blind-hunter | The panel keeps the row's size/date/name over the reply's fresh `details` | low | patch | `FilePreview` uses `item.size ?? reply.details.size`. Preferring `reply.details` once it arrives is a direct swap. |
| 5 | blind-hunter, edge-case-hunter | `useEffect(() => cb?.(x))` returns the callback's result as cleanup | low | patch | `BrowseList.tsx`, `ResultList.tsx`, `AppShell.tsx`. Current callers return undefined; braces are a direct correction. |
| 6 | edge-case-hunter | `extensionOf` drops the extension label for dot-files (`.gitignore`, `.png`) while `typeLabel` and the engine use it | low | patch | `dot > 0` versus the engine's `rpartition`. Direct correction to `dot >= 0`. |
| 7 | blind-hunter | Online-only race between `_find` and `open()` | low | reject | The window is microseconds between two calls. The fix (CreateFileW + FILE_FLAG_OPEN_NO_RECALL) is more than a direct correction. |
| 8 | edge-case-hunter | A file symlink whose target is an online-only placeholder is opened | low | reject | FindFirstFileW reports the link. File symlinks into OneDrive are rare in everyday use, and the fix adds a guard branch. |
| 9 | edge-case-hunter | Python `open()` lacks FILE_SHARE_DELETE, so a save/rename elsewhere fails during a preview read | low | reject | Reads are ≤ 10 MB and bounded by the 2 s deadline. The fix needs CreateFileW + `open_osfhandle`. |
| 10 | blind-hunter, edge-case-hunter | Selecting a folder or nothing doesn't cancel the running engine read | low | reject | Wasted work only, bounded by the 2 s deadline and the 10 MB cap. Nothing user-visible changes, and the fix adds id plumbing and a cancel path. |
| 11 | blind-hunter, edge-case-hunter | After an engine restart the panel stays on "This file can't be read" until reselection | false | reject | The frozen matrix row "Engine restart → `cannotRead` state" specifies exactly this. The "cancelled with nothing newer" case is unreachable: the engine only cancels on a newer request or an explicit `cancel`. |
| 12 | blind-hunter | Windows-1255 or BOM-less UTF-16 Hebrew TXT shows replacement characters | low | reject | The frozen matrix fixes the decoding (UTF-8, UTF-16 by BOM, invalid → replaced). Legacy-encoded files are uncommon now (Notepad saves UTF-8), the harm is a 144px thumbnail, and the fix adds detection heuristics. |
| 13 | edge-case-hunter | A UTF-32 BOM decodes as UTF-16 | low | reject | UTF-32 text files are very rare, and the fix adds branches. |
| 14 | blind-hunter | A 10 MB image (~13 MB JSON line) isn't measured end to end against the 2 s budget and the 5 s ping | maybe-false | defer | No test or timing exists. To settle it, time a 10 MB JPG preview and a held ↓ through large photos in `tauri dev` on the Baseline PC. Medium if true. |
| 15 | blind-hunter | Logging the full path on every preview contradicts rename/search privacy | false | reject | The frozen Boundaries say "Nothing is cached or logged except path and outcome code", and the epic rule says logs hold paths and codes. Search and rename log user-typed text, which a path is not. |
| 16 | blind-hunter | Thumbnail alt repeats the heading; the outcome isn't in a live region; the frame has no role | false | reject | `alt` = the file name is in the frozen Boundaries. UX-DR22 limits live announcements to result counts and progress, and an outcome on every ↓ would be noise. |
| 17 | blind-hunter | Missing tests: RTL render, stdio online-only, stdio UTF-16, image-fail-then-new-data, a malformed path raising ValueError | low | reject | `style-rules.test.ts` enforces logical properties. Online-only and UTF-16 are covered in core and adapter tests. `FilePreview` is keyed by path and resets on new data. Paths come from listings and never hold NUL or wildcards, and an escaping error still ends as `failed` → cannotRead. |
| 18 | blind-hunter, verification-gap | The diff mixes in the uncommitted Rename File feature without its new files | low | defer | Not this story: another session's work in the same tree. It must be committed separately. |
| 19 | blind-hunter | `epics.md` UX-DR21/Story 1.x ACs and the brief/EXPERIENCE still say "no rename" | medium | defer | Rename's planning gap, not this story's. |
| 20 | verification-gap | `create_file` docstring still says "the port's only write" | low | defer | Made stale by Rename's `rename_file`. |
| 21 | edge-case-hunter | `rename_file` isdir check then `os.rename` is a check-then-act race | low | defer | Rename's adapter. |
| 22 | edge-case-hunter | `rename_file` uses `str.casefold` instead of Windows case mapping | low | defer | Rename's adapter. |
| 23 | edge-case-hunter | `rename_file` maps an in-use source to fileExists when the new name exists | low | defer | Rename's adapter. |

## Verification

**Commands:**
- `cd engine; uv run pytest` -- expected: all pass
- `cd app; npm run gen:protocol; npm test; npm run typecheck` -- expected: all pass
- `cd app/src-tauri; cargo test` -- expected: all pass
