---
title: "Story 2.1: Search names in this folder and its subfolders"
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd2516f1c9ed14371e3f6d654db3f230c0ee4a706'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Search Bar is an inert input. Nothing finds a file by name below the current folder. The engine also can't answer one request with several messages, which the search conversation needs (AD-15).

**Approach:** Enter sends one `search {id, text, folder}`. The engine walks the folder tree and replies on that `id` with `searchParsed`, then one or more `nameMatches` batches, then exactly one `searchDone` (or `cancelled`). The UI shows a spinner while the search runs and keeps the results for Story 2.2 to render.

## Boundaries & Constraints

**Always:**
- Matching (core, `engine/core/search/`): a name *contains* the text after both sides are NFC-normalized and casefolded. Files and folders match, and `.pdf` is ordinary text. The text is trimmed; whitespace-only text never runs (the UI doesn't send it). `parse_query(text, literal_phrases)` returns `mode: "normal"`, `dateRange: null` and `residualText` as the trimmed text.
- The walk uses `core.walk.walk()` (so `is_candidate()` and the RECALL_ON_OPEN rule apply) on the `fs.resolve`d folder. It never opens a file. The root itself is never a match. A subfolder that can't be read is skipped (its notice is Story 2.3). A root that can't be listed gives an `error` reply with the existing folder codes, through `folder_error_code`.
- The reply order on the `id` is fixed: `searchParsed`, then ≥1 `nameMatches` (the last may be empty), then one terminal reply. A batch is flushed at 200 matches, or after a folder once 250 ms have passed since the last flush. `searchDone` is `{notices: [], indexVersion: null, indexingActive: false}`, with no `outcomeCode` yet (Story 2.2).
- Each match: `name`, `kind`, `path` (full display path), `folder` (the containing folder's display path), `modified` (ISO 8601 or null), plus `typeCode` for files. Reuse the `folderListing` entry vocabulary.
- Transport: a channel handler may send non-terminal replies through an `emit` callable. `emit` checks for cancel or abandon and enqueues the message under the channel lock. Once the request is cancelled or abandoned it drops the message and raises `Cancelled`, so nothing ever follows a request's terminal reply. Existing handlers keep working unchanged. `search` runs on its own `search` channel (latest wins).
- Protocol: new schemas and examples for `search`, `searchParsed`, `nameMatches` and `searchDone`. The `search` request has `text`, `folder` and an optional `literalPhrases` (string array). `dateFilter` and `typeFilter` arrive with their schemas in Epic 6.
- UI client: `stream(request, onMessage)` delivers `searchParsed` and `nameMatches` in order and resolves with the terminal reply. An engine restart rejects it like `request`.
- UI: a search session holds `{running, parsed, matches[], done}` for the latest search only, and messages from a replaced search are ignored. Enter searches the current listing's `path`. With no listing, nothing runs. The spinner (an `aria-hidden` icon, with `aria-busy` on the input) replaces the magnifier while the search runs. A ✕ button (catalog `search.clear`) appears once there is text, and clears and refocuses the input. Ctrl+E and Ctrl+F focus the bar from anywhere and `preventDefault` (WebView2 opens its find bar otherwise), by `event.code` so any keyboard layout works.
- The query text is never logged, on either side.

**Never:** No result rendering, "No matching files found" or outcome codes (Story 2.2). No Esc handling, `cancel` request or permission notice (Story 2.3). No filename cache or performance tuning (Story 2.4). No Hebrew prefix or filler normalization in matching. No new dependencies. No Rust changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| EARS-01 | `report.pdf`, `photo.jpg`, `report-final.docx`; search `report` | the two report files only | N/A |
| Case / Hebrew / folder | `Report.PDF`, folder `reports`, `דוח שנתי.docx`; search `REPORT`, then `דוח` | both report items; then the Hebrew file | N/A |
| Extension as text | search `.pdf` | names containing `.pdf` | N/A |
| Deep match | match 3 levels down; an online-only folder holding a match | deep match returned; the online-only folder is listed by name but not entered | N/A |
| No match | search `xyz123` | `searchParsed`, `nameMatches` with `[]`, `searchDone` | N/A |
| Many matches | 450 matches | ≥3 `nameMatches` batches of ≤200, all before `searchDone` | N/A |
| Replaced | a second Enter while the first runs | the first ends with `cancelled` and nothing after it; the UI shows only the second | N/A |
| Bad root | folder deleted or access denied | `error` with `folderNotFound` / `accessDenied`; spinner stops | N/A |
| Blank | Enter on `"   "` | nothing sent | N/A |

</frozen-after-approval>

## Code Map

- `engine/adapters/stdio_transport.py:121-273` -- `_Job`, `Channel._run` / `_reply` / `_abandon`. Add `emit` per job here. `_abandon` already sends `cancelled` under `self._lock`, so `emit` must take the same lock. `ChannelHandler` is at line 44.
- `engine/main.py:83-131` -- the handler pattern (`folder_handler`, `folder_error_code`) and the `register_channel` calls. Add `search_handler(fs)` and register it on `"search"`.
- `engine/core/walk.py:37` -- `walk(fs, root, token)` yields `Walked(folder, entries, error)`. `child_path` (line 60) builds child paths. `core/browse.py:45` (`fs.resolve`) and `_listed`/`_iso_local` (lines 142-155) produce the entry shape and dates; reuse them, don't duplicate.
- New `engine/core/search/{__init__,query,filename}.py` -- `parse_query`, and `name_search(fs, folder, query, token, emit)`. Core imports only ports (`tests/test_import_direction.py` enforces it).
- `protocol/schemas/*.schema.json`, `protocol/examples/` -- follow `folderListing.schema.json`. `engine/tests/test_protocol_examples.py` and `app/src/protocol/examples.test.ts` parse every example. `npm run gen:protocol` regenerates `generated.ts`.
- `app/src/protocol/client.ts:69-178` -- the `Pending` map, `request`, `receive`. Add `stream` and the non-terminal types `searchParsed` and `nameMatches`.
- New `app/src/search/session.ts` -- modelled on `browse/session.ts` (subscribe and snapshot, `EngineStoppedError` handling). Wired in `app/src/App.tsx` beside `BrowseSession`.
- `app/src/components/shell/TopBar.tsx:44-57` -- the Search Bar markup; `AppShell.tsx` passes its props. `app/src/browse/shortcuts.ts` -- `shortcutFor` and the window listener. Add Ctrl+E and Ctrl+F (1.8 left them for this story).
- `app/src/i18n/catalog.ts` -- `search.label` and `search.placeholder` exist; add `search.clear`.

## Tasks & Acceptance

**Execution:**
- [x] `engine/adapters/stdio_transport.py` -- `emit` for channel handlers, with the cancel/abandon guarantee -- the search needs several replies on one id.
- [x] `engine/core/search/` -- `parse_query` and `name_search` per Always -- the rules live in the core.
- [x] `engine/main.py` -- `search_handler`, registered on the `search` channel.
- [x] `protocol/` -- the four schemas and their examples (including an empty `nameMatches`); regenerate the TS types.
- [x] `app/src/protocol/client.ts`, `app/src/search/session.ts`, `app/src/App.tsx` -- streaming and the search session.
- [x] `app/src/components/shell/TopBar.tsx`, `AppShell.tsx`, `app/src/browse/shortcuts.ts`, `app/src/i18n/catalog.ts` -- Enter, the spinner, ✕, Ctrl+E/F.
- [x] Tests -- engine: `test_search_core.py` (every matrix row with a fake FS), `test_channel.py` (emit order, emit after cancel or abandon dropped, terminal last), `test_stdio_roundtrip.py` (a real `search` round trip). App: `client` stream tests, search session tests, a TopBar / App test (Enter sends one `search` with the listing path, blank sends nothing, spinner while running, ✕ clears, Ctrl+E/F focus with the default prevented), `shortcuts.test.ts`.

**Acceptance Criteria:**
- Given `tauri dev`, when I type in the Search Bar, then nothing is sent. When I press Enter, the spinner shows until `searchDone`, and the dev console shows the reply sequence for the id.
- Given `npm test`, `npm run typecheck`, `uv run pytest`, `cargo test` and the Pester suite, when run, then all pass, including `test_no_network.py` and `network-rules.test.ts`.

### Review Findings

Review 2, 2026-11-15 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor):

- [x] [Review][Patch] `search.schema.json` says a bad root gets "the folder error listFolder would send", but search errors carry empty `data` (as `error.schema.json` and `search_handler` say). Story 2.2 would expect place data that never comes [protocol/schemas/search.schema.json:4] (acceptance-auditor+blind-hunter, low)
- [x] [Review][Patch] No test covers the spinner stopping when a search request can't be sent (a plain rejection, not `EngineStoppedError`): moving `running: false` inside the restart check would go unnoticed [app/src/search/session.ts:80-86] (verification-gap, medium)
- [x] [Review][Patch] The "search text is never logged" check never runs on the folder-error path, the handler's only search log call [engine/main.py:147, engine/tests/test_stdio_roundtrip.py] (verification-gap, medium)
- [x] [Review][Defer] `cargo test` fails on a CRLF checkout of `engine.rs`, so AC2 holds only on a hand-fixed working copy [app/src-tauri/src/engine.rs] — deferred: pre-existing, already in deferred-work.md. Note: the fix (`.gitattributes`) is not a Rust change, so 2.1's "No Rust changes" rule doesn't block it (blind-hunter+acceptance-auditor)
- [x] [Review][Defer] Epic 2 began with Story 1.9's elevated 10-min network run still open, which NFR-1 wants before Phase 2 [_bmad-output/implementation-artifacts/sprint-status.yaml] — deferred: pre-existing, tracked on Story 1.9 (acceptance-auditor)

After the patches (2026-11-15): `npm test` 286 passed, `npm run typecheck` clean, `uv run pytest` 265 passed. No Rust or script changes, so `cargo test` and Pester weren't rerun. AC1 (`tauri dev`) is still a manual check.

Rejected:
- `low` A replaced search can end with `searchDone` if the cancel lands between `_reply`'s token check and `_send`. The reply was already complete, the window is the same for every channel (pre-existing), and the UI ignores replies for a replaced id. (blind-hunter)
- `low` Enter during F5 of the same folder is dropped, since `loading` hides the folder. Refreshes are short, and telling "stay" apart needs a new snapshot field. (blind-hunter)
- `low` Hebrew final letters, niqqud and bidi marks in names aren't folded. Partial words ending in a final letter, or names with marks, are rare; folding is a matching decision for a later story. (blind-hunter)
- `low` The `typeCode` enum and the `modified` pattern are copied into `nameMatches.schema.json` rather than referenced. Validating test runs catch a drift. (blind-hunter)
- `low` `request()` accepts `search` and `Reply` includes `SearchDone`. The app only searches through `stream()`. (blind-hunter)
- `low` The stdio round trips use `sleep` and never send more than 200 matches; batching and emit are pinned in-memory by `test_search_core` and `test_channel`. (blind-hunter)
- `low` No per-search timing log: measurement is Story 2.4's job. (blind-hunter)
- `low` `test_search_core.py` imports helpers from other test modules. (blind-hunter)
- `low` Blank text gives `invalidRequest` with validation on and an empty `searchDone` without. Already rejected in review 1. (blind-hunter, edge-case-hunter)
- `low` A lone surrogate in the text breaks `searchParsed`. Not typeable, and `JSON.stringify` escapes it. (edge-case-hunter)
- `low` Alt/Ctrl/Shift+Enter search too. Harmless. (edge-case-hunter)
- `low` After a restart the snapshot looks like a cancel. Nothing renders it yet, and 2.2's no-results state comes only from `searchDone.outcomeCode`. (edge-case-hunter)
- `low` Spec `status: done` vs sprint `review`, and AC1 (`tauri dev`) unchecked. Fixing it means editing the spec under review; the manual run is the author's. (blind-hunter+acceptance-auditor)
- `low` F3, `select()` and the snapshot's `error` go past the frozen text. Recorded in Implementation Notes as review-1 patches; no Never rule is broken. (acceptance-auditor)

## Implementation Notes

- The transport takes `register_channel(..., streaming=True)`. A streaming handler is called with `emit` as its third argument, and `Channel._emit` sends under the channel lock, or raises `Cancelled` once the request is cancelled or abandoned.
- `core/browse.py` `_listed` became the public `listed_entry`, so matches reuse the entry vocabulary. Matches drop `size`.
- `name_search` lists the root before sending `searchParsed`, so a bad root produces a lone `error`. Unreadable subfolders still count toward the flush interval.
- After review, the UI also: ignores Enter repeats and IME composition, searches nothing while a folder loads, records an `error` reply's code in the snapshot, and maps F3 to focus search like Ctrl+E/F (with `select()`). F3 is a File Explorer key, and WebView2 opens its find bar on it.
- `cargo test` fails on a CRLF checkout of `engine.rs` (pre-existing; deferred). The working copy was put back to LF with no content change.

## Spec Change Log

## Review Triage Log

- 2026-11-13, review 1 (blind-hunter, edge-case-hunter, verification-gap):
- `medium` patch — Enter while a folder is still loading searches the folder the user just left: `listing` is kept while a newer one loads, and `SearchBar` gets `browse.listing.path` regardless. (edge-case-hunter, blind-hunter)
- `medium` patch — F3 still opens WebView2's find bar. Ctrl+F is prevented, but F3 (File Explorer's other search key) isn't, so the find bar the story keeps closed is still reachable. (blind-hunter)
- `low` patch — holding Enter repeats it, firing a burst of searches that each cancel the last. Enter's `event.repeat` isn't ignored. (edge-case-hunter)
- `low` patch — the session drops the error code (`running: false` only), so Story 2.2 can't tell an error from a cancel or word it. (edge-case-hunter)
- `low` patch — the FLUSH_AFTER check is skipped for unreadable subfolders (`continue` comes first), so pending matches wait past the interval while unreadable folders follow. (edge-case-hunter)
- `low` patch — `examples.test.ts` uses `"C:\Docs"`/`"C:\gone"` with single backslashes, so the tests send `C:Docs`/`C:gone`. They pass only because the expected value has the same mistake. (edge-case-hunter, blind-hunter)
- `low` patch — Ctrl+E/F focus the bar without selecting its text. File Explorer selects it, so typing replaces the old search. (blind-hunter)
- `low` patch — no test covers the IME-composing Enter guard, or Enter with no listing after a folder error. (verification-gap, blind-hunter)
- `medium` defer — copying the whole matches array on every batch is quadratic over a large result set (`[...current.matches, ...batch]` plus a notify per batch). Flushes are also per folder, so one huge or slow folder holds its matches until it's done. Both are performance, which the frozen intent gives to Story 2.4. (edge-case-hunter, blind-hunter ×2)
- `low` defer — pre-existing: the Story 1.4 deferred item "split an oversized `folderListing` into several replies" was meant to land with multi-message replies. Streaming (`emit`/`stream`) now exists, but the split isn't done. Re-targeted. (blind-hunter)
- `false` — "the handler's `except OSError` can end a stream with a folder error after results": `walk()` turns every subfolder OSError into a `Walked(error=…)` (`core/walk.py:52-55`), and the root is listed before `searchParsed`. After that nothing in `name_search` raises OSError. (blind-hunter)
- `low` rejected — ✕ during a running search leaves the spinner until the search ends. Results aren't shown in 2.1, and the UX defines ✕ as "the same as Esc" (cancel, then back to browse), which arrives with Story 2.3's cancel. (edge-case-hunter, blind-hunter)
- `low` rejected — the snapshot doesn't carry `{text, folder}`, and results aren't dropped on navigation. Nothing renders them yet, and how they're scoped and labelled is Story 2.2's design. (blind-hunter)
- `low` rejected — screen-reader announcements for the start and end of a search. The UX puts the polite result-count announcement with the Result List (Story 2.2); the Narrator floor is Story 7.3. (blind-hunter)
- `low` rejected — `search()` after `stop()`, an `onMessage` listener that throws, and the streaming flag vs handler arity. None is reachable from the app, and a mis-registered handler fails loudly as `invalidRequest`. (edge-case-hunter ×2, blind-hunter)
- `low` rejected — whitespace text with validation off returns an empty `searchDone`. The UI never sends it, and the result is harmless. (edge-case-hunter)
- `low` rejected — handler tests for `folderUnavailable` and a file given as the folder. `folder_error_code` is already covered by the listing handlers, and the UI only searches listed folders. (blind-hunter)
- `low` rejected — `literalPhrases` is accepted but unused. AD-15 fixes the request shape, and using it is Epic 6. (blind-hunter)
- `low` rejected — Ctrl+G / Ctrl+Shift+G (find next/previous) aren't prevented. They're rarely pressed, and each needs its own branch. (orchestrator, from the F3 finding)
- After the patches: `npm test` 285 passed, `npm run typecheck` clean, `uv run pytest` 265 passed, `cargo test` 29 passed, Pester 46 passed. Not yet checked under `tauri dev`.

## Verification

**Commands:**
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd engine && uv run pytest` -- expected: all pass
- `cd app/src-tauri && cargo test` (PowerShell) -- expected: all pass, unchanged
- `powershell -NoProfile -Command "Invoke-Pester app/scripts/network-check.Tests.ps1 -EnableExit"` -- expected: all pass, unchanged

**Manual checks:**
- Under `tauri dev`: search `report` in a folder that has the EARS-01 files, then in a deep tree, then in a Hebrew name. Watch the spinner. Ctrl+F doesn't open WebView2's find bar.
