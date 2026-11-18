- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-set-up-the-project-and-connect-the-ui-to-the-engine.md`
  summary: When the engine process exits, the shell must clear its cached `ready`/stdin, tell the UI, and the client must end or time out pending requests (Story 1.2 territory).
  evidence: `engine.rs` `read_lines` just returns on EOF, leaving `last_ready` set, so a reload after a crash still shows "ready". `ProtocolClient.request()` has no timeout, so "Ping: pending" stays forever if the engine dies. Review findings B2/E1, B3a/E6.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-set-up-the-project-and-connect-the-ui-to-the-engine.md`
  summary: The shutdown kill fallback targets the `uv` launcher, not the Python engine, so the engine may be orphaned. Unverified, medium if true.
  evidence: In debug builds `Child` is `uv run ... python main.py`. Whether killing `uv` ends its Python child depends on uv using a kill-on-close Job Object. To settle it, kill the `uv` process in a test while the engine ignores EOF, then check for a surviving python.exe. Story 1.2's kill-the-whole-tree requirement should cover this. Review findings B7/E4/E19.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-recover-when-the-engine-stops.md`
  summary: Add a fault-injection seam around the `Job` wrapper and test the supervisor's `Stuck` path (a job that won't empty leads to `stopped` with no respawn), plus `Job::new` and `assign` failures.
  evidence: `run_generation` maps `!emptied` to `Outcome::Stuck`, but no test can make `terminate_and_wait` return false. Mapping `Stuck` to `Failed` would spawn a second engine on top of a live tree with every test green. Review findings B7/VG5.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-recover-when-the-engine-stops.md`
  summary: Add DOM component tests (jsdom + testing-library) for `EngineBanner`/App: `role="alert"` and the catalog text shown on restarting/stopped, hidden after ready.
  evidence: Only the non-React `EngineSession.snapshot` is tested. Inverting `if (!visible) return null` passes every suite. A natural fit for Story 1.3, when the real layout lands. Review findings B12/VG6.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-recover-when-the-engine-stops.md`
  summary: In Story 3.9 (packaged sidecar), close the spawn-before-job-assign race by starting the engine suspended or with `PROC_THREAD_ATTRIBUTE_JOB_LIST`.
  evidence: `engine.rs` accepts the race because `uv` takes milliseconds before its first child. A packaged engine that starts children at once could escape the job. Review finding B11.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-main-window-layout-and-visual-style.md`
  summary: Clamp the first-launch window size and position to the monitor's work area, because the default 1280×800 (and even the 960×600 minimum height) can exceed small screens, such as 1366×768 at 125% scaling.
  evidence: At 1366×768 and 125% the logical work area is about 1093×576, so the window opens partly off-screen. The 1.1 default of 1200×800 overflowed too. It belongs with UX-DR24's remembered window size and position (Story 4.1). Review finding E3.

## Deferred from: code review of stories 1.1–1.3 (2026-11-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-main-window-layout-and-visual-style.md`
  summary: Raise the contrast of `--muted-foreground` on `--surface-pane` to WCAG AA (4.5:1). It is about 4.3:1 today, used for "Select a file to preview". Target Story 7.3.
  evidence: `app/src/index.css` keeps shadcn neutral `--muted-foreground: oklch(0.556 0 0)` on `--surface-pane: #f3f3f3`. `panes.tsx` uses it for the empty Preview Panel text.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-recover-when-the-engine-stops.md`
  summary: Re-confirmed by this review: the supervisor's `Stuck` path is untested. It is already recorded above (fault-injection seam around `Job`), so no new work item.
  evidence: Verification Gap reviewer: mapping `Stuck` to `Failed` keeps every suite green.

## Deferred from: Story 1.4 build (2026-11-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-browse-a-folder.md`
  summary: Split an oversized `folderListing` into several replies on the same id, with a line limit recorded in `protocol/` (AD-2).
  evidence: Story 1.4 sends one reply per listing, and `ProtocolClient.request()` resolves on the first message with an id. Multi-message replies arrive with search (Epic 2: searchParsed, nameMatches, …), which is the natural time to add both together.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-browse-a-folder.md`
  summary: Make a `listFolder` enumeration abandonable, so a blocking `scandir` (unreachable share, drive not ready) can't hold the channel thread while newer listings queue behind it (latest wins, AD-10).
  evidence: Review D1 (ECH2/BH1). `list_folder` checks its token only between entries, and the channel has one worker. Not reachable in 1.4, which lists only Documents; real once Story 1.5 adds typed and navigated paths. Medium from then on.
  resolved: `spec-abandonable-listing.md` (2026-11-09, commit 3253844). A request stuck past its cancel is abandoned after 250 ms, so newer listings no longer queue behind it.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-browse-a-folder.md`
  summary: For Story 1.5: normalize incoming paths in the engine (AD-9), re-list the last folder (not Documents) after an engine restart, and choose a code other than `folderNotFound` for a drive that isn't ready or an unreachable share.
  evidence: Review D2 (BH9/BH2/BH4). `folderListing.path` echoes the request string, `BrowseSession` lists Documents on every `ready`, and every other `OSError` maps to `folderNotFound`. None is reachable in 1.4, where no request carries a path.
  resolved: Story 1.5 (2026-11-09). The engine's `resolve` normalizes every path, the session re-lists the current folder after `ready`, and `folderUnavailable` covers a drive that isn't ready or an unreachable share.

## Deferred from: Story 1.5 scope split (2026-11-09)

- source_spec: none
  summary: Make a `listFolder` enumeration abandonable, so a blocking `scandir` (dead network share, drive not ready) can't hold the channel worker while newer listings queue behind it; build it right after Story 1.5.
  evidence: Split from Story 1.5 at the user's choice ("1–3 now, 4 next"). It touches only the engine's channel/queue and none of 1.5's navigation depends on it; it becomes reachable once 1.5 adds typed and navigated paths (review D1 of Story 1.4).
  resolved: `spec-abandonable-listing.md` (2026-11-09, commit 3253844). A request stuck past its cancel is abandoned after 250 ms, so newer listings no longer queue behind it.

## Deferred from: code review of spec-1-5-navigate-folders.md (2026-11-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-navigate-folders.md`
  summary: The browse list has no tab stop when no row is selected, and focus drops to the body after a row opens a folder. Give the list a roving tabindex (first row when none is selected) and move focus into the new listing after an open.
  evidence: Review of Story 1.5 (blind-hunter, edge-case-hunter). Pre-existing: 1.4 rows took no focus. Story 1.8 owns the Tab order and ↑/↓ movement.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-navigate-folders.md`
  summary: Check whether `GetVolumeInformationW` on an empty removable drive raises a "no disk" system dialog that blocks the `locations` channel; if it does, call `SetErrorMode(SEM_FAILCRITICALERRORS)` at engine start.
  evidence: Review of Story 1.5 (edge-case-hunter), unverified (medium if true). Settle by opening the app with an empty card reader or USB slot under `tauri dev`.

## Deferred from: Story 1.6 build review (2026-11-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-open-a-file-and-show-it-in-its-folder.md`
  summary: `open_file` calls `ShellExecuteExW` with `hwnd` null, so Windows' "Open with" or error dialog may appear behind the app window; if it does, pass the main window's HWND.
  evidence: Review of Story 1.6 (edge-case-hunter, blind-hunter), unverified (medium if true). Settle under `tauri dev` by opening a file type with no associated app, and a file deleted after listing.

## Deferred from: Story 1.7 build review (2026-11-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-handle-folders-i-cant-open.md`
  summary: Decide whether `walk()` should also skip directories with FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS (partly virtualized contents, which enumerating may fetch), not only RECALL_ON_OPEN ones.
  evidence: Review of Story 1.7 (edge-case-hunter), unverified (medium if true). Skipping them could also stop name search in ordinary OneDrive folders if those carry the bit. Settle on a PC with OneDrive Files On-Demand by reading the attributes of populated and online-only folders, before Epic 2's name search walks Documents.

## Deferred from: Story 1.8 review (2026-11-10)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-browse-with-the-keyboard-alone.md`
  summary: Make Back/Forward step from a pending target, so pressing Alt+← (or the Back button) twice before the first reply goes back two folders, not one.
  evidence: `BrowseSession.back()` reads `backStack.at(-1)`, which only changes when a reply commits. A second press re-requests the same target and cancels the first (latest wins). Predates 1.8 (Story 1.5 buttons); noticeable only on slow folders such as network shares. Review finding EC4.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-browse-with-the-keyboard-alone.md`
  summary: Give the browse list grid or listbox semantics (e.g. `role="grid"`, `aria-multiselectable="false"`) so Narrator announces the arrow-key selection, then verify with Narrator. Medium; target Story 7.3.
  evidence: Rows are `<tr aria-selected tabIndex>` in a plain `<table>`, where `aria-selected` isn't a supported state, so screen readers may not announce selection changes as ↑/↓ move it. The markup predates 1.8 (Story 1.4). Review finding BH5.

## Deferred from: Story 2.1 build (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-search-names-in-this-folder-and-its-subfolders.md`
  summary: `engine::tests::ipc_names_match_protocol_ipc_json` fails whenever `engine.rs` is checked out with CRLF (`core.autocrlf=true`, no `.gitattributes`); add `*.rs text eol=lf` (or make the test ignore `\r`).
  evidence: after `git checkout main` for the 1.9 merge, git rewrote `app/src-tauri/src/engine.rs` with CRLF and the test's `"#[tauri::command]\npub fn engine_send("` search missed; converting the working copy back to LF (no diff vs index) made `cargo test` pass 29/29. Story 2.1 forbids Rust changes, so the durable fix waits.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-search-names-in-this-folder-and-its-subfolders.md`
  summary: Name results accumulate quadratically in `SearchSession` (copy plus notify per 200-match batch), and `name_search` flushes only between folders, so one huge or slow folder holds its matches. Handle both in Story 2.4's measurement and tuning.
  evidence: `app/src/search/session.ts` `[...this.current.matches, ...message.matches]` per batch; `engine/core/search/filename.py` checks FLUSH_AFTER after each walked folder. A drive-root search with ~100k matches makes ~500 batches, each copying the growing array.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-search-names-in-this-folder-and-its-subfolders.md`
  summary: Re-target the Story 1.4 item "split an oversized `folderListing` into several replies on the same id". Multi-message replies now exist (`Channel` `emit`, `ProtocolClient.stream`), so the split can reuse them.
  evidence: the 1.4 entry said multi-message replies "arrive with search, which is the natural time to add both together"; Story 2.1 added the streaming path but kept `folderListing` single-reply.

## Deferred from: code review of spec-2-1-search-names-in-this-folder-and-its-subfolders.md (2026-11-15)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-search-names-in-this-folder-and-its-subfolders.md`
  summary: Same CRLF item as the 2.1 build entry above; review 2 notes that the `.gitattributes` fix is not a Rust change, so it can land any time (renormalize `engine.rs` once).
  evidence: AC2's `cargo test` passes only on the hand-fixed LF working copy; `git status` still shows `M app/src-tauri/src/engine.rs` with an empty `git diff --stat`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-search-names-in-this-folder-and-its-subfolders.md`
  summary: Story 1.9's elevated 10-min network run (`app/scripts/network-check.ps1`, results in `docs/network-check.md`) is still open while Epic 2 is under way; NFR-1 wants it before Phase 2.
  evidence: `sprint-status.yaml` comment on `1-9-confirm-the-app-makes-no-network-connections`, deferred by the author 2026-11-13.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-see-name-results-and-no-matching-files-found.md`
  summary: Names containing bidi control characters (U+202A–202E, U+2066–2069, U+200E/200F) can still reorder or spoof how they display, because `<bdi dir="auto">` doesn't neutralise them inside the name; neither the browse list nor Name matches handles them, and the Correct Display list has no such entry.
  evidence: Unverified, medium if true. To settle it, render a name containing U+202E in the browse list and in ResultList and see whether the extension appears reversed. This has been in the browse list since Story 1.4; Story 7.2 (Hebrew interface) is a natural home for it.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-show-a-file-thumbnail-in-the-preview-panel.md`
  summary: A 10 MB image preview (a ~13 MB JSON line through engine writer → Rust → Tauri event → data: URL) is not measured against the 2 s preview budget or the 5 s ping timeout, nor is holding ↓ through a folder of large photos.
  evidence: Unverified, medium if true. To settle it, time a 10 MB JPG preview and a held ↓ through large photos in `tauri dev` on the Baseline PC; lower `IMAGE_MAX_BYTES` if it misses.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-show-a-file-thumbnail-in-the-preview-panel.md`
  summary: The uncommitted Rename File feature (another session) shares files with Story 2.5 (BrowseList, client.ts, catalog.ts, main.py, windows_fs.py, filesystem.py, codes.json) and needs its own story, review and commit.
  evidence: Found in Story 2.5's review diff: renameFile hunks in shared files, with RenameFile.tsx, core/rename.py and its schemas untracked; it has no story in epics.md and no sprint-status key.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-show-a-file-thumbnail-in-the-preview-panel.md`
  summary: Planning docs still say there is no rename (epics.md UX-DR21 "no ... rename", the Story 1.x row-menu AC "only Open and Show in folder", brief.md, EXPERIENCE.md), contradicting the Rename File work's F2 and menu item.
  evidence: epics.md:124 and :344 as cited by the Story 2.5 blind-hunter review; only the PRD records the Rename exception.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-show-a-file-thumbnail-in-the-preview-panel.md`
  summary: `FileSystemPort.create_file`'s docstring still calls it "the port's only write", now false with `rename_file`.
  evidence: engine/core/ports/filesystem.py create_file docstring, made stale by the Rename File work.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-show-a-file-thumbnail-in-the-preview-panel.md`
  summary: `WindowsFileSystem.rename_file` has three edge cases: an isdir-then-os.rename race could rename a folder, `str.casefold` differs from Windows case mapping (e.g. "straße"/"STRASSE"), and an in-use source (winerror 32) is reported as fileExists when the new name exists.
  evidence: engine/adapters/windows_fs.py rename_file, from the Story 2.5 edge-case-hunter review; Rename File's own review should verify them.
