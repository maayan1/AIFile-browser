---
title: 'Story 1.2: Recover when the engine stops'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
baseline_commit: '6d7a4fbb3f735c16ec85f38db848f00265bf10a1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-set-up-the-project-and-connect-the-ui-to-the-engine.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** If the engine crashes or hangs, the shell never notices. The UI keeps a stale "ready" and pending requests wait forever. Killing the `uv` launcher can also leave Python running.

**Approach:** Add an engine supervisor to the Rust shell, which owns every Job Object kill-tree, ping-liveness check and restart with exponential backoff. The supervisor reports engine state to the UI. The UI then ends pending requests, shows the plain banner from a first string catalog, and re-requests `status` after each `ready`.

## Boundaries & Constraints

**Always:**
- Only Rust spawns, restarts and kills the engine (AD-14).
- Every engine runs inside a Windows Job Object with kill-on-close. A restart terminates the whole job, waits until the job has no live processes, and only then spawns again.
- Shell pings use ids prefixed `shell:`. Their replies are consumed by Rust and never forwarded to the UI.
- User-visible text comes only from the catalog. The banner says "The search stopped working. Trying again…", has `role="alert"`, and uses logical CSS properties only.
- Deferred items from 1.1 are in scope: clear the cached `ready` on exit, end pending requests, and kill the whole tree.

**Never:**
- No stack trace, error code or technical text in the UI (NFR-10).
- No per-request timeouts: liveness is the ping.
- No final theme or layout (Story 1.3).
- No Hebrew strings yet (Epic 7).
- No product rules in the UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Crash | engine exits after `ready` | tree killed, state `restarting`, banner on, pending requests rejected, cached `ready` cleared, respawn after backoff | N/A |
| Hang | engine stops answering pings | no pong within `PING_TIMEOUT`, so the same as Crash | N/A |
| Never ready | no `ready` within `READY_TIMEOUT`, or spawn fails (no `uv`) | counts as a failure, then the same as Crash | spawn error logged |
| Give up | `MAX_FAILURES` consecutive failures | state `stopped`, banner stays, no more spawns | N/A |
| Recovered | new engine sends `ready` | state `running`, banner off, UI sends `status` and gets `statusReport` | N/A |
| Healthy again | engine running for `HEALTHY_AFTER` | failure count resets to 0 | N/A |
| Grandchild | engine has spawned a child process | the restart kills the child too | N/A |
| App exit | window closed | job terminated, no engine process left | N/A |

</frozen-after-approval>

## Code Map

- `app/src-tauri/src/engine.rs` -- This story replaces the module. Keep: `engine_command()`, `CREATE_NO_WINDOW`, the line reader, `is_ready`/`remember_if_ready` and their tests, `engine_send` (it must fail cleanly while no engine is running), and `engine_ready`. Replace: the one-shot `spawn`/`shutdown` with the supervisor.
- `app/src-tauri/src/main.rs` -- setup starts the supervisor; `RunEvent::Exit` stops it.
- `app/src/protocol/client.ts` -- `ProtocolClient`, `Transport`, the `readySeen` replay rule. Extend it rather than rewrite.
- `app/src/App.tsx` -- dev status screen (1.1). Keep it, add the banner.
- `engine/adapters/stdio_transport.py` `HANDLERS` -- add `status`.
- `protocol/schemas/`, `protocol/examples/` -- pattern for the new message types.
- `windows-sys` 0.61.2 is already in `Cargo.lock` (via Tauri). Pin it as a direct dependency with the features `Win32_Foundation`, `Win32_System_JobObjects`, `Win32_System_Threading`.

## Tasks & Acceptance

**Execution:**
- [x] `protocol/schemas/{status,statusReport}.schema.json` + examples -- `status {id,type}`, `statusReport {id,type,phase,documentCount}`, with `phase` taking the AD-16 enum (`idle`,`scanning`,`checking`,`indexing`,`rebuildingForUpgrade`).
- [x] `engine/adapters/stdio_transport.py` -- `status` handler that returns `phase: "idle"`, `documentCount: 0`.
- [x] `engine/tests/test_stdio_roundtrip.py` -- status round-trip test.
- [x] `app/src-tauri/Cargo.toml` -- `windows-sys = "=0.61.2"`, Windows-only target dependency.
- [x] `app/src-tauri/src/job.rs` -- `Job` wrapper: create with `KILL_ON_JOB_CLOSE`, assign the child, `terminate_and_wait(timeout)` that polls the active process count until it reaches 0, and close on `Drop`.
- [x] `app/src-tauri/src/engine.rs` -- `Supervisor`:
  - It is built from a command factory, a `Timings` struct and an event sink trait, so tests run without Tauri.
  - States: `starting`, `running`, `restarting`, `stopped`.
  - After `ready`, it pings every `PING_INTERVAL`.
  - A failure is any of: exit, a missed pong, no `ready` within `READY_TIMEOUT`, or a spawn error. On a failure it kills the job and waits, clears `last_ready`, emits `engine-state`, and sleeps the backoff (base × 2ⁿ) before respawning.
  - It stops after `MAX_FAILURES`.
  - It drops replies whose `id` starts with `shell:`.
  - An `engine_state` command returns the current state for late pages.
  - Defaults: `PING_INTERVAL` 5 s, `PING_TIMEOUT` 5 s, `READY_TIMEOUT` 15 s, backoff base 1 s, `MAX_FAILURES` 5, `HEALTHY_AFTER` 60 s.
- [x] `app/src-tauri/tests/fixtures/fake_engine.py` + supervisor tests (in `engine.rs` `#[cfg(test)]` or `app/src-tauri/tests/`):
  - The fake engine is run with Python from `uv python find 3.14`.
  - Modes: `crash-after-ready`, `hang-after-ready`, `never-ready`, `grandchild` (spawns a sleeping child and prints its PID on stderr or a file).
  - Tests use millisecond timings and cover the matrix rows Crash, Hang, Never ready, Give up and Grandchild. For Grandchild, assert the child PID no longer runs.
- [x] `app/src/i18n/catalog.ts` -- English catalog keyed `context.code`, with `engine.restarting`, plus a `t(key)` helper. Story 1.3 extends it.
- [x] `app/src/protocol/client.ts`:
  - `Transport` gains `subscribeState` and `currentState`.
  - On `restarting` or `stopped`, the client rejects every pending request with an `EngineStoppedError` and resets `readySeen`.
  - `request` also accepts `status`.
- [x] `app/src/engine/session.ts` -- `EngineSession`, non-React and testable: it tracks state and protocol version, decides `bannerVisible` (true while `restarting` or `stopped`), and sends `status` after every `ready`.
- [x] `app/src/components/EngineBanner.tsx` + `app/src/App.tsx` -- the banner above the dev status. App uses `EngineSession`.
- [x] `app/src/protocol/examples.test.ts`, `app/src/engine/session.test.ts` -- vitest:
  - pending requests are rejected on restart
  - banner on for `restarting`/`stopped`, off after `ready`
  - `status` is sent after each `ready`
  - every catalog value is plain text (no `{`, no code-like tokens)

**Acceptance Criteria:**
- Given `tauri dev` is running, when the engine's python.exe is killed in Task Manager, then the banner appears, a new engine starts, and the banner disappears. Task Manager then shows one engine tree and no orphans.
- Given the code, when searched, then no JS/TS file spawns or kills a process. The capabilities still grant only `core:default`.

## Design Notes

The supervisor owns one thread loop per engine generation. Readers carry the generation number and are ignored once a newer one exists, so a slow EOF from a killed engine can't trigger a second restart.

There's a tiny race between spawn and job assignment: `uv` could start Python before it's in the job. It's acceptable because `uv` takes milliseconds before its first child. Note it in the code.

## Verification

**Commands:**
- `cd engine && uv run pytest -q` -- all pass
- `cd app && npm test` and `npx tsc --noEmit` -- all pass and clean
- `cd app/src-tauri && cargo test` -- all pass, including supervisor tests

**Manual checks:**
- Run `.\node_modules\.bin\tauri.cmd dev` (see the 1.1 notes about the PATH issue) and do the first acceptance criterion by hand.

## Implementation Notes

- Deviation: `windows-sys` also needs the `Win32_Security` feature, because `CreateJobObjectW` takes `SECURITY_ATTRIBUTES` and is gated behind that feature in 0.61.2.
- Supervisor design:
  - One thread runs everything, and each generation gets its own `Job`.
  - Reader threads tag each line with its generation, and stale generations are ignored.
  - A per-generation writer thread owns the engine's stdin. `engine_send` and the pings only add lines to its queue, so a hung engine with a full pipe can't block the supervisor or the UI. This fixes 1.1 review item B1.
  - State `starting` is used only for the first spawn. Respawns stay `restarting` until `ready`, so the banner doesn't flicker off between attempts.
  - `engine-state` is emitted only when the state changes. `running` is emitted before the `ready` line is forwarded.
  - Backoff for retry n is base × 2^(n−1), so 1, 2, 4 and 8 s, then `stopped` on the 5th failure.
- Additions beyond the task list:
  - The supervisor also polls `try_wait` every 100 ms. Without it, killing `uv` would be missed while the orphaned Python still held stdout (no EOF). The live check below confirms this case.
  - `Timings` has `kill_wait` (10 s) and `exit_grace` (2 s, from 1.1). If a killed job doesn't empty within `kill_wait`, the supervisor goes to `stopped` rather than spawning on top of it.
  - Release builds (no engine until Story 3.9) count as spawn failures, so the banner ends up `stopped`.
  - `compile_error!` on non-Windows targets.
  - Fake engine mode `serve`, plus an optional delay for `crash-after-ready`.
  - Extra supervisor tests:
    - Healthy-again (failure count reset)
    - A healthy engine stays running, and `shell:` pongs are never forwarded
    - Stop leaves no process (App exit row)
  - `job.rs` unit tests.
  - The dev status shows the engine state and the `statusReport` phase/count. It is dev-only text, like 1.1's.
- Review fixes:
  - On a failure, teardown now clears the writer and `last_ready` and reports `restarting` before the kill.
  - It waits on the child only if the job actually emptied, so a survivor can't hang `stop()`.
  - Liveness comments (ping timeout vs. handler time, AD-10) are in `Timings::ping_timeout` and `serve_forever`.
  - New tests: state and event names are pinned, `stop()` during the backoff, the graceful exit on stdin EOF (fake mode `serve-mark-on-eof`), and stale-generation lines and EOF being ignored. `cargo test` now runs 17.
- Test finding: a job's active-process count reaches 0 a few ms before the killed process object is signaled. The tests' `gone(pid)` therefore polls for up to 1 s.
- Verification (2026-11-02):
  - `uv run pytest -q`: 37 passed.
  - `npm test`: 28 passed.
  - `npx tsc --noEmit`: clean.
  - `cargo test`: 13 passed (3 runs, stable).
  - `cargo clippy`: one pre-existing note on the kept 1.1 line reader.
  - The built CSS contains only `padding-inline`/`padding-block` and no physical left/right properties.
  - `cargo test` must run from PowerShell (or with a clean PATH). Appending `$USERPROFILE/.cargo/bin` in Git Bash corrupts PATH for native children, and then `uv` is "not found".
- Manual check with `tauri dev` (process level only, banner not seen by eye):
  - Killing the engine interpreter: the old tree (uv, python, python) was gone and exactly one new tree was running 5 s later.
  - Killing `uv.exe`: the restart was detected via the exit poll, and both orphaned pythons were gone.
  - Closing the window: the app and all engine processes exited, and port 1420 was freed.


- Orchestrator verification (2026-11-02): pytest 37 passed; vitest 28 passed; `tsc --noEmit` clean; `cargo test` 13 passed. The UI has no spawn or kill calls, and the capabilities are still `core:default` only.
- Matrix audit:
  - Crash: `crash_kills_clears_ready_reports_restarting_and_respawns`, plus the vitest pending-rejection and banner tests.
  - Hang: `hang_is_detected_by_a_missed_pong`.
  - Never ready: `never_ready_counts_as_a_failure_until_give_up`; a failed spawn is covered by `give_up_after_max_failures_and_spawn_no_more`.
  - Give up: `give_up_after_max_failures_and_spawn_no_more`.
  - Recovered: the crash test, plus session `sends status after every ready` and pytest `test_status_gets_status_report`.
  - Healthy again: `running_for_healthy_after_resets_the_failure_count`.
  - Grandchild: `restart_after_the_engine_is_killed_also_kills_its_grandchild`.
  - App exit: `stop_leaves_no_engine_process`.
- Still open: nobody has seen the banner on screen yet (AC 1). The subagent's live run confirmed the process-level recovery.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-02). Layers: Edge Case Hunter (E), Blind Hunter (B), Verification Gap (VG).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| E1 / B2 / E9 | `child.wait()` runs even when `terminate_and_wait` failed | medium | `run_generation` teardown: if the job didn't empty, the direct child may still be alive, so `wait()` blocks forever. `Stuck`/`stopped` is never reported and `stop().join()` hangs app exit. | patch P1 |
| E2 / B1 | `restarting` is emitted, and `last_ready`/writer cleared, only after kill+wait | low | `Worker::run` sets `Restarting` after `run_generation` returns. Normally the window is milliseconds, but up to `kill_wait` (10 s) when stuck; the UI shows a stale `running`/`ready` meanwhile. Direct reorder. | patch P2 |
| E3 / B5 | JS can send ids with the reserved `shell:` prefix | low | The client only generates UUIDs. Only a buggy or malicious page could do this, and the fix adds a guard. | reject |
| E4 | `lastReady()` resolved after a live `restarting` replays a stale `ready` | low | Needs a page load at the exact moment of a crash plus IPC reordering; the next state report corrects it. The fix adds epoch tracking. | reject |
| E5 | `start()` subscribe/invoke rejections are unhandled | low | Only outside Tauri; same as 1.1 E8 (rejected). | reject |
| E6 | `status` error reply is not logged | low | Cosmetic. The engine's `status` can't error today. | reject |
| E7 | A send failing during restart is logged as an unexpected error | low | Dev console only; needs the engine to die right after `ready`. | reject |
| E8 | Backoff formula claim (`2ⁿ` vs `2^(n-1)`) | low | It's spec notation; the code does base, ×2, ×4, ×8. The first backoff equals the base as intended. | reject |
| B3 | Banner says "Trying again…" after the shell has given up | low | Real, but the frozen intent fixes this exact text and "banner stays" (epic AC). Changing it means changing the intent, so it's raised with the user instead. | reject |
| B4 | No way to leave `stopped` | low | Intent-defined: "after the fixed number of failures … restarts stop" (epic AC). | reject |
| B6 | Liveness assumes every handler finishes within `PING_TIMEOUT` | low | `serve_forever` handles lines one at a time; future long handlers would be killed as hangs. Nothing documents it. A comment fixes it. | patch P3 |
| B7 / VG5 | No tests for `Stuck`, `Job::new` failure or `assign` failure | gap | Pre-verified: there's no fault-injection seam around `Job`; adding one is new surface. | defer D1 |
| B8 | `ProtocolClient.stop()` drops pending requests without settling them | low | Same claim as 1.1 B3b. The App/session `active` flags ignore them; unmount only. | reject |
| B9 / VG1 | Engine-state strings in Rust and TS aren't linked by any test | gap | Pre-verified: the tests compare enums or push their own literals. Renaming one side breaks the banner silently. | patch P4 |
| B10 | Supervisor tests depend on `uv`/timing and have no drop-guard | low | 13 tests passed three times in a row. The fix is test restructuring, not a direct correction. | reject |
| B11 | Spawn-before-assign race relies on uv's startup delay | low | Accepted in the Design Notes for `uv`. It matters when the Story 3.9 sidecar replaces `uv`. | defer D3 |
| B12 / VG6 | No render test for `EngineBanner`/App | gap | Pre-verified: there's no DOM test setup (no jsdom/testing-library); AC 1's manual check covers it. | defer D2 |
| VG2 | `stop()` during the restart backoff is untested | gap | Pre-verified: every test stops in `Running` or `Stopped`. | patch P5 |
| VG3 | Graceful EOF exit on stop is untested | gap | Pre-verified: `stop_leaves_no_engine_process` would pass with a hard kill. | patch P6 |
| VG4 | Stale-generation guard is not exercised deterministically | gap | Pre-verified: stale messages probably land in `sleep`. The test can inject through the `control` sender. | patch P7 |
| VG-other | Any reply with a `shell:` id counts as a pong, even an `error` | false | An engine that reads and answers the ping is alive by definition; liveness only means "responds". | reject |

## Code Review — 2026-11-09 (Stories 1.1–1.3 together, `1397979..5772474`)

### Review Findings

- [x] [Review][Decision] (resolved 2026-11-09, option 1b: Claude launches `tauri dev` and screenshots each manual check for the user to judge) Acceptance criteria that can only be checked by eye were never checked — AC 1 (the banner appears and disappears) is still open per Implementation Notes ("nobody has seen the banner on screen yet"), yet the spec says `status: 'done'`. See the same finding in Stories 1.1 and 1.3.
  - Verified 2026-11-09 under `tauri dev`: killing the engine's `python main.py` showed the banner ("The search stopped working. Trying again…") under the filter bar within 0.4 s, and it was gone 5 s later after the respawn. The new `shell.log` recorded `engine: stdout closed`. Closing the window left no engine process.
- [x] [Review][Decision] (resolved 2026-11-09, option 2a: add a shell log file now; becomes the patch below) The shell's supervisor diagnostics vanish in release builds — every failure reason goes only to `eprintln!`, and `main.rs` sets `windows_subsystem = "windows"` in release, so there is no console. The engine's own stderr is inherited and lost too. The I/O matrix says "spawn error logged", and the epic puts logs in `%LOCALAPPDATA%\FileBrowser2\logs\`. Options: add a shell log file now, or defer to Story 3.9, when release builds first get an engine.
- [x] [Review][Patch] Write the supervisor's diagnostics (and the engine's stderr) to a rotating shell log in `%LOCALAPPDATA%\FileBrowser2\logs\`, so release builds keep them [app/src-tauri/src/engine.rs:211]
- [x] [Review][Patch] The Tauri command and event names are only pinned on the Rust side, and no test exercises `tauriTransport()`, so renaming `engine-state`, `engine-message`, `engine_send`, `engine_ready`, `engine_state` or the `line` argument on either side breaks the real app with every suite green [app/src/protocol/client.ts:31]
- [x] [Review][Patch] No test asserts that the restart backoff grows exponentially; a constant `backoff_base` passes every supervisor test [app/src-tauri/src/engine.rs:216]
- [x] [Review][Defer] The `Stuck` path (killed job never empties → `stopped`, no respawn) has no test [app/src-tauri/src/engine.rs:330] — deferred: already tracked in deferred-work.md (fault-injection seam around `Job`).

**Rejected**
- low — `Supervisor::send` doesn't reject UI lines with the reserved `shell:` id prefix or non-JSON. The only sender, `ProtocolClient`, uses `crypto.randomUUID()` ids. Unreachable, and the fix adds a guard.
- reject (spec) — The banner says "Trying again…" after `stopped`. Real, but the frozen intent fixes this exact text, so the fix is a spec change (B3 earlier, raised with the user). Still open as a product question.
- low — Release builds (no engine) and a missing `uv` retry for about 15 s before `stopped`. Release has no engine until 3.9, and a missing `uv` is a dev setup problem. The fix adds a branch.
- low — App exit can block for up to 12 s. That happens only if the killed job won't empty. Normally the engine exits on stdin EOF in well under the 2 s grace.
- low — `read_lines` has no line-length cap, and the writer queue is unbounded. It would need a runaway engine of our own, and the cap adds new failure handling.
- low — Each engine line is parsed as JSON up to three times. At a few lines per second the cost is negligible.
- false — `Outcome::Stop` never sets the state to `stopped`. Stop is sent only from `RunEvent::Exit`, and nothing reads the state after that.
- low — A `restarting` that arrives during `start()`'s `lastReady()` await can replay the old `ready`. The window is a few milliseconds at page load, and the next `ready` corrects it. The fix adds an epoch guard.
- low — An `engine_send` failure during a restart rejects with a plain string rather than `EngineStoppedError`, so you get one `console.error` in dev. There is no user-visible effect.
- low — A `status` request that returns an `error` reply is dropped silently. The engine's `status` handler can't fail today.
- low — The release `engine_command() == None` path and the multi-line `send` guard are untested. Both are trivial, and release has no engine yet.
- false — An `error` reply with the ping's id counts as a pong. An engine that answers is alive (already rejected as VG-other).
