---
title: 'Story 2.3: Cancel a search, and keep going past folders I can''t open'
type: 'feature'
created: '2026-11-15'
status: 'done'
route: 'dispatch'
baseline_commit: '07ee7502d4b56421eb0b0496ae504a910c0325b4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A running search can't be stopped. In 2.2, Esc just hides it while the engine keeps walking. Folders the search can't read are skipped silently, so the user can't tell the results are incomplete.

**Approach:** Add a `cancel` request: Esc during a running search stops it, keeps the results found so far and shows "Search stopped.". The engine reports the folders it skipped for permission as a `searchDone` notice code, which the UI shows as "Some folders couldn't be searched because you don't have permission." Both notices use the notice-banner style above the results.

## Boundaries & Constraints

**Always:**
- Protocol: a new request `cancel {id, type:"cancel"}` uses the *target request's* id and has no reply of its own. The target's terminal reply (`cancelled`, or the reply it was already sending) answers both. The engine handles it on the reader thread. If a channel's latest request has that id and hasn't ended, the engine cancels its token, exactly as a newer request on that channel would (including the abandon timer). An unknown or already-finished id does nothing. Add a schema and an example. The protocol README/schema description says that cancel shares its target's id.
- Engine core: `name_search` puts the notice code `permissionSkipped` in `searchDone.notices` when at least one walked subfolder's error maps to `accessDenied`. Move `folder_error_code` and its winerror sets from `main.py` to core; `main` imports and re-exports them unchanged. Other subfolder errors are still skipped with no notice. A root that can't be read is still the `error` reply. The notice goes with `noMatches` too. List notice codes in `codes.json` `noticeCodes`, narrow the schema's `notices.items` to that enum, and check on both sides that every notice code has a catalog string `search.<code>`.
- UI session: a running search records its request id. `cancel()` sends `cancel` for it and leaves `running` true until the terminal reply. A `cancelled` terminal reply for the latest search sets `stopped: true` and keeps the matches. `close()` while running also sends `cancel`, and the late reply is still dropped.
- Keys: Esc while a search is running cancels it: the view, the text and the focus stay. Otherwise Esc leaves, as in 2.2. ✕ and navigation always leave, cancelling first if needed. A new Enter replaces the search (engine latest-wins) and clears `stopped`.
- Notice banner: full-width, above the header and list (and above an empty state), `bg-notice-info text-notice-info-foreground`, an info icon, one sentence each. "Search stopped." when stopped, and "Some folders couldn't be searched because you don't have permission." for `permissionSkipped`. A stopped search never shows "No matching files found", even with zero matches. The polite live region announces "Search stopped." on cancel, and appends the notice sentences after the count sentence otherwise.
- Catalog: `search.stopped` "Search stopped.", `search.permissionSkipped` (the sentence above). The search text is never logged.

**Never:** No performance work (2.4). No other notice codes, no content search, no cancel for browse requests from the UI. No Rust changes. No new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cancel | Esc while 30 matches are shown and the search is still running | `cancel` sent for that id; `cancelled` arrives; 30 rows stay; banner "Search stopped."; announced | N/A |
| Cancel, none | Esc before any match | banner "Search stopped." only; no "No matching files found" | N/A |
| Replace | Enter on new text while one runs | old id ends `cancelled` (ignored); only the new results show; no "stopped" | N/A |
| Race | cancel sent, but `searchDone` already on its way | normal finished results; no "stopped" | engine ignores the late cancel |
| Denied subfolder | `Docs\Private` denied, a match in `Docs` | match shown; `notices: ["permissionSkipped"]`; banner sentence | N/A |
| Denied + none | only denied subfolders, no match | empty state and permission banner | N/A |
| Leave running | ✕ or navigation during a search | `cancel` sent, browse view, late replies dropped | N/A |
| Esc twice | Esc (stops), then Esc | second Esc leaves the view, text cleared | N/A |

</frozen-after-approval>

## Code Map

- `engine/adapters/stdio_transport.py` -- `Channel.submit` :177 (cancel + abandon timer to reuse), `_Job` :126, `handle_line` :417 (route `cancel` before HANDLERS; validate like other requests), `cancelled()` :75. Add a `Channel.cancel(request_id)` and keep the latest job's id under the lock.
- `engine/core/search/filename.py` -- the `for walked in …` loop (`walked.error` is the subfolder's OSError) and `_done(found)`. Add the notices.
- `engine/main.py:35-89` -- `FOLDER_NOT_FOUND`/`ACCESS_DENIED`/`FOLDER_UNAVAILABLE`, the winerror sets and `folder_error_code`. Move them to core (e.g. `core/errors.py`). `tests/test_import_direction.py` keeps core free of adapters.
- `core/walk.py` -- unchanged: it already yields `Walked(folder, None, error)` and goes on.
- `protocol/schemas/` (`cancel.schema.json` new, `searchDone.schema.json` notices enum), `protocol/examples/` (`cancel.json`, `search-done-permission-skipped.json`), `protocol/codes.json`. `npm run gen:protocol`.
- `app/src/protocol/client.ts` -- `Request` union :28, `dispatch` :146 (the id is made here). Add a `cancel(id)` that only sends, and a way for `stream` callers to learn the id (e.g. an `onId` callback).
- `app/src/search/session.ts` -- `search()` / the `cancelled` branch / `close()`. The snapshot gains `stopped`. SearchActions gains `cancel()`.
- `app/src/components/shell/AppShell.tsx` -- `escape`/`leaveSearch`/`leavingSearch`. Esc picks cancel or leave on `search.running`.
- `app/src/search/ResultList.tsx` -- `announcement()`, the body branches, `OUTCOMES`. Add the banner (`Info` icon from lucide). The tokens `notice-info`/`notice-info-foreground` exist in `index.css:90`.
- `app/src/i18n/catalog.ts`, `app/src/protocol/examples.test.ts` (2.2's outcome-code test is the pattern), `engine/tests/test_protocol_examples.py`.
- Tests: `engine/tests/test_channel.py` (channel cancel), `test_search_core.py` (`WalkFs(..., denied={...})` exists), `test_stdio_roundtrip.py` (cancel round trip), `app/src/search/session.test.ts`, `ResultList.test.tsx`, `App.test.tsx` "App search view", `protocol/client` tests.

## Tasks & Acceptance

**Execution:**
- [x] `protocol/` -- cancel schema and example, notices enum, `noticeCodes`, a permission example; regenerate the types.
- [x] `engine/core/errors.py` (new), `engine/main.py`, `engine/core/search/filename.py` -- the moved error codes and the `permissionSkipped` notice.
- [x] `engine/adapters/stdio_transport.py` -- `cancel` routing and `Channel.cancel`.
- [x] `app/src/protocol/client.ts`, `app/src/search/session.ts` -- the id, `cancel()`, `stopped`, cancel on close.
- [x] `app/src/components/shell/AppShell.tsx`, `app/src/search/ResultList.tsx`, `app/src/i18n/catalog.ts` -- Esc, the banner, the announcements, the strings.
- [x] Tests for every matrix row on the side that owns it, the code/catalog checks on both sides, and a stdio round trip that cancels a search on a real tree and gets `cancelled` with no `searchDone`.

**Acceptance Criteria:**
- Given `npm test`, `npm run typecheck`, `uv run pytest`, `cargo test` and the Pester suite, when run, then all pass.
- Given `tauri dev` and a large folder, when I search and press Esc while it runs, then the results stay with "Search stopped.", and a second Esc returns to the folder.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap: "No verification gaps found").

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind-hunter, edge-case-hunter | An invalid `cancel` is answered with an `error` on the target search's id, giving that id two terminal replies | low | patch | `stdio_transport.py` `_cancel` returns `error(request["id"], …)`. This only happens with the debug validator on and a malformed cancel; the UI never sends one. The fix is direct: reply with a null id, as unparseable lines do. |
| 2 | blind-hunter | A stopped search drops the permission notice | low | reject | `cancelled` carries no notices, so carrying them would change the protocol. "Search stopped." already tells the user the results are incomplete. |
| 3 | blind-hunter, edge-case-hunter | A second Esc before `cancelled` arrives does nothing; a failed cancel send is swallowed | low | reject | `running` stays true only until the terminal reply: milliseconds normally, at most the 0.25 s abandon grace. A failed send means the engine isn't running, and its restart rejects the pending search (`client.ts` `receiveState`). The fix adds a result to the public `SearchActions.cancel`. |
| 4 | edge-case-hunter | Esc between the session update and React's re-render is swallowed | low | reject | A sub-frame window. The next Esc acts normally, and the fix is the same interface change as #3. |
| 5 | blind-hunter, edge-case-hunter | `joined()` hard-codes English sentence punctuation | low | reject | The intent fixes the announcement as count sentence + notice sentences. The only catalogs are English, plus Hebrew in 7.2, and Hebrew uses the same "." and "?". |
| 6 | blind-hunter, edge-case-hunter | No runtime guard for a notice code missing from `NOTICES` | low | patch | `ResultList.tsx` `notices()` maps codes with no check, and the client doesn't validate. A code from a newer engine would render `t(undefined)`. The fix is a one-line filter. |
| 7 | blind-hunter | The stopped announcement doesn't say how many results stayed | low | reject | The frozen intent fixes it as "Search stopped."; changing it means editing this build's spec. |
| 8 | blind-hunter | The docs say the reply "already being sent" answers a late cancel, but `_reply` turns a computed `searchDone` into `cancelled` until it is handed over | low | patch | `stdio_transport.py:319` replaces any reply with `cancelled` once the token is cancelled. That is acceptable (the user pressed Esc), but the wording in `cancel.schema.json`, the `Channel.cancel` docstring and the transport module docstring overstates it. Narrow the wording. |
| 9 | blind-hunter | The round trip's `found < 201` bound barely constrains anything | low | patch | 200 folders take about 4 s and the cancel goes out after about 0.25 s, so a tight bound (for example under 100) is safe and actually shows the walk stopped early. |
| 10 | blind-hunter | Leaving while running is tested only for ✕ and the nav pane | false | reject | Every navigation goes through `leavingSearch` → `leaveSearch` → `close()`. Story 2.2's tests assert each route leaves, and `close()` sending the cancel is tested in the session and through ✕ and the nav pane. |
| 11 | blind-hunter | `main.py` re-exports without `__all__` will trip F401 or strict re-export checks | false | reject | No linter or type checker is configured for the engine (`pyproject.toml`). The re-exports are deliberate and tested (`test_main_re_exports_the_folder_codes_from_core`). |
| 12 | blind-hunter | sprint-status says `in-progress` while the spec says `in-review`; the manual checks aren't recorded | false | reject | The workflow moves sprint-status to `review` at its present step. The manual `tauri dev` checks are the user's to run and are listed under Verification. |
| 13 | edge-case-hunter | The `joined()` regex misses 。 and ؟ | false | reject | No locale using them is planned. Same as #5. |

## Verification

**Commands:**
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd engine && uv run pytest` -- expected: all pass
- `cd app/src-tauri && cargo test` -- expected: all pass, unchanged
- `powershell -NoProfile -Command "Invoke-Pester app/scripts/network-check.Tests.ps1 -EnableExit"` -- expected: all pass, unchanged

**Manual checks:**
- Under `tauri dev`: search `a` on a big folder, press Esc mid-run, then Esc again. Search a folder holding a subfolder you can't open (e.g. `C:\Users` as a standard user) and check that the permission notice shows.
