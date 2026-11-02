# Epic 1 Context: Browse and open my files

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver a working, offline Windows 11 file browser that feels like a calmer File Explorer: users browse local drives and folders (opening on Documents), navigate with breadcrumbs, history and typed paths, open files in their default app, use in-app "Show in folder", and get a plain message for folders they can't open. The epic also lays the foundation every later epic builds on: the repository laid out to the agreed structure with pinned versions, the Tauri shell spawning the Python engine as a sidecar over a stdin/stdout JSON-lines channel, engine crash recovery, the Windows 11 theme and layout (RTL-ready from day one), full keyboard operation, and measured proof that the app makes no network connections. Phase done when: the app runs from source, lists a real folder via the engine, navigates, opens a file, and shows the access-denied message.

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

- Browse list: name, type, size, last-modified for files and folders; every column sortable (click again reverses). App opens on the user's Documents folder.
- Navigation: into subfolder, Up, Back/Forward history, clickable breadcrumb ancestors, typed/pasted path (valid opens; invalid shows "This folder doesn't exist." and keeps the current folder).
- Double-click/Enter opens a file in its Windows default app; "Show in folder" navigates inside the app to the containing folder and selects the file.
- Access-denied folder shows "You don't have permission to open this folder."; the app keeps working and Back still works.
- Engine failure: banner "The search stopped working. Trying again…"; browsing that doesn't need the engine stays usable; no stack trace, error code or technical text is ever shown.
- Privacy: zero network connections from the app process, its WebView2 processes and the engine. WebView2 endpoints are recorded under a firewall log this phase and disabled by configuration; any that can't be disabled is reported to the author before Phase 2. The EdgeUpdate runtime updater counts as Windows, not the app.
- Read-only on user files: never write, move, delete or rename. Context menu offers only "Open" and "Show in folder".
- Every core action works with the keyboard alone.
- Hard constraints: no database; offline only; fixed stack; Windows 11 only; simplicity first (no abstraction or performance work beyond a current requirement); public repo, synthetic fixtures only.

## Technical Decisions

- **Layout:** `app/` (Tauri + React + Tailwind; `src-tauri/` Rust; `src/` views, catalog, generated protocol types, protocol client); `engine/` with `core/`, `core/ports/`, `core/rules/`, `adapters/`, `main.py`; `protocol/` (JSON Schemas, `examples/`, message-code list); `fixtures/`.
- **Pinned stack (now fixed; the code owns patch bumps):** `tauri` 2.12.5, `tauri-build` 2.7.4, `tauri-plugin-single-instance` 2.5.5, `@tauri-apps/cli` / `@tauri-apps/api` 2.12.4; `react` / `react-dom` 19.3.1 with `@types/*` 19.3.0; TypeScript 7.0.2 (no `@typescript/typescript6`, no lint setup yet); `tailwindcss` / `@tailwindcss/vite` 4.3.3; `vite` 8.3.5, `@vitejs/plugin-react` 6.2.1, `vitest` 5.0.5, `json-schema-to-typescript` 16.0.0, `ajv` 8.20.0, npm; Python 3.14.10 with dev-only `pytest` 9.2.0, `jsonschema` 4.26.0; uv 0.13.6; Rust stable-msvc (1.99.1) + VS 2022 Build Tools C++. PyInstaller 6.22.3 is recorded but not installed until packaging (Epic 3). ONNX Runtime, tokenizers and NumPy are not needed in this epic.
- **Hexagonal engine:** all product rules in `engine/core`; core imports only `core/ports` (FileSystemPort, ExtractorPort, EmbedderPort, IndexStorePort, SettingsPort). An import-direction test fails if core imports adapters, ONNX Runtime, the file system or JSON storage. Core tests use fake adapters.
- **Transport:** sidecar talks only over stdin/stdout, one UTF-8 JSON object per line, flushed per line. Engine forces UTF-8, redirects `sys.stdout` and fd 1 to the log so real stdout carries only protocol, and writes through one writer queue on one thread. No TCP/HTTP listener anywhere.
- **Envelope:** request `{id, type, ...}`; replies echo `id`; error `{id, type:"error", code, data}`; events `{id:null, type, ...}`. Every request ends with exactly one terminal reply; unknown type → `unknownRequest`; oversized messages split across replies on the same `id`; `type`/`code` values camelCase. Each message type is a JSON Schema with an example; TS types generated at build time; engine validates in debug builds; both sides' tests parse every example.
- **Lifecycle:** stdio loop first; `ready {protocolVersion}` within 1 s; `listFolder` and `status` served at once. Liveness = `ping` answered within a fixed time. Only Rust spawns/restarts/kills the sidecar (never JS); restart kills the whole old process tree and waits; exponential backoff, and after a fixed number of failures the banner stays and restarts stop. On restart the UI ends pending requests locally and re-requests `status` after `ready`. Single instance: a second launch focuses the existing window.
- **Thin UI:** no product rules in the UI. The engine sends codes plus data, never sentences (e.g. `browse.accessDenied`). One catalog in `app/`, keys `context.code`, owns all text and date/number formatting (English only this epic).
- **File access:** everything goes through FileSystemPort `list()`/`walk()` plus one core `is_candidate(entry)` that skips hidden/system items, `~$*` lock files and junction/symlink loops. Attributes come from directory enumeration; never open a file with `RECALL_ON_DATA_ACCESS`, never descend a directory with `RECALL_ON_OPEN`. The shell's only direct OS call is "open with default app".
- **Concurrency & paths:** latest-wins per channel (a new `listFolder` cancels the running one); long operations check cancel tokens between directories. The engine normalizes incoming paths; the protocol carries original-case display paths as strings (never URLs); dates are ISO 8601.
- **Logs and errors:** local rotating logs in `%LOCALAPPDATA%\FileBrowser2\logs\`, paths and codes only; every failure maps to a protocol error code that the UI maps to a catalog string.
- **WebView2:** never set `additionalBrowserArgs` unless it re-includes `msSmartScreenProtection` in `--disable-features`.

## UX & Interaction Patterns

- **Look:** shadcn/ui themed toward Windows 11, following the Windows light/dark setting. Light/dark: background #FFFFFF/#1C1C1C, surface-pane #F3F3F3/#202020, primary #0F6CBD/#479EF5, selection #CFE4FA/#0F3A5F. `destructive` only for real failures (engine down), never for empty or access-denied states. Segoe UI Variable, body 15px/1.45, body-sm 13px, title 20px/600, scaling with Windows text size. Radii 4 (rows, inputs), 6 (Search Bar, buttons, banners), 8 (dialogs, popovers); pill chips. Flat panes split by tone and a 1px border; shadows only on popovers and dialogs.
- **Window:** top bar (back/forward/up, breadcrumb bar, Search Bar area up to 640px, 44px high, gear), filter bar, nav pane 240px / main list / Preview Panel area 320px, 28px status bar; 36px rows; minimum 960×600.
- **RTL readiness:** CSS logical properties and Tailwind `rtl:`/`ltr:` only, so `dir="rtl"` on the root mirrors everything. Names and path segments isolated (`<bdi>`/`dir="auto"`), extensions stay at the end, segments keep real path order.
- **Browse list:** single click selects, double-click/Enter opens, right-click/Shift+F10/Menu key opens the context menu; single selection. Skeleton rows up to 300 ms. Empty states (outline icon + one sentence): "This folder is empty.", "You don't have permission to open this folder."
- **Nav pane:** "Search folders" heading (empty until Epic 3), then Documents, Desktop, Downloads, then local drives; current location highlighted.
- **Keyboard:** Alt+←/→ back/forward, Alt+↑ parent, Alt+D edit path, ↑/↓ selection, Enter open, Shift+F10 context menu, Ctrl+Shift+E show in folder, F5 reloads the folder (never the WebView). Tab order: top bar → filter bar → nav pane → main list → Preview Panel → status bar, with an always-visible 2px primary focus ring. No drag-and-drop, multi-select or rename.
- **Voice:** plain everyday words; never "index", "backend", error codes or stack traces.

## Cross-Story Dependencies

- 1.1 is the base: layout, sidecar, protocol and tests. 1.2 builds on its lifecycle. 1.3 provides the shell, theme and catalog that 1.4–1.8 render into. 1.4's `listFolder` and `is_candidate()` are reused by 1.5–1.7 and by name search in Epic 2. 1.8 wires shortcuts for actions from 1.4–1.6. 1.9 runs on the app built from this epic.
- In-app "Show in folder" (1.6) is reused by result lists from Story 2.2. FileSystemPort `walk()` and the OneDrive/loop rules (1.7) are reused by Filename Search and indexing. Hebrew strings and the mirrored layout arrive in Epic 7.
