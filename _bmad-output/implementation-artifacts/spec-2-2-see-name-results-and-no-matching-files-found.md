---
title: 'Story 2.2: See name results and "No matching files found"'
type: 'feature'
created: '2026-11-15'
status: 'done'
route: 'dispatch'
baseline_commit: 'e18c336c760df418e278564a80fd691bf84dacbd'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.1 runs a name search and keeps its matches, but nothing shows them. The engine never says "nothing matched", and Esc and ✕ don't return to the folder.

**Approach:** Add a search view to the main area: the group "Name matches (n)" with one row per match, or an empty state. The engine decides "no matches" with `searchDone.outcomeCode`. Esc, ✕ and any navigation return to the browse view. A fixed Correct Display name list in `fixtures/` pins how Hebrew, English and mixed names and paths show, in the browse list and in Name matches.

## Boundaries & Constraints

**Always:**
- Engine (`engine/core/search`): `searchDone.outcomeCode` is `"noMatches"` when a finished search sent zero matches (also whitespace-only text), and absent otherwise. A cancelled search never reaches `_done`. Outcome codes are listed in `protocol/codes.json` (`outcomeCodes`). Tests on both sides check that every code an example or the engine uses is listed, and that each one has a catalog string `search.<code>`.
- Search view: it opens on Enter and shows matches as they arrive, in arrival order, with no sorting or paging. The header "Name matches (n)" (group-label, muted) shows once n > 0. A finished search with `noMatches` shows the empty state: an outline magnifier icon, "No matching files found" and "Try different words." in muted text, never red. A search `error` shows the browse error empty state for that code (`folderErrorKey`). A running search with no matches yet, or one a restart ended, shows no empty state.
- Row: a type icon, then the name, then a meta line "location · date" (body-sm, muted). The name is a `<bdi dir="auto">`, wraps to two lines and then ends with an ellipsis, with the full name as a tooltip. The location is breadcrumb-style: the searched folder's segments (named as the breadcrumb names them), then each folder below it. Each segment is its own `<bdi dir="auto">` in path order, with "›" outside the isolates. The date uses `formatDate`.
- Row behaviour is the same as the browse list: ↑/↓/Home/End move the selection; Enter or double-click opens (a folder navigates there, a file opens in its default app); the context menu (`RowMenu`) offers Open and Show in folder; Ctrl+Shift+E shows the row in its folder. Reuse the browse list's pieces (export them and share them, don't copy the logic).
- Leaving the search view: Esc (window-wide while the view is open, ignoring events already handled) or ✕ clears the text and shows the browse view of the current folder. Any navigation also leaves it: opening a folder, Show in folder, Back/Forward/Up, the breadcrumb, the nav pane or a typed path. F5 and opening a file do not. Leaving drops anything still arriving for that search. In 2.2, Esc during a running search leaves the view as well; Story 2.3 changes it to cancel.
- A polite live region announces the end of a search: "{count} name matches found" ("1 name match found"), or "No matching files found".
- Correct Display: `fixtures/correct-display-names.json` holds about 12 synthetic entries `{segments[], name, kind}`: Hebrew, English and mixed-direction names with extensions, numbers and brackets, plus Hebrew and mixed folder segments (including `סיכום ישיבה 3.docx`, `Budget תקציב 2025.pdf`, `Documents › התנדבות › Q3`). Tests render every entry in the browse list and in Name matches and check that each name is one isolate whose text is the name in logical order (extension last), and that location segments are separate isolates in path order. An engine round trip builds the tree on disk, searches it, and gets every name and folder back unchanged.
- The search text is never logged. All strings come from the catalog.

**Never:** No `cancel` request, no "Search stopped." and no permission notice (Story 2.3). No performance work (Story 2.4). No content matches, filters or the "Can't find…" box (Epics 5 and 6). No reference screenshots or Hebrew interface (Story 7.2). No protocol change to match entries. No Rust changes. No new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Results | search `report` in a folder with EARS-01 files | "Name matches (2)", two rows with location and date; announced "2 name matches found" | N/A |
| EARS-03 | `report.pdf`, `photo.jpg`; search `xyz123` | `searchDone.outcomeCode = "noMatches"`; "No matching files found" + "Try different words." | N/A |
| Streaming | 450 matches in batches | the count grows as batches arrive; no empty state while running | N/A |
| Deep location | match in `Documents\Projects\Acme` while searching Documents | location "Documents › Projects › Acme" | N/A |
| Open / Show | Enter on a folder row; Ctrl+Shift+E on a file row | browse view of that folder; browse view of its folder with the file selected | N/A |
| Leave | Esc or ✕ with results shown | browse view of the current folder, text cleared | N/A |
| Bad root | the searched folder was deleted | the browse empty state for `folderNotFound` | N/A |
| Restart | the engine restarts mid-search | matches so far stay; no "No matching files found" | N/A |

</frozen-after-approval>

## Code Map

- `engine/core/search/filename.py:96` -- `_done()` is called at :54 and :92. Count matches in `name_search` and pass the count. `engine/main.py:132` `search_handler` spreads it unchanged.
- `protocol/schemas/searchDone.schema.json` (`additionalProperties:false`) -- add optional `outcomeCode` (enum). Add `protocol/examples/search-done-no-matches.json`. `protocol/codes.json` -- add `outcomeCodes`. Code checks: `engine/tests/test_protocol_examples.py:45,52` and `app/src/protocol/examples.test.ts:41`. `npm run gen:protocol` regenerates `generated.ts`.
- `engine/tests/test_search_core.py:125-131,230,274` -- the exact searchDone asserts change. `engine/tests/test_stdio_roundtrip.py:493` `read_search` is used for the Correct Display round trip.
- `app/src/search/session.ts` -- the snapshot gains `open` and `root` (the searched folder's place). `search(text, place)` and `close()` (resets the snapshot and drops late replies). `:79` "Story 2.2 words it".
- `app/src/browse/BrowseList.tsx` -- `ICONS` :48, `isRtl`/`atPointer`/`atRow` :87-101, `move()` :156-170, the `Row` keydown :282-299 (Enter once per press, Shift+F10, Ctrl+Shift+E by `event.code`), `EmptyState` :365 (add an optional second line). Export or move these to share them. `browse/RowMenu.tsx:26` is reusable as is.
- `app/src/i18n/format.ts` -- `segmentName` :33 (breadcrumb labels), `folderErrorKey` :50, `displayType`/`typeLabel` :59/:79, `formatDate` :106. Matches (`generated.ts:163-199`) fit `Entry` structurally, minus `size`.
- `app/src/components/shell/panes.tsx:81` `MainArea` -- switch BrowseList/ResultList on `search.open`. It keeps the scroll-to-top effect.
- `app/src/components/shell/AppShell.tsx:13-51` and `TopBar.tsx:79-136` -- pass `search` to `MainArea`. Lift the Search Bar text so Esc, ✕ and navigation can clear it. Navigation actions also call `close()`.
- `app/src/browse/shortcuts.ts:22-47` -- the window listener skips `defaultPrevented`. Add Esc while the view is open. `RowMenu.tsx:99` and the breadcrumb's Esc already call preventDefault.
- `app/src/i18n/catalog.ts` -- flat `context.code` keys, checked by `engine/session.test.ts:129-138`. Add `search.nameMatches` ("Name matches ({count})"), `search.noMatches`, `search.tryDifferentWords`, `search.announceMatches`, `search.announceMatch`.
- New `app/src/search/ResultList.tsx` (+ test). `fixtures/correct-display-names.json` (`fixtures/` holds only README). Load it in TS by relative import, as `examples.test.ts:6` does, and in Python via `parents[2]`.
- Test helpers: `App.test.tsx:9-44,462-496`, `BrowseList.test.tsx:11-63`, `search/session.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `engine/core/search/filename.py`, `protocol/` (schema, example, codes.json) -- `outcomeCode` per Always; regenerate the TS types.
- [x] `app/src/search/session.ts` -- `open`, `root`, `close()`.
- [x] `app/src/browse/BrowseList.tsx` -- export the shared row pieces and the two-line `EmptyState`.
- [x] `app/src/search/ResultList.tsx` -- the header, rows, empty states and live region.
- [x] `panes.tsx`, `AppShell.tsx`, `TopBar.tsx`, `shortcuts.ts`, `catalog.ts` -- the view switch, Esc/✕/navigation leave, strings.
- [x] `fixtures/correct-display-names.json`, `fixtures/make_correct_display_tree.py <folder>` (builds the tree with empty files, for the manual check) and `fixtures/README.md` (what the list is for).
- [x] Tests -- engine: the outcome in `test_search_core.py`, codes in `test_protocol_examples.py`, the Correct Display round trip in `test_stdio_roundtrip.py`. App: `ResultList.test.tsx` (every matrix row, keys, menu, Correct Display), a `BrowseList.test.tsx` Correct Display test, session `close`, App tests (Esc/✕/navigation leave, Enter shows results), and catalog strings for every outcome code.

**Acceptance Criteria:**
- Given `tauri dev` and the Correct Display tree built in a folder, when I browse it and then search `.`, then every name and location reads in logical order with the extension at the end, in both views.
- Given `npm test`, `npm run typecheck`, `uv run pytest`, `cargo test` and the Pester suite, when run, then all pass.

## Implementation Notes

- Shared row pieces moved out of `BrowseList.tsx` into `app/src/browse/rows.tsx` (`ICONS`, `atPointer`/`atRow`, `moveTarget`, `rowKeyDown`, `rowContextMenu`, `EmptyState` with an optional `detail` line and an `announce` switch, `FolderErrorState`). `BrowseList` and `ResultList` both use them.
- `displayType` takes `Typed` (`kind` + `typeCode`), so name matches (no `size`) use it directly. `formatCount` added for "1,200".
- `MainArea` keeps `BrowseList` mounted inside a `hidden` wrapper while the search view is open, so its sort order and selection survive Esc. Scroll goes to the top on opening and leaving the view.
- Navigation leaves the view through a wrapper over `BrowseActions` in `AppShell` (`leavingSearch`), applied only while the view is open. Back/Forward/Up leave only when they actually go somewhere (`canBack`/`canForward`/`place.parent`). Navigation with the view closed doesn't touch the typed text.
- Esc from a result row moves focus to the Search Bar (the row is about to go). Esc from anywhere else keeps the focus where it is.
- Result rows are `role="option"` in a `role="listbox"` labelled by the "Name matches (n)" header. The selection belongs to the search's `parsed` reply, so a new search starts with nothing selected.
- The " › " and " · " separators are typographic constants in `ResultList.tsx`, outside the isolates, not catalog strings.
- The noMatches empty state is not a second status region: the live region announces it.
- The Correct Display list has 12 entries. Every name contains a dot and no segment does, so a search for `.` returns exactly the list.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap).

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | verification-gap, blind-hunter | Leaving via Forward, Up (button / Alt+↑) and a typed path, and staying on a no-op Back/Forward/Up, are untested | medium | patch | Pre-verified gap: `App.test.tsx` "App search view" only exercises Back with history, the nav pane, the breadcrumb, a folder row and Show in folder; `leavingSearch` is module-private. |
| 2 | blind-hunter | Correct Display ResultList test renders "Documents › Documents › התנדבות › Q3" | low | patch | The test searches from `DOCS` (named "Documents") while three fixture entries start with a "Documents" segment, so the rendered location doubles it. |
| 3 | blind-hunter | "Extension last" `endsWith` checks are tautological | low | patch | Each follows `expect(textContent).toBe(name)`, so it can never fail. Delete them. |
| 4 | blind-hunter | Bidi control characters (RLO/LRI…) in names aren't neutralised by `<bdi>` and the fixture has none | medium (unverified scope) | defer | The same `<bdi>` rendering has been in the browse list since Story 1.4; nothing in this story introduced it. |
| 5 | blind-hunter | The meta line truncates a deep location and its date with no tooltip | low | patch | `ResultList.tsx` meta `<p>` is `truncate` with no `title`; the name has one, the location doesn't. |
| 6 | blind-hunter | noMatches body branch hardcodes the code while `announcement()` uses `OUTCOMES` | low | reject | Only one code exists and `OUTCOMES` is typed to the schema enum; unifying needs a per-code body (icon, detail line), which is more than a direct correction for a speculative future code. |
| 7 | blind-hunter | Two-form plural (`announceMatch`/`announceMatches`) can't express Hebrew plurals | low | reject | The frozen intent names exactly these two strings; changing them means editing this build's spec, and the Hebrew interface is Story 7.2. |
| 8 | blind-hunter, edge-case-hunter | `open`/`openTyped`/`showInFolder` leave the view before the navigation succeeds | low | reject | `browse/session.ts:145` `openTyped` still issues `listFolder`; a failed one shows the path error over the current folder's browse view. Losing results on a mistyped path or a since-deleted folder is rare, and the fix needs a success callback from the browse session (new surface). |
| 9 | blind-hunter | F5 in the search view reloads the hidden listing and nothing visible happens | low | reject | The intent says F5 doesn't leave; re-running the search on F5 is new, unspecified behaviour, and F5 while viewing results is not an everyday path. |
| 10 | blind-hunter | Result rows don't give a file type to assistive tech | medium | patch | The icon is `aria-hidden` and there's no type text; a folder and a file with the same name have the same accessible name, but Enter does different things to them. |
| 11 | blind-hunter | A search a restart ended looks finished | false | reject | The engine banner (`App.tsx:34` `bannerVisible`, Story 1.2) already shows the restart; the matrix row "Restart" is met. |
| 12 | blind-hunter | An open row menu vanishes without returning focus when a new search starts | false | reject | Starting a search needs Enter in the Search Bar, so focus is already there when the menu unmounts; nothing falls to `<body>`. |
| 13 | blind-hunter | `make_correct_display_tree.py` `touch(exist_ok=True)` changes existing files' dates | low | patch | `Path.touch` updates mtime on an existing file, which contradicts the docstring and README and shifts the dates in the manual check. |
| 14 | blind-hunter, edge-case-hunter | Location prefix match is case-sensitive; the fallback shows "C:" and drops a UNC `\\` | low | reject | Both `place.path` and the match folders come from the engine's `resolve`, which gives on-disk casing (`core/ports/filesystem.py:78`), so the fallback needs a case-only rename between listing and search; even then the full path is still correct. |
| 15 | blind-hunter | `filename.py` docstring line not reflowed (~122 chars) | low | patch | Direct reflow. |
| 16 | blind-hunter | `assert NO_MATCHES == "noMatches"` repeats another test; `load(p)` is called twice per example | low | patch | Direct deletions in `test_search_core.py` and `test_protocol_examples.py`. |
| 17 | blind-hunter | The `navigation` memo depends on the whole `browse` snapshot | low | reject | Browse snapshots change only on loads, so the extra listener re-registration is negligible; narrowing it changes `leavingSearch`'s parameters. |
| 18 | blind-hunter | sprint-status `in-progress` vs spec `in-review`; Code Map path `engine/session.test.ts` | false / reject | reject | The sprint status moves at the workflow's `done` step; the Code Map path fix would edit this build's spec. |
| 19 | edge-case-hunter | A new search while the view is open keeps the previous scroll offset | false | reject | `search()` empties `matches` synchronously, so the main area's content shrinks and the browser clamps `scrollTop` to 0 before new matches arrive. |
| 20 | edge-case-hunter | `TopBar` without `onSearchText` ignores typing | false | reject | The only production caller (`AppShell.tsx:79`) passes it; the `panes.test.tsx` callers never type in the Search Bar. |
| 21 | edge-case-hunter | The fixture script crashes when an entry exists as the other kind | low | reject | Only after someone hand-edits the synthetic tree; the fix adds a guard branch. |
| 22 | edge-case-hunter | The fixture script prints no usage message under `python -OO` (`__doc__` is None) | low | patch | Direct correction: a literal usage string. |
| 23 | edge-case-hunter | Shared pieces are in `rows.tsx`, not exported from `BrowseList.tsx` | false | reject | The Code Map says "Export or move these to share them"; moving them is sanctioned and nothing imports them from `BrowseList`. |

## Verification

**Commands:**
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd engine && uv run pytest` -- expected: all pass
- `cd app/src-tauri && cargo test` (PowerShell, LF checkout of `engine.rs`) -- expected: all pass, unchanged
- `powershell -NoProfile -Command "Invoke-Pester app/scripts/network-check.Tests.ps1 -EnableExit"` -- expected: all pass, unchanged

**Manual checks:**
- Under `tauri dev`: search `report` (results, location, date, Open, Show in folder), then `xyz123` (empty state), then Esc and ✕. Browse the Correct Display tree and check that names read correctly in both views.
