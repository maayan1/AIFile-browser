---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-AIFile-browser-2026-10-26/prd.md
  - _bmad-output/planning-artifacts/prds/prd-AIFile-browser-2026-10-26/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-AIFile-browser-2026-11-02/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-AIFile-browser-2026-10-30/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-AIFile-browser-2026-10-30/EXPERIENCE.md
---

# File Browser 2.0 - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for File Browser 2.0, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: Browse local folders. The user can open any local drive or folder and see its files and subfolders with name, type, size and last-modified date; the app opens on Documents at launch; every column is sortable; Hebrew, English and mixed-direction names have Correct Display. (Phase 1)
FR-2: Navigate. Into a subfolder, up to the parent, back and forward through history, and to any ancestor via clickable breadcrumbs; typing or pasting a valid path opens it, an invalid path shows a message and keeps the current folder. (Phase 1)
FR-3: Open a file or its folder. From the browser view or any Result List, double-click or Enter opens the file in its Windows default app; "Show in folder" navigates the app to the containing folder and selects the file. (Phase 1)
FR-4: Respect Windows permissions. An access-denied folder shows "You don't have permission to open this folder." and the app keeps working. (Phase 1)
FR-5: Search by full or partial name. Enter in the Search Bar finds files and folders whose names contain the text, in the current folder and all subfolders; case-insensitive; Hebrew and English; an extension typed as text matches like any text; carries EARS-01. (Phase 2)
FR-6: Filename results. Show name, location and last-modified date with the FR-3 actions; Correct Display; the user can cancel a running search; permission-skipped folders don't stop it; in Phases 2–3 a finished search with no results shows "No matching files found" (EARS-03), never after a cancel. (Phase 2)
FR-7: Choose Indexed Folders. First launch suggests Documents and Desktop, indexed only after the user confirms; folders can be added and removed later; nothing outside them is indexed; removing a folder deletes its data from the Index. (Phase 3)
FR-8: Extract text from Supported Documents. TXT, text-based PDF, DOCX and MD split into Passages; Hebrew in correct logical order including PDFs; unreadable files (scanned, password-protected, corrupted) skipped with a recorded reason and still findable by name; online-only OneDrive files never downloaded, skipped with "Stored only in OneDrive"; TXT/MD decoded as UTF-8 or Windows-1255. (Phase 3)
FR-9: Build the Index in the background. One Embedding per Passage with the bundled model, stored as plain files; never blocks the UI; shows "Reading your documents: 340 of 2,100"; browsing and Filename Search work during indexing; after a close mid-indexing, the next start continues where it stopped. (Phase 3)
FR-10: Update the Index incrementally. On startup and on "Check for new documents"; only added, modified, renamed and deleted Supported Documents are processed; modified = last-modified time or size differs; an unchanged ~5,000-document update finishes in < 60 s on the Baseline PC; no live file watching. (Phase 3)
FR-11: Index status and reset ("Search folders" in the UI). Shows Indexed Folders, document count, last update, skipped files with reasons and unsupported files counted by extension; the user can rebuild or delete all Index data; it explains and is never needed for accurate results. (Phase 3)
FR-12: One Search Bar, both kinds of results. Enter runs Filename Search and Smart Search; results in two labeled groups "Name matches" and "Content matches"; a one-word query that matches filenames still shows content matches; Filename Search uses the text with the Date Phrase removed; a date-only query follows FR-23. (Phase 4)
FR-13: Search by meaning. Content matches by meaning, not only exact words; Hebrew and English queries; during indexing returns matches from documents indexed so far with "Indexing in progress: results may be incomplete"; cross-language matching not required. (Phase 4)
FR-14: Recognize simple Date Phrases. Fixed rules, no AI, Hebrew and English: exact date, date range (including cross-month), month, year, today/yesterday, last/previous week/month/year, "a week/month/year ago" and Hebrew equivalents; numeric dates day first; no year = most recent such period on or before today; weeks Sunday–Saturday; unrecognized phrases are ordinary text; a fixed list of ≥ 60 phrases (30 HE, 30 EN) with negative cases passes 100%. (Phase 4)
FR-15: Date Filter and Type Filter. Date presets (Last week/month/year) or custom range, Type Filter (PDF, Word, Text, Markdown); active Filters always visible and clearable with one click, re-running the search; phrase-set and hand-set Date Filters look and behave the same; a cleared phrase is not recognized again for that query (except date-only, FR-23); both Filters apply to Content matches, the Type Filter also to Name matches; Word = .docx and .doc, only .docx can be a content match. (Phase 4)
FR-16: Ranked results with a Match Reason. Content matches ranked best first with name, location, Activity Date and a Match Reason (best Passage, about two lines, plus each satisfied Filter); no generative model; no word highlighting. (Phase 4)
FR-17: Uncertain and empty results. Best results above the Relevance Floor; below the Close Match threshold labeled Close Match; at most 20 content matches, at most 5 Close Matches; floor tuned so ≥ 10 nonsense queries return nothing while SM-1 stays ≥ 80% (incl. ≥ 4 of 5 one-word queries), SM-1 wins but "xyz123" always returns nothing; no results with Filters → "No matches from …" with one-click clear per Filter; no results without Filters → "No matching files found" (EARS-03) + "Try different words" + the "Can't find a file you know is there?" explanation linking to Search folders; that link also at the end of any Result List; a cancelled search shows neither. (Phase 4)
FR-18: English and Hebrew interface. Follows the Windows display language, English fallback, no manual switch; Hebrew layout fully RTL; mixed text has Correct Display in both layouts; every user-visible string exists in both languages. (Phase 5)
FR-19: Standalone Windows installer. One installer with app, Python backend and runtime, and embedding model; works with the network disabled; no extra installs; unsigned, with README SmartScreen steps. (Phase 5)
FR-20: Manual updates. A new installer run by hand; the app never checks for updates; keeps Indexed Folders and Index; an Index format change triggers an automatic rebuild with a notice. (Phase 5)
FR-21: Clean uninstall. Removes the app; asks whether to delete the app's data; never touches user files. (Phase 5)
FR-22: Preview the selected file. Preview Panel beside the file list and Result List; selected file's name, location, type, size, last-modified date, and for TXT/text-based PDF/DOCX/MD in any folder the first 2,000 characters of text, read only on selection and never stored; "Select a file to preview" while no file is selected (EARS-02); unreadable/unsupported/online-only files show details and a plain reason, never download; within 2 s on the Baseline PC; read-only; keyboard operable. (Phase 3)
FR-23: Date-only search. A recognized Date Phrase plus only filler words (fixed list, no AI) lists every Supported Document whose Activity Date is in range, newest first, up to 50, Type Filter applies, Name matches hidden, no Relevance Floor or Close Match; hint "Remember what it was about? Add a word to narrow it down." (dismissible, never blocking, no follow-up question); empty range → "No documents from …" with one-click clear; clearing the Date Filter of a date-only search clears the whole search and returns to browsing; results within 2 s; "I worked on a document last week" / "עבדתי על מסמך בשבוע שעבר" are date-only, "budget last week" is not. (Phase 4)

EARS requirements (PRD §4.0), carried by the FRs above:
EARS-01 (FR-5): When the user enters a search term, the app shall display every file and folder in the current folder and its subfolders whose name contains the search term. Test: `report.pdf`, `photo.jpg`, `report-final.docx`; searching `report` shows only `report.pdf` and `report-final.docx`.
EARS-02 (FR-22): While no file is selected, the app shall display a "Select a file to preview" message in the Preview Panel. Test: no selection, a folder selected, and selection cleared (clicking an empty area) all show the message.
EARS-03 (FR-6, FR-17): If a search has finished with no results and no Filters are active, then the app shall display a "No matching files found" message in the Result List. Test: `report.pdf` and `photo.jpg`, no Filters, `xyz123` → no Name or Content matches and the message; Phase 2 Filename Search only, from Phase 4 both groups with the SM-1 Index.

### NonFunctional Requirements

NFR-1: Privacy. Zero network connections by the app (app process, its WebView2 processes, Python backend) during install and use; no telemetry, crash reporting or update checks; Windows itself, programs opened from the app, and the WebView2 runtime's own updater are not counted; WebView2 process connections are recorded in Phase 1 and disabled by configuration, any that can't be disabled reported before Phase 2; verified with the network disabled and a firewall log.
NFR-2: Smart Search performance. < 6 s from Enter to results on the Baseline PC with ~5,000 documents, for 90% of SM-1 queries after the first search; first search after launch ≤ 10 s.
NFR-3: Filename Search performance. < 6 s for ~50,000 files on the Baseline PC, measured like NFR-2.
NFR-4: Indexing performance. ~5,000 documents in < 30 min in the background; UI never freezes > 0.5 s during indexing.
NFR-5: Baseline PC. Windows 11 64-bit, 8 GB RAM, 4-core CPU, no GPU/NPU; Windows 11 only.
NFR-6: Resource use. Background-priority indexing; ≤ 2 GB RAM for the whole app.
NFR-7: Installer size ≤ 1 GB including Python runtime and model.
NFR-8: Data safety. Never modifies, moves or deletes user files; a crash or power loss never leaves a corrupted Index; worst case it rebuilds itself.
NFR-9: Local security. Backend reachable only by the app; Index data in the current user's profile (%LOCALAPPDATA%).
NFR-10: Error handling. Plain-language messages in the interface language for every user-facing error, no stack traces or codes; if the backend stops, the app shows a message and recovers without losing the Index.
NFR-11: Accessibility. Every core action (browse, search, set Filters, open, show in folder) works with the keyboard alone.
NFR-12: Licensing. Every bundled model and library allows redistribution in a free public GitHub release.

Constraints (PRD §6), binding on every story:
C-1: No database (no SQL, vector DB or DBMS); Index = JSON + embedding files.
C-2: Offline only; no cloud services, external AI, accounts or sync.
C-3: Exactly one local embedding model; no generative or OCR models; Date Phrases by fixed rules; model give-way order: license/offline > SM-1 > NFR-7 > speed.
C-4: Read-only on user files.
C-5: Fixed stack: React + TypeScript, Tailwind CSS, Tauri, bundled Python backend, one local embedding model, local JSON + embedding files, Windows 11.
C-6: Simplicity first; no abstractions or performance work beyond a current requirement or a measured NFR miss; each phase delivers working, testable software.
C-7: Public repository; no secrets or personal documents; SM-1 fixtures synthetic or freely licensed.

Success metrics that need test assets: SM-1 (30 queries, 15 HE/15 EN, ≥ 5 one-word, over ≥ 500 synthetic HE/EN documents incl. look-alikes, ≥ 80% top-5 and ≥ 4 of 5 one-word), SM-2 (= NFR-2), SM-3 (= NFR-4), SM-4 (= NFR-1, firewall log), SM-5 (3 non-technical testers install, choose folders and find a known document without help).

### Additional Requirements

From the architecture spine (AD ids are stable and should be cited by stories):

- **No starter template.** The architecture does not name a starter. Epic 1 Story 1 scaffolds the repository to the spine's layout (`app/` Tauri + React + Tailwind, `engine/` with `core/`, `core/ports/`, `core/rules/`, `adapters/`, `protocol/`, `fixtures/`), pins exact versions (Tauri 2.12, React 19.3, TypeScript 7 + `@typescript/typescript6` for lint tooling, Tailwind 4.3, Python 3.14, ONNX Runtime 1.31, tokenizers 0.23, NumPy 2.5, PyInstaller 6.22, uv) and wires the sidecar.
- AR-1 (AD-1): Hexagonal engine: all product rules in `engine/core`; core imports only `core/ports` (FileSystemPort, ExtractorPort, EmbedderPort, IndexStorePort, SettingsPort); indexing is the pipeline scan → check → extract → chunk → embed → commit; a failing file gets a `ReadOutcome`, never stops the pipeline.
- AR-2 (AD-2): Sidecar over stdin/stdout, one UTF-8 JSON object per line, flushed per line; engine forces UTF-8, reserves real stdout for protocol (redirects `sys.stdout`/fd 1 to the log), one writer queue/thread; every request has an `id` echoed by replies; events use `id: null`; oversized messages split across replies; no TCP/HTTP listener.
- AR-3 (AD-3): Thin UI: no product rules in the UI; engine sends message codes + data and notice codes, never sentences; one EN/HE string catalog in `app/` owns all text and date/number formatting.
- AR-4 (AD-4): All file access through FileSystemPort with one `list()` and one `walk()` and a core `is_candidate()` (skip hidden/system, `~$*` lock files, junction/symlink loops); never open `RECALL_ON_DATA_ACCESS` files nor descend `RECALL_ON_OPEN` directories; ExtractorPort `extract(path, max_chars|None)` with size cap and timeout (`tooLarge`, `cannotRead`); "Show in folder" is in-app navigation; the shell's only direct OS call is "open with default app".
- AR-5 (AD-5): Single writer: only the indexing pipeline writes the Index; add/remove/check/rebuild/delete are commands recorded in `settings.json` then acknowledged; Remove preempts the current batch and readers exclude removed folders immediately; commands are not cancellable; nested folders are a no-op; unreachable folders keep entries and report a status; readers see committed snapshots handed over in-process.
- AR-6 (AD-6): Index in `%LOCALAPPDATA%\FileBrowser2\index\`: `manifest.json` (version, format version, model id, model SHA-256, dimension, pooling, prefixes, max tokens, chunking), `meta-<v>.json`, `vec-<v>.npy`; per document identity key, display path, `mtime_ns`, size, Passages, ReadOutcome; per folder unsupported files `{path, ext}` up to a cap; commit = temp + fsync + `os.replace` (retry on sharing errors) then manifest; commit cadence N docs / T seconds; `.npy` loaded fully, no mmap, `allow_pickle=False`; startup cleanup of temp/orphan versions; unreadable files quarantined → rebuild; any manifest mismatch → never load old version, serve empty + rebuild with `indexingActive`; every update re-checks skipped files and recounts unsupported.
- AR-7 (AD-7): In-memory snapshot + in-memory list sorted by local Activity Date (never persisted); date-only = range slice, no model call, includes documents with a ReadOutcome; Date/Type Filter pre-select Passages before scoring; brute force; document score = best Passage; floor, threshold, top-20 and 5-Close-Match caps on documents; Type Filter hides folders from Name matches.
- AR-8 (AD-8): One embedding model behind EmbedderPort `embed_query`/`embed_passages`; adapter owns tokenization, prefixes, pooling, returns L2-normalized float32, score = dot; ONNX Runtime CPU + tokenizers + NumPy only (no PyTorch/transformers/sentence-transformers/optimum); one shared ONNX session; primary granite-embedding-97m-multilingual-r2, fallback multilingual-e5-small, chosen by an SM-1 bake-off (fp32 and int8, AVX2-only CPU) then frozen; tuning keyed by model id.
- AR-9 (AD-9): Change key `mtime_ns` + size; Activity Date converted to a local date at load; ranges computed by the engine in local time, inclusive days, weeks Sunday–Saturday; ISO 8601 in the protocol; identity key `casefold(NFC(normpath(long path)))` internal only, original-case display path in the protocol; engine normalizes incoming paths.
- AR-10 (AD-10): One engine process: one indexing worker (below-normal priority, ONNX intra-op threads = cores − 1, yields between files) + a small user-request pool; indexing extraction in one child process; latest-wins per channel (`search`, `preview`, `listFolder`); cancel tokens checked between files/directories.
- AR-11 (AD-11): No network code anywhere; local rotating logs in `%LOCALAPPDATA%\FileBrowser2\logs\` with paths and codes only (no document text, Passages or queries); errors as codes; synthetic fixtures; uninstall "delete data" removes the whole `FileBrowser2` folder.
- AR-12 (AD-12): PyInstaller `--onedir --clean`; exe via `externalBin` with target triple, `_internal/` and the model via `bundle.resources`; VC++ 14.x DLLs app-local; NSIS with WebView2 `offlineInstaller`; NSIS hook stops a running sidecar; never set `additionalBrowserArgs` without `msSmartScreenProtection`; Phase 1 firewall-log story for WebView2 endpoints; generated `THIRD_PARTY_NOTICES`; Windows-only builds; packaged engine first run on a clean Windows 11 VM (Defender on, Smart App Control evaluation) in Phase 3 with size recorded.
- AR-13 (AD-13): `%LOCALAPPDATA%\FileBrowser2\settings.json` holds Indexed Folders, first-run outcome, last check time and pending one-time notices; independent schema; written only by the engine, atomically, before acknowledging; untouched by rebuild/delete; notices cleared on UI acknowledgment; window/panel state stays with the shell.
- AR-14 (AD-14): Single-instance app (Tauri plugin); only Rust spawns/restarts/kills the sidecar; engine holds an exclusive `index\.lock` or exits with a defined code; restart kills the old process tree and waits.
- AR-15 (AD-15): One `search` request `{id, text, folder, dateFilter?, typeFilter?, literalPhrases[]}`; ordered replies `searchParsed` → `nameMatches` (not in dateOnly) → `contentMatches` | `dateOnlyResults` → exactly one terminal `searchDone {outcomeCode?, notices[], indexVersion, indexingActive}` or `cancelled`; engine decides `mode`; chip label = resolved range; Phase 2 returns `searchParsed`, `nameMatches`, `searchDone`; one `parse_query(text, literal_phrases)` with shared normalization (punctuation, case, Hebrew prefixes ה ו ב ל מ); first Date Phrase only.
- AR-16 (AD-16): Stdio loop starts first; `ready {protocolVersion}` within 1 s; `listFolder`, filename search and `status` served immediately while model and Index load in the background; `ping` liveness; exponential restart backoff and a persistent banner after repeated failures; UI ends pending requests on restart and re-requests `status`; `status` snapshot (phase, done/total, count, last check, folder states); `indexProgress` and `indexVersionChanged` events are hints.
- Conventions: TS types generated from `protocol/` schemas; engine validates in debug builds; `protocol/examples/` parsed by tests on both sides; catalog keys `context.code`, a test asserts EN + HE strings for every code; one `ReadOutcome` enum mapped to Search folders groups by the core; Type Filter as tokens `pdf|word|text|markdown` mapped in `core/rules`; rule data (date patterns, filler words, tuning, caps, timeouts, cadence) under `engine/core/rules/`; fixtures in `fixtures/` (FR-14 ≥ 60 phrases with the filler list, ≥ 10 nonsense queries, SM-1 queries + ≥ 500-doc synthetic collection, EARS fixtures, Correct Display test names); core tests use fake adapters; CSS logical properties and `rtl:`/`ltr:` from Phase 1.
- Deferred to dedicated stories: Phase 3 Hebrew PDF spike (pdfminer.six + bidi fix vs pdf_oxide vs pypdf; pin version; record whether reordering is automatic; redistributable license); Phase 3–4 embedding bake-off; exact patch pinning in the first story; tuning values from fixtures.
- From the PRD addendum: Date Phrase rules as regexes + HE/EN month tables, stripping Hebrew prefixes ב/מ/ל with optional hyphen; FR-14 list kept as a plain data file; direction-neutral CSS from Phase 1; README "More info → Run anyway" SmartScreen steps; test the Phase 5 installer on a clean PC early.

### UX Design Requirements

UX-DR1: Implement DESIGN.md tokens as the shadcn/ui theme on Tailwind: light/dark pairs (background #FFFFFF/#1C1C1C, surface-pane #F3F3F3/#202020, primary #0F6CBD/#479EF5 with foregrounds, selection #CFE4FA/#0F3A5F, notice-info #EBF3FC on #0F548C / #082338 on #9CCBF8, close-match #FFF4CE on #7A4D00 / #3D2E00 on #FFD86B), following the Windows light/dark setting; errors use shadcn `destructive` only for real failures.
UX-DR2: Typography ramp in Segoe UI Variable (Text/Display, Hebrew-capable): body 15px/1.45, body-sm 13px, search-input 18px, excerpt 14px/1.5, group-label 13px/600 +0.02em, title 20px/600; sizes scale with Windows text size.
UX-DR3: Shapes and spacing: radii 4/6/8 and pill chips; Tailwind 4-based spacing; nav-width 240px, preview-width 320px, row-height 36px, search-height 44px; flat panes separated by tone and 1px border, shadows only on popovers and dialogs.
UX-DR4: Main window layout: top bar (back/forward/up, breadcrumb bar, Search Bar up to 640px, gear), filter bar, nav pane / main list / Preview Panel, 28px status bar; whole layout mirrors in Hebrew.
UX-DR5: Search Bar component: magnifier start icon, 1px primary border (2px focused), placeholder "Search by name, or describe what you remember", clear ✕ once text exists, spinner while searching; runs only on Enter; Esc cancels a running search or clears and returns to browse; `dir="auto"`.
UX-DR6: Breadcrumb bar: clickable segments; Alt+D or click on empty area turns it into an editable path; Enter opens a valid path; invalid path shows "This folder doesn't exist." under the field and keeps the current folder.
UX-DR7: Filter chips: Date chip opens a Popover with presets "Last week", "Last month", "Last year" and a from–to Calendar; Type chip opens a DropdownMenu with PDF, Word, Text, Markdown checkboxes; active chips show their value with ✕; each change re-runs the search; phrase-set and hand-set chips identical; clearing a phrase-set chip puts the phrase back into the bar as ordinary text.
UX-DR8: File list (browse): columns name/type/size/modified with click-to-sort and reverse; single click selects and updates Preview; double-click/Enter opens; right-click or Shift+F10 opens the context menu ("Open", "Show in folder" only); single selection; selected row in selection color.
UX-DR9: Result List: "Name matches (n)" then "Content matches (n)" as separate groups with counts; Name matches appear as soon as ready; arrow keys move across groups; at most 20 content matches, at most 5 Close Matches at the end; no paging.
UX-DR10: Content result row: icon + name (+ Close match label), location and Activity Date in body-sm muted, Match Reason excerpt up to two lines, satisfied-Filter tags; no word highlighting; "Show in folder" leaves search view, navigates and selects (Ctrl+Shift+E).
UX-DR11: Close Match label component ("Close match", close-match colors, text label so it never relies on color).
UX-DR12: Notice banner component (notice-info) for "Indexing in progress: results may be incomplete", the date-only hint, "Search stopped.", the permissions notice and the one-time upgrade notice.
UX-DR13: Preview Panel: surface-pane 320px; icon, title, details (location, type, size, modified), text preview in a ScrollArea (selectable, read-only); states: "Select a file to preview" (no selection or folder), text preview, no-preview reasons ("No preview for this file type", "This file can't be read", "Stored only in OneDrive"), loading skeleton with details first; toggle via top-bar icon or Alt+P, remembered.
UX-DR14: Status bar: "Reading your documents: 340 of 2,100" + thin progress bar during first indexing, "Checking for changed documents…" on startup update, "Up to date · N documents" when idle; click opens Search folders.
UX-DR15: Empty states: outline icon, one sentence, up to two secondary buttons; "This folder is empty.", "You don't have permission to open this folder.", "No matching files found" + "Try different words.", "No matches from …" with "Clear date filter"/"Clear type filter", "No documents from …" with "Clear date filter", "Choose folders to search inside your documents." with "Choose folders".
UX-DR16: "Can't find a file you know is there?" info box under the EARS-03 empty state (three reasons, "Try searching for a word from its name instead.", links "See files I can't search inside" → Search folders section ②, "Search folders"), plus a one-line "Can't find a file you know is there? See why" at the end of any Result List.
UX-DR17: Date-only results view: single group "Documents from <range> (n)", newest first with day and time, up to 50, Type Filter applies, no Close Match labels, dismissible hint "Remember what it was about? Add a word to narrow it down." (neutral wording in Hebrew), clearing the Date Filter exits the search.
UX-DR18: First-run folder chooser dialog: heading "Which folders should I search inside?", one explanatory line, "Your files stay on this computer.", checkbox list with Documents and Desktop pre-checked and full paths, "+ Add folder…" (Windows picker), "Skip for now", primary "Start"; nothing read until Start.
UX-DR19: "Search folders" dialog (never shows the word "index"): lead line; ① Folders I search inside with Remove, "+ Add folder…", "✓ Up to date · N documents · last checked today at 9:14 AM" and "Check for new documents"; ② Files I can't search inside, groups with counts and first-person one-line explanations (scanned documents and pictures, older Word files .doc, other file types, password-protected, stored only in OneDrive), each expandable to file list with locations, "There's nothing you need to fix."; ③ Advanced collapsed: start over and delete what I've learned, each with a plain confirmation that user files are not touched; "Done". Reachable from gear, status bar and the Can't-find links.
UX-DR20: Nav pane: "Search folders" heading listing Indexed Folders, then Documents, Desktop, Downloads, then local drives; current location highlighted.
UX-DR21: Keyboard map: Ctrl+E/Ctrl+F focus Search Bar; Enter search; Esc cancel/clear; Alt+D path; Alt+←/→ back/forward; Alt+↑ parent; ↑/↓ selection with Preview; Enter opens; Shift+F10/Menu key context menu; Ctrl+Shift+E show in folder; Alt+P preview toggle; F5 reloads the current folder (not the WebView); no drag-and-drop, multi-select or rename.
UX-DR22: Accessibility: keyboard-only for every core action incl. preview; WCAG 2.2 AA; tab order follows (mirrored) reading order; visible 2px primary focus ring; Narrator polite live region for result counts and progress (≤ once per 10 s), Close Match announced; 200% text scaling without clipping (two-line wrap, ellipsis, full name in tooltip and Preview); forced-colors support; no color-only meaning; reduced motion respected.
UX-DR23: Bidirectional text: whole-window mirroring in Hebrew with directional icons mirrored; names, paths, Passages isolated (`<bdi>`/`dir="auto"`); extensions stay at the end; path segments in real order, each isolated; locale date/number formats ("Oct 14, 2025" / "14 באוק׳ 2025"); isolated numbers in progress text; verified against the fixed Correct Display test-name list across browse list, both result groups and Preview.
UX-DR24: Responsive window: ≥ 1280px all three panes; 960–1279px Preview hidden by default and opens as a side overlay with Alt+P; minimum window 960×600; window size, position and Preview toggle remembered.
UX-DR25: Voice and tone: all strings plain and jargon-free per the EXPERIENCE.md Voice table (no "index", "embedding", "query", "backend", error codes), first-person app voice in the folder chooser and Search folders, fixed PRD strings verbatim, every string in EN and HE (Hebrew written by the author).
UX-DR26: Global backend-failure banner "The search stopped working. Trying again…" while browsing that doesn't need the engine stays usable; disappears on recovery.
UX-DR27: Loading states: browse skeleton rows up to 300 ms; Search Bar spinner while results already found stay visible; cancelled search keeps found results with "Search stopped.".

### FR Coverage Map

FR-1: Epic 1 - Browse local folders
FR-2: Epic 1 - Navigate (subfolder, parent, history, breadcrumbs, typed path)
FR-3: Epic 1 - Open a file, show in folder
FR-4: Epic 1 - Respect Windows permissions
FR-5: Epic 2 - Search by full or partial name (EARS-01)
FR-6: Epic 2 - Filename results, cancel, "No matching files found" in Phases 2–3 (EARS-03)
FR-7: Epic 3 - Choose Indexed Folders
FR-8: Epic 3 - Extract text from Supported Documents
FR-9: Epic 3 - Build the Index in the background
FR-10: Epic 3 - Update the Index incrementally
FR-11: Epic 3 - Search folders status and reset
FR-12: Epic 5 - One Search Bar, both kinds of results
FR-13: Epic 5 - Search by meaning
FR-14: Epic 6 - Recognize simple Date Phrases
FR-15: Epic 6 - Date Filter and Type Filter
FR-16: Epic 5 - Ranked results with a Match Reason
FR-17: Epic 5 - Uncertain and empty results (EARS-03 for both groups)
FR-18: Epic 7 - English and Hebrew interface
FR-19: Epic 8 - Standalone Windows installer
FR-20: Epic 8 - Manual updates
FR-21: Epic 8 - Clean uninstall
FR-22: Epic 4 - Preview the selected file (EARS-02)
FR-23: Epic 6 - Date-only search

## Epic List

### Epic 1: Browse and open my files
Users can browse local drives and folders, navigate with breadcrumbs and history, open files in their default app, use "Show in folder", and get a clear message for folders they can't open. The first story sets up the project to the architecture spine and connects the UI to the engine.
**FRs covered:** FR-1, FR-2, FR-3, FR-4 (Phase 1)

### Epic 2: Find files by name
Users can search file and folder names in the current folder and its subfolders, see name results, cancel a search, and get "No matching files found" when nothing matches.
**FRs covered:** FR-5, FR-6 (Phase 2)

### Epic 3: Let the app read my documents
Users choose which folders the app searches inside; the app reads their documents in the background with the local model, resumes after interruptions, stays up to date, and explains in "Search folders" what it read and what it couldn't.
**FRs covered:** FR-7, FR-8, FR-9, FR-10, FR-11 (Phase 3)

### Epic 4: Preview a file before opening it
Users see the selected file's details and the start of its text in the Preview Panel, in any folder, before opening it.
**FRs covered:** FR-22 (Phase 3)

### Epic 5: Find documents by what they're about
Users describe what they remember in Hebrew or English and get ranked content matches with a Match Reason, labeled Close Matches, no unrelated results, and help when nothing is found.
**FRs covered:** FR-12, FR-13, FR-16, FR-17 (Phase 4)

### Epic 6: Find documents by when I worked on them
Users can use date phrases in a search, filter by date and file type, and list the documents from a period when they don't remember the topic.
**FRs covered:** FR-14, FR-15, FR-23 (Phase 4)

### Epic 7: Use the app in Hebrew
Users whose Windows is in Hebrew get the whole interface in Hebrew, right to left, with mixed Hebrew and English text shown correctly, and the app meets its accessibility floor.
**FRs covered:** FR-18 (Phase 5)

### Epic 8: Install, update and uninstall
Users install the app with one offline installer, update it by hand without losing their folders, and uninstall it cleanly.
**FRs covered:** FR-19, FR-20, FR-21 (Phase 5)

## Epic 1: Browse and open my files

Users can browse local drives and folders, navigate with breadcrumbs and history, open files in their default app, use "Show in folder", and get a clear message for folders they can't open. The first story sets up the project to the architecture spine and connects the UI to the engine.

### Story 1.1: Set up the project and connect the UI to the engine

As the builder,
I want the repository laid out as the architecture spine says, with the Tauri shell starting the Python engine and the two exchanging messages,
So that every later story builds on one agreed structure and one working channel.

**Acceptance Criteria:**

**Given** an empty repository
**When** the story is done
**Then** the top level contains `app/` (Tauri + React + TypeScript + Tailwind), `engine/` with `core/`, `core/ports/`, `core/rules/`, `adapters/` and `main.py`, `protocol/` with `examples/`, and `fixtures/` (AD-1, spine Structural Seed)
**And** exact versions are pinned after checking current releases (Tauri 2.12.x, React 19.3.x, TypeScript 7.x plus `@typescript/typescript6` if lint tooling needs it, Tailwind 4.3.x, Python 3.14.x, PyInstaller 6.22.x, uv), and the pinned versions are recorded in the spine's Stack table

**Given** the app is started from source on Windows 11
**When** the window opens
**Then** only the Rust side of the shell spawns the engine as a sidecar; JavaScript never spawns it (AD-14)
**And** a second launch of the app focuses the existing window instead of starting a second instance

**Given** the engine has started
**When** it is ready
**Then** it sends a `ready` event with `protocolVersion` within 1 s (AD-16)
**And** stdin and stdout are forced to UTF-8, the real stdout carries only protocol lines, `sys.stdout` and fd 1 are redirected to the log, and all protocol output goes through one writer queue (AD-2)
**And** a `ping` request is answered with a reply carrying the same `id`

**Given** the `protocol/` folder
**When** a message type is added
**Then** it is a JSON Schema with an example in `protocol/examples/`, TypeScript types are generated from the schemas at build time, and engine and UI tests parse every example (spine conventions)
**And** automated tests pass for a `ping` round trip and for a Hebrew string (for example "סיכום ישיבה") echoed back unchanged

**Given** `engine/core`
**When** the import-direction test runs
**Then** it fails if any module under `core/` imports from `adapters/`, ONNX Runtime, the file system or JSON storage (AD-1)

### Story 1.2: Recover when the engine stops

As Yossi,
I want the app to keep working and tell me plainly when its search engine stops,
So that a crash never leaves me stuck or confused.

**Acceptance Criteria:**

**Given** the app is running
**When** the engine process exits unexpectedly or doesn't answer `ping` within the fixed time
**Then** the shell kills the whole old process tree, waits for it to end and starts a new engine (AD-14, AD-16)
**And** the banner "The search stopped working. Trying again…" is shown (UX-DR26, NFR-10)
**And** every pending request is ended locally in the UI, so no spinner keeps turning

**Given** the engine fails to start again and again
**When** restarts happen
**Then** they back off exponentially, and after the fixed number of failures the banner stays visible and restarts stop

**Given** the engine is back
**When** it sends `ready`
**Then** the banner disappears and the UI re-requests `status`
**And** no stack trace, error code or technical text is ever shown to the user (NFR-10, AD-11)

### Story 1.3: Main window layout and visual style

As Yossi,
I want a calm, familiar window that looks like Windows 11,
So that I feel at home and don't have to learn a new tool.

**Acceptance Criteria:**

**Given** the app opens
**When** the main window is shown
**Then** it has the top bar (back, forward, up, breadcrumb bar, Search Bar area up to 640 px, gear), the filter bar, the nav pane (240 px), the main list, the Preview Panel area (320 px) and a 28 px status bar (UX-DR4)
**And** the minimum window size is 960×600

**Given** the DESIGN.md tokens
**When** the theme is applied
**Then** shadcn/ui is themed with the light and dark color pairs, the Segoe UI Variable type ramp (body 15 px), radii 4/6/8, pill chips, 36 px rows and a 44 px Search Bar (UX-DR1, UX-DR2, UX-DR3)
**And** the app follows the Windows light/dark setting
**And** focus is always shown as a 2 px primary ring

**Given** the layout code
**When** it is reviewed
**Then** it uses only CSS logical properties and Tailwind `rtl:`/`ltr:` variants, so setting `dir="rtl"` on the root mirrors the whole window with no other change (FR-18 readiness)
**And** every UI string comes from one catalog in `app/` (English only for now) keyed `context.code` (AD-3)

### Story 1.4: Browse a folder

As Dana,
I want to open a folder and see its files and subfolders with their details,
So that I can find my way around my documents inside the app.

**Acceptance Criteria:**

**Given** the app starts
**When** the main window is ready
**Then** it shows the user's Documents folder (FR-1)
**And** the list comes from a `listFolder` request that the engine answers through FileSystemPort (AD-4), before the model or Index are loaded (AD-16)

**Given** a folder is open
**When** the list is shown
**Then** each row has an icon, name, type, size and last-modified date, for both folders and files
**And** clicking a column header sorts by it, and clicking again reverses the order (FR-1)
**And** hidden and system items and Office lock files (`~$*`) are not listed, using the core's `is_candidate()` (AD-4)

**Given** names in Hebrew, English and mixed direction (for example `סיכום ישיבה 3.docx`, `Budget תקציב.pdf`)
**When** they are listed
**Then** each name is isolated (`<bdi>` / `dir="auto"`) and the extension stays at the end (UX-DR23)

**Given** a folder takes time to list
**When** it loads
**Then** skeleton rows show for up to 300 ms, then the list (UX-DR27)
**And** an empty folder shows "This folder is empty." (UX-DR15)
**And** a new `listFolder` request cancels the previous one on the same channel (AD-10)

### Story 1.5: Navigate folders

As Dana,
I want to move between folders the way I do in File Explorer,
So that I can reach any folder quickly.

**Acceptance Criteria:**

**Given** a folder is open
**When** I double-click or press Enter on a subfolder
**Then** the app opens it; Up opens the parent; Back and Forward move through the history (FR-2)

**Given** the breadcrumb bar shows `Documents › Volunteering`
**When** I click a segment
**Then** that ancestor opens, and the segments keep the real path order, each one isolated (UX-DR6, UX-DR23)

**Given** I click the empty area of the breadcrumb bar or press Alt+D
**When** I type or paste a valid path and press Enter
**Then** that folder opens, and the engine normalizes the path it receives (AD-9)
**And** an invalid path shows "This folder doesn't exist." under the field and the current folder stays open (FR-2)

**Given** the nav pane
**When** the app is open
**Then** it shows a "Search folders" heading (empty until Epic 3), then Documents, Desktop and Downloads, then the local drives, with the current location highlighted (UX-DR20)

### Story 1.6: Open a file and show it in its folder

As Yossi,
I want to open a file in its usual program, or jump to the folder it's in,
So that I can act on what I find without switching to File Explorer.

**Acceptance Criteria:**

**Given** a file is selected in the list
**When** I double-click it or press Enter
**Then** the shell asks Windows to open it in its default app, and the UI reads none of its content (FR-3, AD-4)

**Given** a file row
**When** I right-click it or press Shift+F10 or the Menu key
**Then** a context menu offers only "Open" and "Show in folder", with no rename, delete or move (UX-DR8, C-4)

**Given** the in-app "show in folder" action receives the path of a file in another folder (verified by an automated UI test now; result lists use it from Story 2.2)
**When** it runs, from the context menu or Ctrl+Shift+E
**Then** the app navigates inside the app to the containing folder and selects the file (FR-3, AD-4)
**And** no user file is ever written, moved or deleted (NFR-8)

### Story 1.7: Handle folders I can't open

As Yossi,
I want a plain message when a folder is off-limits,
So that the app never crashes or confuses me.

**Acceptance Criteria:**

**Given** a folder I don't have permission to read
**When** I open it
**Then** the main list shows "You don't have permission to open this folder." and Back still works (FR-4, UX-DR15)
**And** the engine replies with the code `browse.accessDenied`, never a stack trace (AD-3, AD-11)

**Given** a OneDrive file or folder that is online-only
**When** the engine lists or opens items
**Then** it reads attributes from directory enumeration, never opens a file with `RECALL_ON_DATA_ACCESS` set, and never descends into a directory with `RECALL_ON_OPEN` set (AD-4)
**And** no download is triggered (FR-8, NFR-1)

**Given** junctions or symlinks that loop (for example `My Music` inside Documents)
**When** the engine lists or walks folders
**Then** it does not follow the loop (AD-4)

### Story 1.8: Browse with the keyboard alone

As a keyboard user,
I want every browsing action to work without a mouse,
So that I can use the app however I prefer.

**Acceptance Criteria:**

**Given** the main window
**When** I use the keyboard
**Then** Alt+← and Alt+→ go back and forward, Alt+↑ goes to the parent, Alt+D edits the path, ↑ and ↓ move the selection, Enter opens, Shift+F10 opens the context menu and Ctrl+Shift+E shows in folder (UX-DR21, NFR-11)
**And** F5 reloads the current folder and never reloads the WebView

**Given** I press Tab repeatedly
**When** focus moves
**Then** it follows top bar → filter bar → nav pane → main list → Preview Panel → status bar, always with a visible focus ring (UX-DR22)

### Story 1.9: Confirm the app makes no network connections

As Yossi,
I want proof that the app doesn't talk to the internet,
So that I can trust it with my personal documents.

**Acceptance Criteria:**

**Given** the app built from this epic, on Windows 11 with networking on
**When** it is used for 10 minutes under a firewall log (or Procmon)
**Then** every remote endpoint contacted by the app process, its WebView2 processes and the engine is recorded in a short report in the repository (NFR-1, AD-12)
**And** WebView2 SmartScreen stays disabled: `additionalBrowserArgs` is unset, or it re-includes `msSmartScreenProtection`

**Given** the recorded endpoints
**When** one comes from the app's WebView2 processes
**Then** it is disabled by configuration and the run is repeated until no app connection remains
**And** any endpoint that can't be disabled is reported to the author before Phase 2 starts
**And** connections from the WebView2 runtime updater (EdgeUpdate) are listed as Windows, not the app (NFR-1)

## Epic 2: Find files by name

Users can search file and folder names in the current folder and its subfolders, see name results, cancel a search, and get "No matching files found" when nothing matches.

### Story 2.1: Search names in this folder and its subfolders

As Yossi,
I want to type part of a file name and press Enter,
So that I find files and folders by name even deep inside subfolders.

**Acceptance Criteria:**

**Given** the Search Bar (magnifier icon, placeholder "Search by name, or describe what you remember", clear ✕ once there is text, `dir="auto"`)
**When** I type, nothing runs; when I press Enter
**Then** the UI sends one `search` request `{id, text, folder}` and the engine replies on that `id` with `searchParsed`, then `nameMatches`, then exactly one terminal `searchDone` (AD-15, UX-DR5)
**And** a spinner replaces the magnifier while the search runs

**Given** a folder containing `report.pdf`, `photo.jpg` and `report-final.docx`
**When** I search for `report`
**Then** only `report.pdf` and `report-final.docx` are returned (EARS-01, FR-5)
**And** matching is case-insensitive and works for Hebrew and English names; a folder named `reports` would also match; `.pdf` typed as text matches like any text

**Given** the engine walks the folder tree
**When** it searches
**Then** it uses FileSystemPort `walk()` with the core's `is_candidate()`, never opens files, and never descends into `RECALL_ON_OPEN` directories (AD-4)

### Story 2.2: See name results and "No matching files found"

As Dana,
I want clear name results with their locations, and a plain message when nothing matches,
So that I know right away whether the file is there.

**Acceptance Criteria:**

**Given** a finished name search with results
**When** they are shown
**Then** the main list shows the group "Name matches (n)" with each item's name, location and last-modified date; names and paths are isolated and extensions stay at the end (FR-6, UX-DR9, UX-DR23)
**And** each result supports Open and Show in folder from Story 1.6 (FR-3)

**Given** a folder containing `report.pdf` and `photo.jpg`
**When** I search for `xyz123` and the search finishes
**Then** the message "No matching files found" and "Try different words." are shown (EARS-03 for Phases 2–3, FR-6, UX-DR15)
**And** the decision comes from the engine's `searchDone` `outcomeCode`, not from the UI (AD-3)

**Given** results are shown
**When** I press Esc or click ✕ in the Search Bar
**Then** the search view closes and the browse view of the current folder returns

### Story 2.3: Cancel a search, and keep going past folders I can't open

As Yossi,
I want to stop a slow search or start a new one at any time,
So that I'm never stuck waiting for results I no longer need.

**Acceptance Criteria:**

**Given** a search is running
**When** I press Esc
**Then** the UI sends `cancel` for that `id`, the engine stops between directories and sends the terminal `cancelled` (AD-10, AD-15)
**And** results already found stay, the notice "Search stopped." appears, and "No matching files found" is never shown after a cancel (FR-6, UX-DR27)

**Given** a search is running
**When** I press Enter on a new search
**Then** the previous search on the `search` channel is cancelled and only the latest search's results are shown (AD-10)

**Given** some subfolders can't be read
**When** the search finishes
**Then** results from readable folders are shown with the notice "Some folders couldn't be searched because you don't have permission." (FR-6, FR-4)

### Story 2.4: Keep name search fast in very large folders

As the builder,
I want name search measured on a large folder tree,
So that I know it meets its speed target before adding anything heavier.

**Acceptance Criteria:**

**Given** a generated synthetic tree of ~50,000 files in `fixtures/` (or a generator script for it)
**When** name searches run on the Baseline PC (Windows 11, 8 GB RAM, 4 cores), measured from Enter to results on screen
**Then** 90% finish in under 6 seconds (NFR-3), and the measurement is recorded in the repository
**And** no filename cache is added unless this measurement misses the target (C-6, spine Deferred)

## Epic 3: Let the app read my documents

Users choose which folders the app searches inside; the app reads their documents in the background with the local model, resumes after interruptions, stays up to date, and explains in "Search folders" what it read and what it couldn't.

### Story 3.1: Choose folders on first launch

As Yossi,
I want the app to ask once which folders to search inside, with sensible suggestions,
So that it reads only what I allow.

**Acceptance Criteria:**

**Given** the app starts and `settings.json` has no first-run outcome
**When** the main window opens
**Then** the folder chooser shows "Which folders should I search inside?", one explanatory line, "Your files stay on this computer.", a checkbox list with Documents and Desktop checked (with full paths), "+ Add folder…" (Windows folder picker), "Skip for now" and the primary "Start" (FR-7, UX-DR18)

**Given** I press Start
**When** the engine receives the command
**Then** it writes the Indexed Folders and the outcome "started" to `%LOCALAPPDATA%\FileBrowser2\settings.json` atomically (temp, fsync, `os.replace`) before acknowledging (AD-13)
**And** no document is read before Start (FR-7)

**Given** I press Skip for now
**When** the app restarts later
**Then** the chooser does not appear again, browsing and name search work, and the nav pane's "Search folders" stays empty (AD-13)

**Given** `settings.json`
**When** its schema is defined
**Then** it is independent of the index format version, and the engine is its only writer (AD-13)

### Story 3.2: Read text from Word, text and Markdown files

As Dana,
I want the app to read the text inside my Word, text and Markdown files in Hebrew and English,
So that it can later find them by what they're about.

**Acceptance Criteria:**

**Given** ExtractorPort `extract(path, max_chars | None)` (AD-4)
**When** it reads a DOCX (python-docx), TXT or MD file
**Then** it returns the text in logical reading order; TXT and MD are decoded as UTF-8, or as Windows-1255 when UTF-8 fails (FR-8)

**Given** a file that is too large or makes extraction hang
**When** it is extracted
**Then** the size cap and wall-clock timeout from `engine/core/rules/` produce the outcomes `tooLarge` or `cannotRead` instead of blocking (AD-4)

**Given** password-protected, corrupted or online-only files
**When** they are processed
**Then** each gets one value of the core `ReadOutcome` enum (`passwordProtected`, `cannotRead`, `storedOnlyInOneDrive`), online-only files are never opened, and the pipeline continues (FR-8, AD-1, conventions)

**Given** a batch of files to extract
**When** the extraction runner is used
**Then** it runs extraction in one child process, returns text and `ReadOutcome` values to its caller and never writes the Index; the indexing worker in Story 3.5 will own this runner (AD-10)
**And** core tests cover extraction outcomes with fake adapters and synthetic Hebrew/English fixtures

### Story 3.3: Read Hebrew PDFs correctly

As Dana,
I want Hebrew text from my PDFs read in the right order,
So that Hebrew PDFs are as findable as Word files.

**Acceptance Criteria:**

**Given** 10 synthetic or freely licensed Hebrew and mixed Hebrew/English text-based PDFs in `fixtures/`, including ones that store text in visual order
**When** the spike compares pdfminer.six (with a bidi fix), pdf_oxide and pypdf
**Then** a short report in the repository records, for each, the extracted text quality (logical order, broken words), whether visual-to-logical reordering is automatic or caller-driven, its exact tested version and its license (spine Deferred, NFR-12)

**Given** the report
**When** a library is chosen (logical order correct on all 10, redistributable license)
**Then** it is implemented behind ExtractorPort with the same caps, timeout and `ReadOutcome` values as Story 3.2 (AD-4)
**And** scanned or image-only PDFs return `noTextLayer` (FR-8, C-3: no OCR)

### Story 3.4: Turn documents into searchable passages with the local model

As the builder,
I want each document split into passages and turned into embeddings by the one bundled model,
So that the app can later search by meaning on an ordinary processor.

**Acceptance Criteria:**

**Given** EmbedderPort `embed_query(text)` and `embed_passages(texts)` (AD-8)
**When** the ONNX adapter runs granite-embedding-97m-multilingual-r2 on the CPU
**Then** it uses ONNX Runtime, `tokenizers` and NumPy only (no PyTorch, transformers, sentence-transformers or optimum), owns tokenization, prefixes and pooling, and returns L2-normalized float32 vectors of dimension 384
**And** one ONNX session is shared, and the model and ONNX Runtime versions are pinned (Stack)

**Given** extracted text
**When** it is chunked
**Then** the Passage size and overlap come from `engine/core/rules/`, and the chunking parameters, model id, model SHA-256, dimension, pooling, prefixes and max tokens are the values the manifest will record (AD-6)

**Given** two Hebrew passages with similar meaning and one unrelated passage in `fixtures/`
**When** they are embedded
**Then** the similar pair scores higher by dot product than either does with the unrelated one (smoke test)

### Story 3.5: Read my documents in the background

As Yossi,
I want the app to read my documents in the background while I keep using it,
So that it gets ready to search by meaning without getting in my way.

**Acceptance Criteria:**

**Given** Indexed Folders in `settings.json`
**When** indexing runs
**Then** one below-normal-priority indexing worker runs scan → check → extract → chunk → embed → commit, using the extraction runner from Story 3.2 and the embedder from Story 3.4; it is the only writer of the Index, caps ONNX intra-op threads at cores − 1 and yields between files (AD-5, AD-10, FR-9)
**And** browsing and name search keep responding, and the UI never freezes for more than 0.5 s (NFR-4)

**Given** a batch is committed
**When** the commit happens
**Then** `meta-<v>.json` and `vec-<v>.npy` are written as temp files, flushed and fsynced, renamed with `os.replace`, and only then is `manifest.json` replaced, with retries on Windows sharing errors; commits happen at most every N documents or T seconds (AD-6)
**And** the manifest records the index format version, model id, model SHA-256, dimension, pooling, prefixes, max tokens and chunking parameters from Story 3.4 (AD-6)
**And** each document stores identity key, display path, `mtime_ns`, size, Passages and any `ReadOutcome`; each folder stores unsupported files as `{path, ext}` up to the cap (AD-6, AD-9)
**And** readers get each committed snapshot in-process and never see a partial one (AD-5)

**Given** indexing is running
**When** the status bar is shown
**Then** it reads "Reading your documents: 340 of 2,100" with a thin progress bar, from `status` snapshots and `indexProgress` hints, and "Up to date · N documents" when idle (UX-DR14, AD-16)

### Story 3.6: Never lose the app's work after a crash

As Yossi,
I want the app to pick up where it left off after a shutdown or power cut,
So that I never lose its work and never get a broken app.

**Acceptance Criteria:**

**Given** the engine starts
**When** it opens the Index
**Then** it first takes an exclusive lock on `index\.lock`, and if it can't, it exits with the defined code so the shell waits and retries (AD-14)
**And** it deletes temp files and any versions the manifest doesn't name, tolerating locked files (AD-6)

**Given** the app is closed or the PC loses power mid-indexing
**When** the app starts again
**Then** it loads the last committed version fully (no mmap, `allow_pickle=False`) and continues indexing without re-processing committed documents (FR-9, NFR-8, AD-6)

**Given** an unreadable `meta-<v>.json` or `vec-<v>.npy`, or a manifest that doesn't match the shipped engine (including a newer format)
**When** the engine starts
**Then** the bad files are quarantined or the old version is not loaded, and a rebuild starts with `indexingActive` set; the engine never crashes on load (AD-6, NFR-8)

**Given** a synthetic collection of ~5,000 documents on the Baseline PC
**When** it is indexed from scratch, including one forced close halfway
**Then** it finishes in under 30 minutes in total and the app stays at or under 2 GB RAM; both are measured and recorded (NFR-4, NFR-6, SM-3, PRD §8.3 Phase 3)

### Story 3.7: Keep up with new and changed documents

As Yossi,
I want the app to notice documents I added, changed, renamed or deleted,
So that search always reflects my files.

**Acceptance Criteria:**

**Given** the app starts, or the engine receives the `checkForNewDocuments` command (the button that sends it is added in Story 3.8)
**When** the update runs
**Then** only documents whose `mtime_ns` or size changed, plus added and deleted ones, are processed; a rename is a remove plus an add (FR-10, AD-9)
**And** the status bar shows "Checking for changed documents…" while it runs (UX-DR14)
**And** the last check time is saved in `settings.json` (AD-13)

**Given** skipped and unsupported files
**When** any update runs
**Then** every skipped file is re-checked (for example a OneDrive file that is now downloaded) and unsupported counts are recounted, not only changed files (AD-6)

**Given** an unchanged collection of ~5,000 documents on the Baseline PC
**When** an update runs
**Then** it finishes in under 60 seconds, measured and recorded (FR-10)

**Given** an Indexed Folder on a drive that is unplugged
**When** an update runs
**Then** its documents are kept and the folder is reported with an unreachable status code (AD-5)

### Story 3.8: See and manage Search folders

As Yossi,
I want one plain screen that shows which folders the app searches inside and which files it couldn't read,
So that I understand why a file might be missing and can change my folders.

**Acceptance Criteria:**

**Given** I click the gear in the top bar or the status bar
**When** the "Search folders" dialog opens
**Then** it never shows the word "index" and has: the lead line "I search inside the documents in these folders. Every other file can still be found by its name."; ① Folders I search inside, with Remove per folder, "+ Add folder…" and "✓ Up to date · N documents · last checked today at 9:14 AM" with "Check for new documents", which sends the `checkForNewDocuments` command from Story 3.7; ② Files I can't search inside; ③ Advanced (collapsed); and "Done" (FR-11, UX-DR19, UX-DR14)

**Given** section ②
**When** it is shown
**Then** groups come from the engine as group codes with counts (scanned documents and pictures; older Word files, .doc; other file types; password-protected; stored only in OneDrive), each with a first-person one-line explanation and "There's nothing you need to fix."; each group expands to its files and locations (FR-11, conventions)

**Given** I add or remove a folder
**When** I confirm
**Then** the engine writes `settings.json`, acknowledges, and the pipeline acts; a Remove preempts the current batch and its documents disappear from results right away; adding a folder nested inside an Indexed Folder changes nothing; a document stays while any Indexed Folder covers it (AD-5, AD-13)
**And** the nav pane's "Search folders" list updates (UX-DR20)

**Given** section ③ Advanced
**When** I choose "start over" or "delete what I've learned"
**Then** a plain confirmation says my files are not touched; start over rebuilds the Index, delete removes Index data; neither touches `settings.json`; commands are not affected by `cancel` (FR-11, AD-5, AD-13)

### Story 3.9: Package the engine and check it on a clean PC

As the builder,
I want the engine frozen and run on a clean Windows 11 PC,
So that packaging surprises show up in Phase 3, not at release.

**Acceptance Criteria:**

**Given** the engine
**When** it is built with PyInstaller `--onedir --clean`
**Then** the exe is registered via `externalBin` with the Windows target-triple suffix, and `_internal/`, the model file and the VC++ 14.x runtime DLLs are bundled via `bundle.resources` beside it (AD-12)

**Given** a clean Windows 11 VM with Defender on and Smart App Control in evaluation mode
**When** the packaged app starts
**Then** the engine starts, sends `ready`, browses and indexes a small fixture folder, and any Defender or Smart App Control block is recorded (AD-12)
**And** the packaged size of the app, engine and model is recorded against the 1 GB limit (NFR-7, PRD §8.3 Phase 3)

## Epic 4: Preview a file before opening it

Users see the selected file's details and the start of its text in the Preview Panel, in any folder, before opening it.

### Story 4.1: Preview Panel with file details and "Select a file to preview"

As Dana,
I want a panel beside the list that shows the selected file's details,
So that I can check it's the right file before opening it.

**Acceptance Criteria:**

**Given** a folder with files and nothing selected
**When** the main window is shown
**Then** the Preview Panel shows "Select a file to preview" (EARS-02, FR-22)
**And** the same message shows when a folder is selected, and when the selection is cleared by clicking an empty area of the list

**Given** I select one file
**When** the panel updates
**Then** it shows the icon, the name as the title, and the location, type, size and last-modified date (UX-DR13), with names and paths isolated (UX-DR23)

**Given** the window
**When** I press Alt+P or click the panel icon in the top bar
**Then** the panel hides or shows and the choice is remembered; at 960–1279 px wide it is hidden by default and opens as a side overlay; window size and position are remembered (UX-DR24)

### Story 4.2: Preview the start of a document's text

As Dana,
I want to read the first part of a document in the panel,
So that I can recognize it without opening it.

**Acceptance Criteria:**

**Given** a selected TXT, text-based PDF, DOCX or MD file in any folder, indexed or not
**When** the panel updates
**Then** the engine reads it on selection through ExtractorPort with `max_chars` 2,000 and shows the text read-only and selectable in a scroll area; nothing is stored in the Index (FR-22, AD-4)
**And** the details appear at once and the text area shows a skeleton until the text arrives (UX-DR13)

**Given** a file with no text preview
**When** it is selected
**Then** the panel shows its details and a plain reason from its `ReadOutcome`: "No preview for this file type", "This file can't be read" or "Stored only in OneDrive"; online-only files are never opened (FR-22, AD-4)

**Given** I hold ↓ through a folder of PDFs
**When** the selection changes quickly
**Then** each new `preview` request cancels the previous one on the `preview` channel, so previews never queue up (AD-10)

**Given** a typical document on the Baseline PC
**When** I select it
**Then** the preview appears within 2 seconds (FR-22)
**And** a Hebrew DOCX inside an Indexed Folder and another DOCX outside the Indexed Folders both show their text (PRD §8.3 Phase 3)

## Epic 5: Find documents by what they're about

Users describe what they remember in Hebrew or English and get ranked content matches with a Match Reason, labeled Close Matches, no unrelated results, and help when nothing is found.

### Story 5.1: Search my documents by meaning

As Michael,
I want to describe a document and get content matches as well as name matches,
So that I find documents I can't name.

**Acceptance Criteria:**

**Given** an indexed collection
**When** I press Enter on a query
**Then** the same `search` request now also returns `contentMatches` after `nameMatches`, and the Result List shows "Name matches (n)" and "Content matches (n)"; a one-word query that matches names still shows content matches (FR-12, AD-15, UX-DR9)
**And** the engine embeds the query with `embed_query`, scores all Passages by dot product (brute force) and gives each document its best Passage's score (AD-7, AD-8)

**Given** a query "employee management system design" and a document that says "HR platform architecture"
**When** I search
**Then** that document appears in Content matches (FR-13)
**And** Hebrew and English queries both work; cross-language matching is not required

**Given** indexing is still running
**When** I search
**Then** content matches come from the documents committed so far, and `searchDone.notices` includes `indexingInProgress`, shown as the banner "Indexing in progress: results may be incomplete" (FR-13, UX-DR12)

**Given** no Indexed Folders yet
**When** I search
**Then** Content matches shows "Choose folders to search inside your documents." with "Choose folders" (UX-DR15)

### Story 5.2: See why each document matched

As Dana,
I want each result to show the passage that matched,
So that I can tell the right document from look-alikes.

**Acceptance Criteria:**

**Given** content matches
**When** they are shown
**Then** they are ranked best first by document score; each row shows icon and name, location and Activity Date, and the best-matching Passage trimmed to about two lines (FR-16, UX-DR10)
**And** the row has a place for Filter tags, which Story 6.2 fills
**And** no word is highlighted and no generative model is used (FR-16, C-3)

**Given** a content result
**When** I select it, press Enter or choose Show in folder (Ctrl+Shift+E)
**Then** the Preview Panel updates, the file opens, or the app navigates to its folder and selects it (FR-3, UX-DR10)

### Story 5.3: Show close matches and leave out unrelated results

As Yossi,
I want weaker matches clearly labeled and unrelated files left out,
So that I can trust what the app shows me.

**Acceptance Criteria:**

**Given** content matches
**When** some fall below the Close Match threshold
**Then** they appear at the end of Content matches with the "Close match" label, which has text and not only color (FR-17, UX-DR11)
**And** at most 20 content matches and at most 5 Close Matches are shown, counted per document (AD-7)

**Given** the Relevance Floor in `engine/core/rules/`, keyed by model id
**When** a document's score is below it
**Then** it is not shown (FR-17, AD-8)

**Given** the fixed list of at least 10 nonsense queries in `fixtures/`
**When** each is searched against the SM-1 Index
**Then** each returns no content matches, and `xyz123` always does (FR-17)

### Story 5.4: Help me when nothing is found

As Yossi,
I want the app to tell me plainly when nothing matches, and why a file I know exists might be missing,
So that I don't think the app is broken.

**Acceptance Criteria:**

**Given** a folder with `report.pdf` and `photo.jpg`, no Filters, and the Index built from the SM-1 collection
**When** I search for `xyz123`
**Then** no name or content matches are shown, and "No matching files found" and "Try different words." appear (EARS-03, FR-17)
**And** the outcome comes from `searchDone.outcomeCode`; a cancelled search never shows it (AD-15)

**Given** that empty state
**When** it is shown
**Then** the info box "Can't find a file you know is there?" lists the three reasons (scanned document or picture; older Word, Excel or PowerPoint file; a folder I don't search inside), says "Try searching for a word from its name instead.", and links to "See files I can't search inside" (Search folders section ②) and "Search folders" (FR-17, UX-DR16)

**Given** a Result List with results
**When** I reach its end
**Then** the line "Can't find a file you know is there? See why" opens the same explanation (FR-17, UX-DR16)
**And** the explanation never asks me to change anything

### Story 5.5: Measure search quality and choose the model

As the builder,
I want search quality measured on a fixed test set and the model chosen by evidence,
So that Hebrew and English search meets its target before release.

**Acceptance Criteria:**

**Given** `fixtures/` with a synthetic collection of at least 500 mixed Hebrew and English documents including look-alikes, and 30 SM-1 queries (15 Hebrew, 15 English, some with Date Phrases, at least 5 one-word queries such as "pension")
**When** the SM-1 runner executes
**Then** it reports the share of queries whose expected file is in the top 5, and the one-word subset separately; queries that contain Date Phrases run as plain text until Story 6.1, and this is recorded as the first SM-1 run (SM-1, PRD §8.3 Phase 4)

**Given** granite-embedding-97m-multilingual-r2 and multilingual-e5-small, each in fp32 and int8 builds
**When** the bake-off runs on an AVX2-only CPU
**Then** the report records SM-1, indexing speed, search speed, RAM and model size for each, and the model is chosen by C-3's give-way order, then frozen (AD-8)
**And** changing the model forces a full rebuild through the manifest check (AD-6)

**Given** the chosen model
**When** tuning runs
**Then** the Close Match threshold and Relevance Floor are set so SM-1 ≥ 80%, at least 4 of the 5 one-word queries pass, and every nonsense query returns nothing; if both can't be met, SM-1 wins but `xyz123` still returns nothing (FR-17)
**And** NFR-2 is measured (< 6 s for 90% of SM-1 queries after the first search, first search ≤ 10 s) and recorded

## Epic 6: Find documents by when I worked on them

Users can use date phrases in a search, filter by date and file type, and list the documents from a period when they don't remember the topic.

### Story 6.1: Recognize dates in my search

As Dana,
I want the app to understand dates in what I type, in Hebrew and English,
So that "from October 2025" limits the results to that month.

**Acceptance Criteria:**

**Given** one core function `parse_query(text, literal_phrases)` with one normalization (punctuation, case, Hebrew prefixes ה ו ב ל מ with an optional hyphen) (AD-15)
**When** a query contains a Date Phrase from the FR-14 table (exact date, range including cross-month, month, year, today, yesterday, last/previous week/month/year, a week/month/year ago, and the Hebrew forms)
**Then** `searchParsed` returns the resolved range `{from, to, source}`, computed in local time as inclusive days with weeks Sunday–Saturday, and the residual text without the phrase (FR-14, AD-9)
**And** numeric dates are read day first; with no year, the most recent such period on or before today is used; only the first Date Phrase sets the filter

**Given** the Date Phrase test list in `fixtures/` (at least 60 phrases, 30 Hebrew and 30 English, including every example in the PRD and negative cases such as "in the fall" and "March budget.docx")
**When** the tests run
**Then** 100% produce the expected result (FR-14)
**And** phrase patterns and month names live as data in `engine/core/rules/`, and no AI model is used (C-3)

**Given** a recognized Date Phrase
**When** results are returned
**Then** the Date Filter applies to Content matches, Filename Search uses the residual text, and the date pre-filter selects in-range Passages before scoring (FR-12, AD-7)

**Given** the SM-1 runner from Story 5.5
**When** it runs again with Date Phrase recognition in place
**Then** the SM-1 result is recorded again and still meets ≥ 80% (SM-1)

### Story 6.2: Filter results by date and type

As Michael,
I want visible filters for date and file type that I can set and clear,
So that I control exactly what the search covers.

**Acceptance Criteria:**

**Given** the filter bar
**When** I open the Date chip
**Then** I can choose "Last week", "Last month", "Last year" (same definitions as FR-14) or a custom from–to range; when I open the Type chip I can tick PDF, Word, Text and Markdown (FR-15, UX-DR7)
**And** the request carries `dateFilter` as a preset or `{from, to}` and `typeFilter` as tokens `pdf|word|text|markdown`, mapped to extensions in `engine/core/rules/` (Word = .docx and .doc) (AD-15, conventions)

**Given** a Date Phrase set the Date Filter
**When** the chip is shown
**Then** it looks and behaves exactly like a hand-set one, and its label is the resolved range (FR-15, AD-15)

**Given** an active chip
**When** I click its ✕
**Then** the search re-runs without it; for a phrase-set Date Filter the phrase returns to the Search Bar as ordinary text and is sent in `literalPhrases`, so it isn't recognized again (FR-15, AD-15)

**Given** filters are active
**When** results are shown
**Then** both Filters apply to Content matches, the Type Filter also applies to Name matches and hides folders there, and only `.docx` Word files can be content matches (FR-15, AD-7)
**And** each content match shows a tag for each active Filter it satisfies ("Modified Oct 2025", "PDF") in the place Story 5.2 left for it (FR-16, UX-DR10)
**And** with no results the app shows "No matches from Oct 1–31, 2025" with one button per active Filter ("Clear date filter", "Clear type filter") (FR-17, UX-DR15)

### Story 6.3: List my documents from a time when I don't remember the topic

As Dana,
I want "I worked on a document last week" to list last week's documents,
So that I can find a file when all I remember is when.

**Acceptance Criteria:**

**Given** a query whose residual text after the Date Phrase is empty or only filler words from the fixed list in `engine/core/rules/` (for example "I worked on", "document", "file", "עבדתי על", "מסמך", "קובץ"), or a Date Filter with an empty Search Bar
**When** I press Enter
**Then** the engine sets `mode: dateOnly` and returns `dateOnlyResults` without calling the model (FR-23, AD-7, AD-15)

**Given** a date-only search
**When** results are shown
**Then** one group "Documents from Oct 25–31, 2026 (n)" lists every document in the Index with an Activity Date in the range, including ones with a `ReadOutcome`, newest first with day and time, up to 50; the Type Filter applies; Name matches is not shown; there are no Close Match labels (FR-23, UX-DR17)
**And** the dismissible hint "Remember what it was about? Add a word to narrow it down." is shown above the list; it never blocks it and the app asks no follow-up question

**Given** a range with no documents
**When** the search finishes
**Then** "No documents from Oct 25–31, 2026" is shown with "Clear date filter" (FR-23)

**Given** a date-only search
**When** I clear its Date Filter
**Then** the whole search clears and the browse view returns (FR-23, AD-15)

**Given** "I worked on a document last week", "עבדתי על מסמך בשבוע שעבר" and "budget last week" with ~5,000 indexed documents on the Baseline PC
**When** each is searched
**Then** the first two are date-only for the previous calendar week and return within 2 seconds; the third runs Smart Search with the Date Filter set (FR-23)
**And** the filler list is tested together with the FR-14 phrase list (conventions)

## Epic 7: Use the app in Hebrew

Users whose Windows is in Hebrew get the whole interface in Hebrew, right to left, with mixed Hebrew and English text shown correctly, and the app meets its accessibility floor.

### Story 7.1: Show the whole interface in Hebrew or English

As Dana,
I want the app in Hebrew when my Windows is in Hebrew,
So that I can use it in my own language.

**Acceptance Criteria:**

**Given** the string catalog in `app/`
**When** the Windows display language is Hebrew
**Then** every user-visible string, including error messages, notices and Search folders text, is shown in Hebrew; any other language falls back to English; there is no manual language switch (FR-18)
**And** a test fails if any message code in `protocol/` lacks an English or a Hebrew string (conventions)
**And** the Hebrew strings are the author's translations, written in gender-neutral wording, and the voice rules in EXPERIENCE.md are kept (UX-DR25)

**Given** dates and numbers
**When** they are displayed
**Then** they use the interface language's format ("Oct 14, 2025" / "14 באוק׳ 2025") (UX-DR23)

### Story 7.2: Right-to-left layout and correct mixed Hebrew and English text

As Dana,
I want a right-to-left window where Hebrew and English names never get scrambled,
So that everything reads naturally.

**Acceptance Criteria:**

**Given** the Hebrew interface
**When** any screen is shown
**Then** the whole window mirrors (nav pane on the right, Preview Panel on the left), directional icons mirror and non-directional ones don't, and Alt+← / Alt+→ keep their meaning (FR-18, UX-DR23)

**Given** the fixed list of Correct Display test names in `fixtures/`
**When** they appear in the browse list, both result groups, date-only results and the Preview Panel, in both layouts
**Then** each name, path segment and Passage is isolated, extensions stay at the end, path segments keep the real order, and numbers in progress text don't flip, compared against reference screenshots (FR-18, PRD Glossary Correct Display)

**Given** the Search Bar
**When** I type Hebrew in the English interface
**Then** it aligns right, following the first strong character (UX-DR5)

### Story 7.3: Meet the accessibility floor

As a user who relies on Narrator, large text or high contrast,
I want the app to work with Windows accessibility settings,
So that I can use it as well as anyone.

**Acceptance Criteria:**

**Given** Windows Narrator
**When** results arrive or indexing progresses
**Then** result counts ("12 content matches") and progress are announced through a polite live region, progress at most once every 10 seconds, and Close Match rows announce "Close match" before the name (UX-DR22)

**Given** Windows text scaling at 200%
**When** any screen is shown
**Then** no text is clipped; long names wrap to two lines then truncate with an ellipsis, with the full name in a tooltip and the Preview Panel (UX-DR22)

**Given** a Windows contrast theme, or animation effects turned off
**When** the app is used
**Then** Close Match labels and active chips stay distinguishable by text and border, and progress bars and skeletons don't animate (UX-DR22)
**And** every core action, including preview, works with the keyboard alone, and the main screens meet WCAG 2.2 AA (NFR-11)

## Epic 8: Install, update and uninstall

Users install the app with one offline installer, update it by hand without losing their folders, and uninstall it cleanly.

### Story 8.1: Install with one offline installer

As Yossi,
I want one installer that sets everything up without the internet,
So that I install once and I'm done.

**Acceptance Criteria:**

**Given** a Windows-only release build
**When** the installer is built
**Then** it is a Tauri NSIS installer containing the app, the onedir engine with `_internal/`, the model and ONNX Runtime, with WebView2 in `offlineInstaller` mode, an NSIS hook that stops a running engine before copying files, and a generated `THIRD_PARTY_NOTICES` file that includes the model license (FR-19, AD-12, NFR-12)
**And** its size is ≤ 1 GB (NFR-7)

**Given** a clean Windows 11 PC with networking disabled
**When** I install and start the app
**Then** it works fully, with no Python, AI runtime, developer tools or downloads needed (FR-19)

**Given** the installer is not code-signed
**When** the README is read
**Then** it explains step by step how to get past the SmartScreen warning ("More info → Run anyway") (FR-19)

### Story 8.2: Update to a new version and keep my folders

As Yossi,
I want to install a newer version over the old one without losing anything,
So that updates are safe.

**Acceptance Criteria:**

**Given** an installed version with Indexed Folders and an Index
**When** I run a newer installer by hand
**Then** `settings.json` and the Index are kept, and the app never checks for updates on its own (FR-20, AD-13)

**Given** the new version ships a different index format or model
**When** it starts
**Then** the old version is never loaded; the engine serves an empty Index plus what the rebuild commits, with `indexingActive` set, and the one-time notice "Your documents are being re-read for the new version." is stored in `settings.json` until the UI acknowledges it (FR-20, AD-6, AD-13)
**And** an Index format newer than the engine is treated the same way (AD-6)

### Story 8.3: Uninstall cleanly

As Yossi,
I want to remove the app and choose whether its data goes too,
So that nothing is left behind unless I want it.

**Acceptance Criteria:**

**Given** the app is installed
**When** I uninstall it
**Then** I'm asked whether to also delete the app's data; "delete" removes the whole `%LOCALAPPDATA%\FileBrowser2\` folder (Index, `settings.json`, logs), "keep" keeps all of it (FR-21, AD-11)
**And** no user file is ever touched (FR-21, NFR-8)

### Story 8.4: Release check: zero connections and first-run usability

As the builder,
I want the release candidate checked for privacy and for first-time use by real people,
So that the MVP meets its release gate.

**Acceptance Criteria:**

**Given** the release installer on a clean Windows 11 PC with networking on
**When** it is installed and a scripted usage session runs under a firewall log
**Then** the app makes 0 connections (app process, its WebView2 processes and the engine), as NFR-1 defines; the log is kept in the repository (SM-4, NFR-1)

**Given** 3 non-technical testers
**When** each installs the app, chooses folders and finds a known document with Smart Search
**Then** each succeeds without help; following the README's SmartScreen step counts as without help (SM-5)
**And** SM-1 to SM-5 pass, completing the Phase 5 exit (PRD §8.3)
