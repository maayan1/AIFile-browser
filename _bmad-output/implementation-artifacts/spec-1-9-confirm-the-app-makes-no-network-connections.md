---
title: "Story 1.9: Confirm the app makes no network connections"
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bfa6ec96ac1b27fddf3428838796ec557e83a800'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** NFR-1 promises zero network connections from the app process, its WebView2 processes and the engine, but nothing has measured it. Nothing stops a later change from quietly breaking it either, for example by setting `additionalBrowserArgs` without `msSmartScreenProtection`, or by importing a network module in the engine.

**Approach:** Add a repeatable capture script that records every remote connection made by the app's process tree during a session. Run it for 10 minutes of real use and write the results into a short report in the repository. Disable any WebView2 endpoint it finds through configuration, then re-run until the app makes no connections. Add tests that keep the SmartScreen and engine rules from regressing.

## Boundaries & Constraints

**Always:**
- The capture is attributed by process: only connections from PIDs in the app's process tree (the shell exe, its `msedgewebview2.exe` children, `uv`, and the engine's `python`) count. Other apps' WebView2 instances and Windows services are excluded. Loopback (`127.0.0.0/8`, `::1`) is excluded and listed as local.
- The measured build is `npx tauri build --debug --no-bundle`. It embeds the frontend (no dev server) and runs the engine from source, because release builds have no engine until Story 3.9.
- `additionalBrowserArgs` stays unset (wry then applies `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`). If an endpoint has to be disabled through it, the value re-includes all three of those features.
- EdgeUpdate (`MicrosoftEdgeUpdate.exe`, `msedgewebview2.exe --type=…` launched by the updater) is listed under "Windows", not the app.
- The script restores every system setting it changes, even when it fails or is stopped with Ctrl+C.
- The dev engine launch uses `uv run --offline`, so the launcher never contacts PyPI.
- **Decision (author, 2026-11-12):** capture with the Windows Filtering Platform audit. The script runs elevated and temporarily enables the "Filtering Platform Connection" audit subcategory (success and failure). It reads Security-log events 5156/5157 (PID, destination IP/port, protocol, TCP and UDP) and restores the previous policy and log size afterwards. The author drives the 10-minute session; the agent writes the report from the JSON it produces.

**Never:** No new runtime or dev dependencies (no Procmon download, no npm/pip packages). No fixed-version WebView2 runtime. No change to UI behaviour. No packaging or installer work (Epic 8 / Story 3.9 re-check on a clean VM).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean run | 10-min session, no remote connection by the tree | report says "0 app connections", lists the run date, build and Windows/WebView2 versions | N/A |
| WebView2 endpoint found | remote IP:port from an `msedgewebview2.exe` in the tree | listed with host (DNS cache), process and count; disabled by config; run repeated | can't be disabled → report section "Reported to the author" |
| Other app's WebView2 | Teams/Widgets `msedgewebview2.exe` not in the tree | not counted | N/A |
| Not elevated | script run without admin | stops at once with a plain message, changes nothing | N/A |
| Interrupted | Ctrl+C mid-run | audit policy and log size restored, partial results kept | N/A |

</frozen-after-approval>

## Code Map

- `app/src-tauri/tauri.conf.json` -- `app.windows[0]` is where `additionalBrowserArgs` would go. Today it's unset. The CSP already limits `connect-src` to `ipc:`/`http://ipc.localhost`.
- `~/.cargo/registry/.../wry-0.57.1/src/webview2/mod.rs:307-311` -- wry's defaults when the args are unset (the three features above). A set value replaces them entirely.
- `app/src-tauri/src/engine.rs:447-464` -- `engine_command()` (debug). Add `--offline` after `run`. The release variant (line 467) returns `None`. Don't touch it.
- `app/src-tauri/src/main.rs` -- the Builder. Don't touch it unless an endpoint can only be disabled in code.
- `app/scripts/` -- existing home for app tooling (`gen-protocol-types.mjs`). The capture script goes here.
- `app/src/style-rules.test.ts` -- precedent for a vitest that reads source files from disk. The config guard follows it.
- `engine/tests/test_import_direction.py` -- precedent for a static import scan over `engine/`. The network-module guard follows it.
- WebView2 user data: `%LOCALAPPDATA%\com.filebrowser2.app\EBWebView`. Shell log: `shell_log::log_dir()`.

## Tasks & Acceptance

**Execution:**
- [x] `app/scripts/network-check.ps1` -- elevated WFP-audit capture: start the debug exe, track the process tree by polling parent PIDs, collect remote connections for `-Minutes` (default 10), snapshot `Get-DnsClientCache` for hostnames, write `network-check-<timestamp>.json` plus a console summary, and restore settings in `finally`. A `-DryRun` switch checks prerequisites without changing anything.
- [x] `app/src-tauri/src/engine.rs` -- `uv run --offline`, plus a comment pointing to NFR-1.
- [x] `app/src/network-rules.test.ts` -- fails if `tauri.conf.json` sets `additionalBrowserArgs` without `msSmartScreenProtection`, `msWebOOUI` and `msPdfOOUI` in `--disable-features`, or if the CSP's `connect-src` allows anything beyond `ipc:` and `http://ipc.localhost`.
- [x] `engine/tests/test_no_network.py` -- fails if any module under `engine/` imports `socket`, `ssl`, `http`, `urllib`, `ftplib`, `smtplib`, `xmlrpc`, `asyncio` streams/servers, `requests` or `httpx`.
- [ ] `app/src-tauri/tauri.conf.json` -- only if the run finds WebView2 endpoints: set `additionalBrowserArgs` with the defaults re-included, plus the disabling flags. Re-run until clean.
- [ ] `docs/network-check.md` -- the report: method, build, versions, session steps, endpoints per process (app / Windows / local), what was disabled and how, anything reported to the author, and the final clean run.

**Acceptance Criteria:**
- Given the debug build on Windows 11 with networking on, when you run `network-check.ps1` for 10 minutes while browsing, opening files, using Show in folder and pressing F5, then the final run lists 0 remote connections from the app's process tree, and `docs/network-check.md` records every run.
- Given `npm test`, `npm run typecheck`, `uv run pytest` and `cargo test`, when run, then all pass.

## Implementation Notes

- The debug build has to be measured: release builds have no engine until Story 3.9. The script runs the app un-elevated through Explorer.
- The script is dot-sourceable. `Invoke-NetworkCheck` and `Invoke-DryRun` return exit codes, and the entry guard is `$MyInvocation.InvocationName -ne '.'`. The Pester 3.4 tests (built into Windows, so no new dependency) mock every system-touching function.
- The orchestrator fixed `$AuditGuid` to `{0CCE9226-69AE-11D9-BED3-505054503030}`, checked with `auditpol /list /subcategory:* /v`. Pester caught a split bug (`LastIndexOf('')`) that left every image name empty; it's fixed.
- The two AC items that need the measured run (the conditional `tauri.conf.json` change and the report's results) wait for the author's elevated session.

## Spec Change Log

## Review Triage Log

- 2026-11-12, review 1 (blind-hunter, edge-case-hunter, verification-gap):
- `medium` patch — `Get-AuditSetting` returns 0 when the GUID row is missing (line 114), so `auditBefore` 0 is saved and restore switches off a previously enabled audit while reporting ok. The parsing also has no test, because every test mocks it. (blind-hunter, edge-case-hunter, verification-gap)
- `medium` patch — no positive control. A GPO override, a broken policy set or a bad XPath all give a clean-looking "0". The audit setting is also never re-checked at the end. (blind-hunter)
- `medium` patch — the run doesn't confirm it measured every component. A stale `.venv` with `--offline` means the engine never starts, and the report still says 0 with no warning. (blind-hunter, edge-case-hunter)
- `medium` patch — `Update-Tree` excludes every descendant whose image isn't in `$TreeImages`, including children of WebView2 or the engine, so their connections are never measured. Only the shell's direct children need the image filter, because that's where a default app opened from the browser starts. (edge-case-hunter)
- `medium` patch — the CSP guard checks only `connect-src`. `img-src https:` or `font-src https://…` would make WebView2 fetch remotely and still pass. (blind-hunter, verification-gap)
- `medium` patch — removing `--offline` from `engine_command()` fails no test. (blind-hunter, verification-gap)
- `medium` patch — on an error or Ctrl+C the app keeps running, because Stop-Process is inside `try`. The next run is then blocked by "App not already running". When the root exits first, orphaned tree children aren't killed and the capture ends early. (blind-hunter, edge-case-hunter ×2)
- `medium` patch — the root is seeded by PID only (line 265). If its PID is reused after the app exits, an unrelated process becomes the root, and the final `Stop-Process -Force` can kill it. (edge-case-hunter)
- `low` patch — `$tree` keeps exited PIDs and matches on image name alone, so another app's `msedgewebview2.exe` that reuses a tree PID is counted as the app's. The doc's "a reused PID isn't counted" overstates this. (blind-hunter, edge-case-hunter)
- `low` patch — the normal end of a run (exit 0, `interrupted` false, `endedEarly`, killing only live tree PIDs) is never reached by a test. (verification-gap)
- `low` patch — the restore file lives under `target/`, so `cargo clean` loses it, and it moves with `-OutDir`. (blind-hunter)
- `low` patch — `error`/`restore.problems` text can contain the user-profile path, which contradicts the doc's "no user paths". (blind-hunter)
- `low` patch — `test_no_network.py` misses `import asyncio as aio`, `from asyncio import *`, `_socket`, `_ssl`, `multiprocessing.connection`, `webbrowser`, `telnetlib`, `nntplib`, `wsgiref`, `asyncore`, and the loop methods `create_unix_connection`/`create_unix_server`/`sock_sendto`/`sock_sendall`/`sock_accept`/`connect_accepted_socket`/`getaddrinfo`. (blind-hunter, edge-case-hunter ×2)
- `low` patch — `network-rules.test.ts` throws on `"additionalBrowserArgs": null`, and `--enable-features=msSmartScreenProtection:x` or `<Trial` gets past the re-enable check. (edge-case-hunter ×2)
- `low` patch — doc: the Runs table is pre-filled with versions for a run that hasn't happened. "Tree processes live as long as the app" is wrong, since Chromium utility processes come and go. A smaller Security-log maximum applies only after the log is cleared. (blind-hunter ×3)
- `low` rejected — the `ExecutablePath` text mismatch (subst/8.3) and a single quote in `-Exe`. The default path is computed, and each fix adds normalization branches for setups nobody here uses. (edge-case-hunter ×2)
- `low` rejected — two concurrent elevated runs, an unreadable state file, `Remove-Item` failing after a restore, and `Get-SecurityLogConfig` throwing between the prerequisite read and the run. Each is rare, and each fix adds guards. (edge-case-hunter ×4)
- `false` — "the leftover state never matches once the user changes settings": `Restore-Settings` writes the before values and then reads them back, so they match unless a write fails. (edge-case-hunter)
- `low` rejected — listen/bind events 5154/5158. NFR-1 counts connections, and an accepted inbound connection shows up as a 5156. (blind-hunter)
- `low` rejected — capturing DNS lookups through the DNS-Client operational log. The doc already states this limit, the connection after a lookup is still captured, and turning another log on and off adds more system changes. (blind-hunter)
- `low` rejected — `interrupted` false on the error path: the `error` field and the "The check stopped" line already report it. (blind-hunter)
- `low` rejected — not checking that the app launched un-elevated. Elevation doesn't change which endpoints are contacted. (blind-hunter)
- `low` rejected — the `[int]` overflow in the registry fallback for a log of 2 GB or more. That needs both the API to fail and an unusual log size. (blind-hunter)
- `low` rejected — dropped pending `uv`/`python` events and non-constant dynamic imports. Other Python processes on the PC would be noise, and the engine has no dynamic imports today. (blind-hunter, edge-case-hunter)
- `low` rejected — `tauri.windows.conf.json` overrides. No such file exists, and guarding against one would forbid a legitimate future file. (edge-case-hunter)

- `low` patched (orchestrator) — pre-existing: `style-rules.test.ts` fails on a clean `HEAD` because three `BrowseList.tsx` comments say "right-click" and match the ` right-` rule. The comments now say "right click" (comment-only), so the AC's "all pass" holds.
- After the patches: Pester 44 passed, `npm test` 259 passed, `npm run typecheck` clean, `uv run pytest` 223 passed, `cargo test` 29 passed, and `-DryRun` un-elevated flags only the 3 admin prerequisites. Not yet run elevated.

## Verification

**Commands:**
- `cd app && npm test && npm run typecheck` -- expected: all pass, including the new guard
- `cd engine && uv run pytest` -- expected: all pass, including `test_no_network.py`
- `cd app/src-tauri && cargo test` (PowerShell) -- expected: all pass
- `powershell -File app/scripts/network-check.ps1 -DryRun` -- expected: prerequisite report, no system change
- `powershell -NoProfile -Command "Invoke-Pester app/scripts/network-check.Tests.ps1 -EnableExit"` (Pester 3.4, ships with Windows PowerShell 5.1) -- expected: all pass; covers every row of the I/O & Edge-Case Matrix with synthetic data, no elevation, no system change

**Manual checks:**
- Elevated: `app/scripts/network-check.ps1` for 10 minutes of real use. The final run's JSON shows 0 app connections, and the audit policy afterwards matches what it was before.
