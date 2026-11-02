# Epic 1 Context: Browse and open my files

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver a working, offline Windows 11 file browser that feels like a calmer File Explorer: users browse local drives and folders (opening on Documents), navigate with breadcrumbs, history and typed paths, open files in their default app, use in-app "Show in folder", and get a plain message for folders they can't open. The epic also lays the foundation every later epic builds on: the repository scaffolded to the agreed layout with pinned versions, the Tauri shell spawning the Python engine as a sidecar over a stdin/stdout JSON-lines channel, engine crash recovery, the Windows 11 visual theme and layout (RTL-ready from day one), full keyboard operation, and a measured proof that the app makes no network connections. Phase exit: the app runs from source, lists a real folder via the engine, navigates, opens a file, and shows the access-denied message.

## Stories

- Story 1.1: Set up the project and connect the UI to the engine
- Story 1.2: Recover when the engine stops
- Story 1.3: Main window layout and visual style
- Story 1.4: Browse a folder
- Story 1.5: Navigate folders
- Story 1.6: Open a file and show it in its folder
- Story 1.7: Handle folders I can't open
- Story 1.8: Browse with the keyboard alone
- Story 1.9: Confirm the app makes no network connections

## Requirements & Constraints

- Browse list shows name, type, size, last-modified for files and folders; every column sortable (click again reverses). App opens on the user's Documents folder.
- Navigation: into subfolder, Up to parent, Back/Forward history, clickable breadcrumb ancestors, typed/pasted path (valid opens; invalid shows "This folder doesn't exist." and keeps the current folder).
- Double-click/Enter opens a file in its Windows default app; "Show in folder" navigates inside the app to the containing folder and selects the file.
- Access-denied folder shows "You don't have permission to open this folder."; app keeps working, Back still works.
- Engine failure: banner "The search stopped working. Trying again…"; browsing that doesn't need the engine stays usable; no stack traces, error codes or technical text ever shown.
- Privacy: zero network connections from the app process, its WebView2 processes and the engine. WebView2 endpoints are recorded under a firewall log this phase and disabled by configuration; anything that can't be disabled is reported to the author before Phase 2. The EdgeUpdate runtime updater counts as Windows, not the app.
- Read-only on user files: never write, move, delete or rename. Context menu offers only "Open" and "Show in folder".
- Every core action works with the keyboard alone.
- Hard constraints: no database; offline only; fixed stack (React + TypeScript, Tailwind, Tauri, bundled Python engine); Windows 11 only; simplicity first (no abstractions or performance work beyond a current requirement); public repo with synthetic fixtures only.
- Baseline PC: Windows 11 64-bit, 8 GB RAM, 4-core CPU, no GPU.

## Technical Decisions

- **Layout:** `app/` (Tauri + React + Tailwind; `src-tauri/` for Rust), `engine/` with `core/`, `core/ports/`, `core/rules/`, `adapters/`, `main.py`; `protocol/` (JSON Schemas + `examples/` + message-code list); `fixtures/`. Pin exact patches after checking releases: Tauri 2.12.x, React 19.3.x, TypeScript 7.x (+ `@typescript/typescript6` only if lint tooling needs it), Tailwind 4.3.x, Python 3.14.x, PyInstaller 6.22.x, uv; record them in the architecture Stack table.
- **Hexagonal engine:** all product rules in `engine/core`; core imports only `core/ports` (FileSystemPort, ExtractorPort, EmbedderPort, IndexStorePort, SettingsPort). An import-direction test fails if core imports adapters, ONNX Runtime, the file system or JSON storage. Core tests use fake adapters.
- **Transport:** engine is a Tauri sidecar talking only over stdin/stdout, one UTF-8 JSON object per line, flushed per line. Engine forces UTF-8 on both streams, redirects `sys.stdout` and fd 1 to the log so real stdout carries only protocol, and writes through one writer queue on one thread. No TCP/HTTP listener anywhere.
- **Envelope:** request `{id, type, ...}`; reply echoes `id`; error `{id, type:"error", code, data}`; events `{id:null, type, ...}`. Every request ends with exactly one terminal reply; unknown type → `unknownRequest`. Oversized messages split across replies on the same `id`. `type`/`code` values are camelCase.
- **Protocol enforcement:** each message type is a JSON Schema with an example; TS types generated from schemas at build time; engine validates in debug builds; both sides' tests parse every example.
- **Lifecycle:** stdio loop starts first; `ready {protocolVersion}` within 1 s; `listFolder` and `status` are served immediately (no waiting on model/Index). Liveness via `ping` answered within a fixed time. Only Rust spawns/restarts/kills the sidecar (never JS); restart kills the whole old process tree and waits; exponential backoff, and after a fixed number of failures the banner stays and restarts stop. On restart the UI ends all pending requests locally and re-requests `status` after `ready`. App is single-instance (Tauri plugin): second launch focuses the existing window.
- **Thin UI:** no product rules in the UI. The engine sends codes plus data, never sentences (e.g. `browse.accessDenied`). One string catalog in `app/`, keys `context.code`, owns all text and all date/number formatting (English only this epic, structured for Hebrew later).
- **File access:** everything goes through FileSystemPort `list()`/`walk()` plus one core `is_candidate(entry)` that skips hidden/system items, Office lock files `~$*`, and junction/symlink loops. Attributes come from directory enumeration; never open a file with `RECALL_ON_DATA_ACCESS`, never descend a directory with `RECALL_ON_OPEN` (no OneDrive downloads). The shell's only direct OS call is "open with default app"; "Show in folder" is in-app navigation.
- **Concurrency:** latest-wins per channel. A new `listFolder` cancels the running one; long operations check cancel tokens between directories.
- **Paths:** engine normalizes incoming paths; protocol carries original-case display paths as strings (never URLs); identity keys stay internal. Dates in the protocol are ISO 8601.
- **Logs and errors:** local rotating logs in `%LOCALAPPDATA%\FileBrowser2\logs\` with paths and codes only; every failure maps to a protocol error code that the UI maps to a catalog string.
- **WebView2:** never set `additionalBrowserArgs` unless it re-includes `msSmartScreenProtection` in `--disable-features`.

## UX & Interaction Patterns

- **Look:** shadcn/ui themed with Windows-like tokens, following the Windows light/dark setting. Light/dark: background #FFFFFF/#1C1C1C, surface-pane #F3F3F3/#202020 (nav pane, Preview Panel, status bar), primary #0F6CBD/#479EF5 (focus, actions, progress only), selection #CFE4FA/#0F3A5F. `destructive` red only for real failures (engine down), never for empty or access-denied states. Segoe UI Variable, body 15px/1.45, body-sm 13px, title 20px/600; sizes scale with Windows text size. Radii 4 (rows, inputs), 6 (search, buttons, banners), 8 (dialogs, popovers); pill chips. Flat panes split by tone and a 1px border; shadows only on popovers and dialogs.
- **Window:** top bar (back/forward/up, breadcrumb bar, Search Bar area up to 640px with 44px height, gear), filter bar, nav pane 240px / main list / Preview Panel area 320px, 28px status bar. Rows 36px. Minimum window 960×600.
- **RTL readiness:** CSS logical properties and Tailwind `rtl:`/`ltr:` only, so `dir="rtl"` on the root mirrors everything. Names and path segments are isolated (`<bdi>`/`dir="auto"`), extensions stay at the end, segments keep real path order.
- **Browse list:** single click selects, double-click/Enter opens, right-click/Shift+F10/Menu key opens the context menu, single selection only, selected row in selection color. Skeleton rows for up to 300 ms while loading. Empty states (outline icon + one sentence): "This folder is empty.", "You don't have permission to open this folder."
- **Nav pane:** "Search folders" heading (empty until folders can be chosen), then Documents, Desktop, Downloads, then local drives; current location highlighted.
- **Keyboard:** Alt+←/→ back/forward, Alt+↑ parent, Alt+D edit path, ↑/↓ selection, Enter open, Shift+F10 context menu, Ctrl+Shift+E show in folder, F5 reloads the current folder (never the WebView). Tab order: top bar → filter bar → nav pane → main list → Preview Panel → status bar. Always-visible 2px primary focus ring. No drag-and-drop, multi-select or rename.
- **Voice:** plain everyday words; never "index", "backend", error codes or stack traces.

## Cross-Story Dependencies

- 1.1 is the base for every story (layout, sidecar, protocol, tests). 1.2 builds on the 1.1 lifecycle. 1.3 provides the shell, theme and catalog that 1.4–1.8 render into. 1.4's `listFolder` and `is_candidate()` are reused by 1.5–1.7 and by name search in Epic 2. 1.8 wires shortcuts for actions from 1.4–1.6. 1.9 runs on the app built from this epic.
- The in-app "Show in folder" action (1.6) is reused by result lists from Story 2.2. FileSystemPort `walk()` and the OneDrive/loop rules (1.7) are reused by Filename Search and indexing. The `search` request and Correct Display test-name list arrive in Epic 2; the Hebrew catalog and mirrored layout arrive in Epic 7.
