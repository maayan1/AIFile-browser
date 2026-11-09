---
title: 'Story 1.1: Set up the project and connect the UI to the engine'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
baseline_commit: '13979791d8397f87cfcdac3982c4310181d456ee'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-AIFile-browser-2026-11-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repo has only planning docs. No later story can start until the agreed layout exists and the UI and engine can exchange messages.

**Approach:** Scaffold `app/` (Tauri 2 + React + TS + Tailwind), `engine/` (hexagonal Python package run with uv), `protocol/` and `fixtures/`, with pinned versions. Rust spawns the engine from source over stdin/stdout JSON lines, the engine replies to `ping` (including a Hebrew echo), and tests lock in the transport, the schemas and the import direction.

## Boundaries & Constraints

**Always:** Only Rust spawns the engine (AD-14). stdin/stdout are UTF-8, one JSON object per line, flushed per line, all output goes through one writer-queue thread, and `sys.stdout` plus fd 1 are redirected to the log (AD-2). Envelope and camelCase per the spine conventions. `ready {protocolVersion: 1}` is sent within 1 s. Every message type is a JSON Schema plus an example. TS types are generated at build time, never committed. Exact versions (below) go into the spine Stack table.

**Never:** No TCP/HTTP listener. No JS-facing shell/spawn permission. No restart/backoff or crash banner (Story 1.2). No window layout, theme or string catalog (Story 1.3). No PyInstaller sidecar binary (Story 3.9). No lint setup, so no `@typescript/typescript6`. No product rules in the UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Startup | engine spawned | `{"id":null,"type":"ready","protocolVersion":1}` ≤ 1 s | N/A |
| Ping | `{"id":"a1","type":"ping"}` | `{"id":"a1","type":"pong"}` | N/A |
| Hebrew echo | `{"id":"a2","type":"ping","text":"סיכום ישיבה"}` | `pong` with `id` `a2` and the identical `text` | N/A |
| Unknown type | `{"id":"a3","type":"nope"}` | `{"id":"a3","type":"error","code":"unknownRequest","data":{}}` | engine keeps running |
| Bad line | `not json`, or JSON without `id`/`type` | `{"id":null,"type":"error","code":"invalidRequest","data":{}}` | engine keeps running; logged |
| Stray print | engine code calls `print()` | text goes to the log, never to the protocol stdout | N/A |
| Second launch | app already running | existing window focused, no second engine | N/A |

**Decisions:**
- Toolchain (user, 2026-11-02): the agent installs everything. It runs winget for VS 2022 Build Tools with the "Desktop development with C++" workload (UAC prompt expected), installs Rust stable-msvc via rustup, runs `uv self update` to 0.13.6, then `uv python install 3.14.10`.
- Spec size (user, 2026-11-02): keep the full spec (about 2,100 tokens) as one story.

</frozen-after-approval>

## Code Map

- No application code exists. Top level: `.claude/`, `_bmad/`, `_bmad-output/`. Do not touch `_bmad/`.
- `ARCHITECTURE-SPINE.md` §Stack (lines 180–197): replace the "pin at Phase 1" cells with the exact versions below. §Structural Seed (lines 199–216) is the layout to create (only folders this story needs, plus `__init__.py`).
- Pinned (checked 2026-11-02): npm `@tauri-apps/cli` 2.12.4, `@tauri-apps/api` 2.12.4, `react`/`react-dom` 19.3.1, `@types/react` 19.3.0, `typescript` 7.0.2, `tailwindcss`/`@tailwindcss/vite` 4.3.3, `vite` 8.3.5, `@vitejs/plugin-react` 6.2.1, `vitest` 5.0.5, `json-schema-to-typescript` 16.0.0, `ajv` latest 8.x; crates `tauri` 2.12.5, `tauri-build` 2.7.4, `tauri-plugin-single-instance` 2.5.5; Python 3.14.10, `pytest` 9.2.0, `jsonschema` 4.26.0 (dev only); PyInstaller 6.22.3 (recorded, not installed); uv 0.13.6. Package manager: npm (pnpm absent).

## Tasks & Acceptance

**Execution:**
- [x] `.gitignore` -- ignore `node_modules/`, `dist/`, `target/`, `.venv/`, `__pycache__/`, `app/src/protocol/generated.ts`.
- [x] `protocol/schemas/{ready,ping,pong,error}.schema.json`, `protocol/examples/*.json`, `protocol/codes.json` -- one schema per type; examples include the Hebrew ping and both error codes; `codes.json` lists `unknownRequest`, `invalidRequest`.
- [x] `engine/pyproject.toml`, `engine/.python-version`, `engine/core/{__init__,ports/__init__,rules/__init__}.py`, `engine/adapters/__init__.py` -- uv project, `requires-python = "==3.14.*"`, dev group pytest + jsonschema.
- [x] `engine/adapters/stdio_transport.py` -- UTF-8 streams, private dup of the real stdout, fd 1/`sys.stdout` → log, writer-queue thread, line reader, dispatch table (`ping`), `unknownRequest`/`invalidRequest`; validates against `protocol/` when `FB2_VALIDATE_PROTOCOL=1`.
- [x] `engine/main.py` -- rotating log at `%LOCALAPPDATA%\FileBrowser2\logs\engine.log`, starts the transport, sends `ready` first.
- [x] `engine/tests/test_stdio_roundtrip.py` -- subprocess tests for every matrix row except second launch, including ready ≤ 1 s.
- [x] `engine/tests/test_protocol_examples.py` -- every example validates against the schema its `type` names; every error code is in `codes.json`.
- [x] `engine/tests/test_import_direction.py` -- AST scan of `core/` rejects imports of `adapters`, `onnxruntime`, `os`, `pathlib`, `shutil`, `glob`, `io`, `json`; a second test proves the scanner flags a planted violation in a temp file.
- [x] `app/` (package.json, vite/tsconfig, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`) -- Vite + React + Tailwind 4; App shows a plain dev status (waiting / ready + protocolVersion + ping ok) until Story 1.3.
- [x] `app/scripts/gen-protocol-types.mjs` -- runs from `predev`/`prebuild`/`pretest` to write `src/protocol/generated.ts`.
- [x] `app/src/protocol/client.ts` -- generates ids, sends through the Tauri command, resolves by `id`, delivers `id:null` events to listeners.
- [x] `app/src/protocol/examples.test.ts` -- vitest + ajv: every example parses and validates.
- [x] `app/src-tauri/` (Cargo.toml, build.rs, tauri.conf.json, `capabilities/default.json` with core defaults only, `src/main.rs`, `src/engine.rs`) -- single-instance plugin focuses the window. In debug builds the engine is spawned with `uv run --project <repo>/engine python main.py` (repo path from `CARGO_MANIFEST_DIR`, `CREATE_NO_WINDOW`, `FB2_VALIDATE_PROTOCOL=1`). A reader thread emits each stdout line as an `engine-message` event, the `engine_send` command writes a line, and the child is killed on exit.
- [x] `fixtures/README.md` -- placeholder for synthetic test data.
- [x] `ARCHITECTURE-SPINE.md` -- Stack table pinned.

**Acceptance Criteria:**
- Given a fresh clone with the toolchain, when `npm install` and `npm run tauri dev` run in `app/`, then the window shows "ready", the protocol version and a successful ping.
- Given the code, when searched, then no JS/TS file spawns a process and the capabilities grant no shell permission.
- Given the top level, then `app/`, `engine/{core,core/ports,core/rules,adapters,main.py}`, `protocol/examples/` and `fixtures/` exist.

## Design Notes

The bridge is `std::process` in Rust, not `tauri-plugin-shell`, so no spawn API is ever exposed to JS. The dispatcher lives in the adapter, because `ping` is transport, not a product rule. `core/` is empty except for packages, and the import test guards it from day one. The release sidecar path (`externalBin`) goes into `engine.rs` in Story 3.9.

## Verification

**Commands:**
- `cd engine && uv run pytest -q` -- all pass
- `cd app && npm test` -- all pass
- `cd app && npx tsc --noEmit` -- no errors
- `cd app/src-tauri && cargo check` -- builds

**Manual checks:**
- `npm run tauri dev`: ready + ping shown; launch the app again → the first window is focused, and Task Manager shows one engine Python process.

## Implementation Notes

- Toolchain (orchestrator, 2026-11-02): uv was upgraded to 0.13.6 and Python 3.14.10 is installed (`uv python find 3.14.10`). VS 2022 Build Tools (C++ workload) and rustup are being installed by the orchestrator in the background. Do not start a second install. If `cargo` isn't on PATH yet, look in `%USERPROFILE%\.cargo\bin`. If it's still missing when the rest is done, report `cargo check` and `tauri dev` as pending rather than blocking on them.
- Toolchain done: VS 2022 Build Tools (C++ workload) and Rust stable-msvc 1.99.1 are installed.
- Additions beyond the task list:
  - `engine_ready` command: Rust caches the last `ready` line and the client replays it, so a page that subscribes late or reloads still sees `ready`.
  - `@types/react-dom` 19.3.0.
  - Strict release CSP, with `devCsp: null` for Vite.
  - A handler exception becomes an `invalidRequest` reply (there is no internal-error code yet).
  - Release builds start no engine until Story 3.9.
  - `.gitignore` also covers `app/src-tauri/gen/`.
- Verification (orchestrator re-ran, 2026-11-02): `uv run pytest` 31 passed, `npm test` 11 passed, `tsc --noEmit` clean, `cargo check` clean.
- Matrix: rows 1–6 are each covered by a passing pytest in `engine/tests/test_stdio_roundtrip.py`. Row 7 (second launch) is covered by a live check only: the second process exited 0 and one engine tree stayed. Whether the first window visibly comes to the front was not confirmed by eye.
- Environment issue, not a code issue: on this PC `npm run tauri dev` fails. npm's `script-shell` is Git Bash, and a quoted Java PATH entry makes cmd unable to find `npm`. `.\node_modules\.bin\tauri.cmd dev` works. User config left untouched.
- Engine tree under `uv run`: uv, then the venv's `python.exe`, then the interpreter, so Task Manager shows two `python.exe` entries for one engine. Killing the whole tree is Story 1.2.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-02). Layers: Blind Hunter (B), Edge Case Hunter (E), Verification Gap (VG).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1 / E2 | `engine_send` holds the stdin mutex during a blocking write; `shutdown()` locks the same mutex | medium | `engine.rs` `shutdown` calls `lock(&state.stdin).take()`. A hung engine with a full pipe blocks the writer forever, so the app can't quit. | patch P1 |
| B2 / E1 | Reader EOF leaves `last_ready`/`stdin` stale and tells the UI nothing | medium | Real: after the engine dies, a reload replays the old `ready`. Engine-stop handling is excluded by the frozen Never ("crash banner (Story 1.2)"). | defer D1 |
| B3a / E6 | Requests have no timeout and hang forever if the engine dies | medium | Real, but liveness and ending pending requests on restart are AD-16 / Story 1.2, which the frozen intent excludes. | defer D1 |
| B3b / E7 | `stop()` drops pending promises without rejecting them | low | Only on unmount; App's `active` flag already ignores late results. Not everyday, and the fix restructures `pending`. | reject |
| B3c | Release builds start no engine, so the UI waits forever | low | The frozen Never excludes the PyInstaller sidecar (Story 3.9); release builds aren't produced yet (`bundle.active: false`). | reject |
| B4 / E5 / VG-other | `ready` delivered twice (live, then the cached replay) | low | `start()` subscribes, then calls `engine_ready`; Rust caches before emitting. Plausible window at startup, giving two pings. Direct fix in the client. | patch P2 |
| B5 | Handler or encode faults are reported as `invalidRequest` | low | No current handler can throw, and `_parse` rejects unencodable input first. A new code is public protocol surface, so no direct fix. | reject |
| B6 / E11 / E12 | Without validation, a non-string or NaN `text` is echoed | low | The only sender is the typed UI; validation is on in every build that runs an engine today. Fix needs guards; unlikely. | reject |
| B7 / E4 / E19 | Kill fallback targets `uv`, so Python may be orphaned | maybe-false (medium if true) | Depends on whether `uv run` puts its child in a kill-on-close Job Object; the fallback only runs if the engine ignores EOF. Settle by killing `uv` in a test and checking for python. | defer D2 |
| B8 | Shell 2 s grace vs engine 5 s joins | low | Only matters for a slow shutdown; the normal close is instant. Not everyday. | reject |
| B9 / E16 | The import-direction denylist misses `open()`, `tempfile`, `subprocess`, `sqlite3`, `pickle`, `importlib` | medium | The epic AC says "file system or JSON storage"; builtin `open()` slips past AD-1. Fix is test-only and trivial. | patch P3 |
| B10 | Toolchain not enforced (no `rust-toolchain.toml`, no Node engines) | low | Dev-only drift; the AC asks only for recording in the Stack table. | reject |
| B11 / E21 | Icons and lockfiles missing from the diff | false | They exist on disk (`app/src-tauri/icons/*`, `Cargo.lock`, `package-lock.json`, `uv.lock`); the orchestrator left them out of the review diff. | reject |
| B12 | Missing client/shell tests | low | Folded into VG1/VG3 (same gaps); the other cases (unmatched lines, stop) are low. | patch P8/P10 |
| B13 / E17 | Test harness `stderr=PIPE` is never drained | low | `test_stdio_roundtrip.py` `Engine.__init__`: a large traceback could deadlock a test. Direct fix. | patch P4 |
| B14 / E20 | 1 s `ready` not measured through `uv run` | low | AD-16 bounds the engine; `uv run` is a dev launcher only (release uses PyInstaller). Not a product defect. | reject |
| B15 | Event and command names duplicated in Rust and TS | low | Drift risk only; the fix adds a cross-language check. | reject |
| B16 | `.gitignore` lacks `.pytest_cache/` | low | Every `pytest` run leaves an untracked `engine/.pytest_cache`. Direct fix. | patch P5 |
| B17a | Fresh clone: `generated.ts` is missing until a script runs | low | Editors show import errors after `npm install`. A one-line `postinstall` fixes it. | patch P6 |
| B17b | `vite.config.ts` not type-checked | low | Config only; not everyday; needs tsconfig restructuring. | reject |
| E3 | Missing `uv` makes setup return Err and `build().expect` panic | low | `main.rs` setup uses `?`, so the app crashes with an opaque message instead of a logged reason. Direct fix: log and continue. | patch P7 |
| E8 | A `client.start()` rejection is unhandled in App | low | Only outside Tauri (plain browser); not everyday; the fix is a guard. | reject |
| E9 | No `protocolVersion` mismatch check | low | UI and engine ship together; no spine rule requires a UI check. | reject |
| E10 | An `id:null` error never resolves the request that caused it | low | The client always sends well-formed JSON with a string id; only lone surrogates trigger it. | reject |
| E13 | Writer `OSError` stops output while reading continues | low | A broken stdout means the parent is gone, so stdin EOF ends the loop. Not everyday. | reject |
| E14 | Unwritable log folder kills the engine before `ready` | low | `%LOCALAPPDATA%` is user-writable; the fix is a guard. | reject |
| E15 | Writer join timeout, then the stream is closed under the writer | low | Requires a writer stuck for more than 5 s. | reject |
| E18 | Type generator takes the first exported type name | maybe-false (low) | json-schema-to-typescript emits the root type first; current schemas have one type each. Only low if true. | reject |
| VG1 | Rust `is_ready` / `last_ready` cache has no automated test | gap | Pre-verified: no `#[test]` in `app/src-tauri/src`; AC 1 could regress with every check green. | patch P8 |
| VG2 | Lone-surrogate rejection and writer encode fallback untested | gap | Pre-verified: no surrogate case in `test_stdio_roundtrip.py`. | patch P9 |
| VG3 | `request()` rejecting on `send` failure untested | gap | Pre-verified: the fake `send` always resolves. | patch P10 |

## Code Review — 2026-11-09 (Stories 1.1–1.3 together, `1397979..5772474`)

### Review Findings

- [x] [Review][Decision] (resolved 2026-11-09, option 1b: Claude launches `tauri dev` and screenshots each manual check for the user to judge) Acceptance criteria that can only be checked by eye were never checked — The spec says `status: 'done'`, but Implementation Notes say "Whether the first window visibly comes to the front was not confirmed by eye" (second-launch focus). The same is true for Story 1.2 AC 1 and Story 1.3 ACs 1–4. Someone has to run `tauri dev` and look before the story is really done.
  - Verified 2026-11-09 under `tauri dev`: with the window minimized, a second launch exited by itself, and the existing window was restored and became the foreground window (one `file-browser-2` process).
- [x] [Review][Patch] `serde_json` is not pinned to an exact version like the other crates (`"1"`, lockfile has 1.0.154) [app/src-tauri/Cargo.toml:14]

**Rejected**
- low — `_parse` drops a valid string `id` when the line fails later checks (lone surrogate, bad `type`), so the error comes back as `id: null` and the request is never settled. Unreachable today: the client always sends a valid `type`, and `JSON.stringify` of normal input has no lone surrogates. The fix adds a branch. A per-request timeout is ruled out by Story 1.2's Never rules.
- low — With the validator off, `handle_ping` echoes a non-string `text`. The only sender (the UI) always sends a string.
- low — `setup_logging` raises before `ready` if the log folder can't be written, so the engine never starts. Only an unwritable `%LOCALAPPDATA%` triggers it, which is very rare, and the fallback adds a branch.
- false — `gen-protocol-types.mjs` could pick a helper type or duplicate a title. Every current schema compiles to exactly one exported type with a unique title.
- low — `postinstall` fails with `npm install --omit=dev`. Nobody installs this desktop dev repo without dev dependencies.
- low — `tsconfig.json` includes only `src`, so `vite.config.ts` and the generator script aren't type-checked. The harm is limited to dev-time config errors.
- low — The AD-1 import guard misses `builtins.open()` and attribute calls. `core/` is empty today, and the fix widens a test heuristic.
- false — `ProtocolClient.stop()` leaves pending requests unsettled. It is only called on unmount, and the `active` flags in App and the session ignore late results (already rejected as B3b).
- false — `void session.start()` swallows startup failures. The webview still logs the rejection as "Uncaught (in promise)", and if Tauri IPC is broken there is nothing the UI could show.
- low — If one `Promise.all` subscription rejects in `start()`, the other listener leaks. That needs broken Tauri IPC, and the fix (`allSettled` plus cleanup) adds complexity.
