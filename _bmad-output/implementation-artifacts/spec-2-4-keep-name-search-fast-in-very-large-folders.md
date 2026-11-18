---
title: 'Story 2.4: Keep name search fast in very large folders'
type: 'chore'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
baseline_commit: '6c5b2d810a05269989f76bebb0cb2ba739530460'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** NFR-3 (under 6 s from Enter to results on screen, for 90% of name searches on a tree of about 50,000 files, on the Baseline PC) has never been measured. Without a number, Epic 2 can't close, and nobody knows whether a filename cache (deferred, C-6) is needed.

**Approach:** Add a deterministic generator for a synthetic ~50,000-file tree, plus a repeatable script that runs 20 fixed name searches against the real engine. Add a dev-only in-app timer for spot checks. Record the method, the machine and the results in the repo.

## Boundaries & Constraints

**Always:**
- The tree is synthetic (C-7) and not committed: `fixtures/` gets the generator, not 50,000 files. The same seed gives the same relative paths. It has Hebrew, English and mixed names, the usual extensions, nested folders, and a few very large folders. The generator writes only inside the folder it is given, creates empty files, and refuses a folder that isn't empty.
- Decision (method): the script drives the real engine (`main.py`) over stdio, exactly as the shell does. Each search's time runs from sending `search` to receiving its terminal `searchDone`. It reports per search the time and the match count, then the p90, the median and the maximum. As NFR-2 says, the first search after engine start runs once more before the measured set: it is reported on its own, must be ≤ 10 s, and is excluded from the 90%. Exit 1 when p90 ≥ 6 s or the first search takes > 10 s.
- Decision (in-app check): a dev-only timer (`import.meta.env.DEV`) logs to the console, for each search, the ms from Enter to the frame after `searchDone`'s results render. It's never shipped in a release build and never logs the search text.
- Decision (searches): 20 fixed searches, all counted: rare names (1–10 matches), common words (100–2,000), Hebrew, `.pdf`, a nonsense word (0 matches) and 2 single letters (tens of thousands of matches). The script holds the list; the generator plants names so that each search hits its intended range.
- Decision (machine): the recorded run is on this development PC, labelled "above Baseline" with its specs. The doc keeps "Baseline PC run: open" until someone runs it there, as `docs/network-check.md` does.
- Decision (a miss): if p90 ≥ 6 s, first fix the cheap known causes from `deferred-work.md` (matches copied per batch in `SearchSession`, flushing only between folders), then measure again. Ask the human before adding any cache.
- The record lives in `docs/name-search-speed.md`: the method, the machine (CPU, cores, RAM, disk, Windows build), the tree's seed and counts, the result table and a pass/fail verdict. The search text never reaches the engine log (existing rule). Tests use small trees in temp folders only.

**Never:** No filename cache, index or database unless the recorded measurement misses the target and the human agrees. No Rust changes, no new runtime dependencies, no change to the search protocol or the UI behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generate | empty folder, default seed | ~50,000 files in ~2,500 folders; prints the counts | N/A |
| Re-generate | the same seed in another empty folder | an identical list of relative paths | N/A |
| Not empty | a folder with anything in it | nothing is written; exit code 2 with a message | refuses |
| Measure | a generated tree | a table of 20 searches, then median, p90, max, and the first search on its own line; exit 0 when within target | N/A |
| Miss | p90 ≥ 6 s, or first > 10 s | the same report; exit 1 | N/A |
| Bad folder | a missing tree folder | exit 2 with a message; no engine left running | the engine is closed |

</frozen-after-approval>

## Code Map

- `fixtures/make_correct_display_tree.py`, `fixtures/README.md` -- the generator pattern to follow (CLI `python fixtures/<script>.py <folder>`, UTF-8 stdout, never deletes). The README lists every fixture.
- `engine/tests/test_stdio_roundtrip.py` `Engine` (:41) -- spawning `main.py` with `FB2_LOG_DIR`, reading JSON lines, `read_search()`. The script copies the approach (a temp `FB2_LOG_DIR`, closing stdin to stop the engine); it doesn't import tests.
- `engine/main.py` `search_handler`, `engine/core/search/filename.py` `name_search` (BATCH_SIZE 200, FLUSH_AFTER 0.25 s), `engine/core/walk.py` -- the path being measured. Unchanged unless the target is missed.
- `app/src/App.tsx` -- the dev-only `SearchSession` trace callback (`import.meta.env.DEV`): the timer's start (the `search` send) and end (`searchDone`) are already seen there. "On screen" = the next `requestAnimationFrame` after `searchDone`.
- `app/src/search/session.ts` `search()` :99 and the matches copy :107 -- the deferred item, touched only on a miss.
- `docs/network-check.md` -- the precedent for a measurement record (method, status, runs).

## Tasks & Acceptance

**Execution:**
- [x] `fixtures/make_large_tree.py` -- the deterministic generator (`--seed`, `--files`; defaults ~50,000) -- one tree everyone can rebuild.
- [x] `engine/scripts/measure_name_search.py` -- spawns the engine, runs the warm-up and the 20 searches against a tree, prints the report, sets the exit code -- the repeatable measurement.
- [x] `app/src/App.tsx` (and a small helper with a unit test if it's more than a few lines) -- the dev-only timer.
- [x] `engine/tests/test_name_search_measurement.py` -- generator determinism, the not-empty refusal, each search's intended match range on a scaled-down tree, and an end-to-end run of the script on a ~500-file tree (exit code, report lines, a missing folder) -- keeps both scripts working.
- [x] `docs/name-search-speed.md`, `fixtures/README.md` -- the method and the recorded run; the new fixture listed. Mark the deferred item resolved or still open, per the result.

**Acceptance Criteria:**
- Given a generated default tree on this PC, when `measure_name_search.py` runs, then its report and verdict are recorded in `docs/name-search-speed.md`, labelled above Baseline, with the Baseline run marked open.
- Given `uv run pytest`, `npm test` and `npm run typecheck`, when run, then all pass.

## Implementation Notes

- The dev timer needed the trace to see the `search` send, which it didn't: `SearchSession` now calls `trace(id, "search")` when the request gets its id (one line in `session.ts`; no behavior change, the two trace tests updated). The matches copy in `session.ts` (the deferred item) is untouched. The timer itself is `app/src/search/timer.ts` (`onScreenTimer`, unit-tested), composed with the console trace in `App.tsx` under `import.meta.env.DEV`. A new search drops older searches' clocks, since only the latest one renders.
- Validation: the script runs the engine without `FB2_VALIDATE_PROTOCOL` (release behavior); `--validate` matches the debug shell. Both were recorded.
- Ranges are stated for the default 50,000-file tree; `expected_range(kind, files)` scales common, `.pdf` and single-letter ranges with the file count (rare and nonsense are fixed), so the tests can check them on 500- and 2,000-file trees.
- Result: pass (p90 1.04 s, first search 0.42 s), so the deferred item stays open and no cache was considered.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter 14, edge-case-hunter 10, verification-gap 1 gap + 2 other).

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | verification-gap, blind-hunter, edge-case-hunter | The on-screen timer stops inside one rAF callback, before that frame's layout and paint | medium | patch | `timer.ts` reports in the first rAF; rAF callbacks run before layout/paint, and `session.ts` traces `searchDone` before `update()`. The frozen intent says "the frame after searchDone's results render", so the 20k-row layout/paint is exactly what's left out. The fix is a second rAF in the default `nextFrame`. |
| 2 | verification-gap (gap) | The App.tsx DEV wiring of the timer is untested | low | patch | Filed evidence: `App.test.tsx` silences `console.info` and never reads its calls, so removing `onScreen(...)` or logging the text still passes. |
| 3 | verification-gap, blind-hunter, edge-case-hunter | Unexpected engine output or a broken pipe exits 1 (the "missed" code) with a traceback | low | patch | `measure()` catches only `EngineFailed`; `json.loads` in `read`, `reply["matches"]` and `send` can raise other errors. The docstring promises exit 2. It's a direct wrap. |
| 4 | blind-hunter (status headline, no on-screen record, no tracking item, warm cache only) | The record says "pass" for a claim defined as on screen, and doesn't list what is still unmeasured | medium | patch | `docs/name-search-speed.md` Status says "pass, p90 1.04 s"; the on-screen check, the Baseline run and a cold-cache first search are unmeasured, and only the Baseline run is marked open. A doc correction. |
| 5 | blind-hunter | The prescribed `tauri dev` check runs with protocol validation on | medium | patch | `app/src-tauri/src/engine.rs:465` sets `FB2_VALIDATE_PROTOCOL=1` in debug builds, and the timer exists only in dev builds. Run 3 shows the single letters at about 10 s with validation, so the check would read as a false miss. Doc guidance. |
| 6 | blind-hunter | The deferred-work note claims the UI-side fix wasn't needed, from an engine-only number | low | patch | The `SearchSession` copy is UI-side, and the script can't see it. Direct rewording. |
| 7 | blind-hunter | "Same seed, same paths" overstated across Python versions; MAX_DEPTH and large folders untested | low | patch | Python guarantees only `random()` sequences across versions, and the generator uses choice/shuffle/sample/randint. Direct wording plus two asserts. |
| 8 | edge-case-hunter | `build()` creates missing parents outside the given folder | low | patch | `root.mkdir(parents=True, ...)` against "writes only inside the folder it is given". A direct correction. |
| 9 | blind-hunter | sprint-status says in-progress while the spec says in-review | false | reject | The workflow moves sprint-status to `review` at its present step (same as 2.3 triage #12). |
| 10 | blind-hunter | The 0.4 s → 1.0 s step change wasn't investigated | low | reject | It's recorded openly in Findings, and the result is far inside the target. Settling it is new investigation, not a correction. Likely machine-side (it held across both runs). |
| 11 | blind-hunter | The script doesn't check it ran on the intended tree, and ignores `notices` | low | reject | Every search's match count is printed next to the documented ranges, so a wrong tree shows. Adding checks adds branches for an unlikely case. |
| 12 | blind-hunter, edge-case-hunter | An `Engine.__init__` Popen failure leaks the stderr handle | low | reject | `Popen` runs `sys.executable` in the engine folder, so it's unlikely to fail; the fix adds a guard. |
| 13 | blind-hunter, edge-case-hunter | The not-empty guard lives only in `main()`; an OSError mid-build leaves a partial tree with a traceback | low | reject | `build()` is called only by `main()` and the tests. Disk-full or denied mid-build is unlikely, and handling it adds branches. |
| 14 | edge-case-hunter | A null-id error makes the script wait 120 s | false | reject | The script sends only well-formed JSON with string ids. The engine replies with a null id only to lines it can't parse (`_parse`), and schema errors carry the request's id. |
| 15 | edge-case-hunter | close() racing a late searchDone logs a time for unrendered results | low | reject | It's a dev-only readout and needs a sub-frame race. The fix adds a trace type. |
| 16 | edge-case-hunter | A hidden window pauses rAF and inflates the time | low | reject | The manual check is done with the window in front. Guarding it adds a branch. |
| 17 | edge-case-hunter | A newer search between searchDone and the next frame still logs | low | reject | It needs Enter within a frame of `searchDone`, and the fix adds a guard. |
| 18 | edge-case-hunter | Deep paths pass MAX_PATH with long paths off | low | reject | The longest planned relative path is 117 chars, and the default run under a 116-char root succeeded with `LongPathsEnabled=0`. Only a root over about 140 chars fails. |

## Verification

**Commands:**
- `cd engine && uv run pytest` -- expected: all pass
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `uv run --project engine python fixtures/make_large_tree.py <empty folder>`, then `uv run --project engine python engine/scripts/measure_name_search.py <folder>` -- expected: the report, exit 0

**Manual checks:**
- Under `tauri dev`, search the generated tree and read the `[search] on screen` ms in the dev console for a few of the 20 searches.
