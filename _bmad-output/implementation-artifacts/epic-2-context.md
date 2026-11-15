# Epic 2 Context: Find files by name

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let users find files and folders by full or partial name in the current folder and all its subfolders, straight from the file system. Name search needs no Index, so it works right after install and keeps working while documents are being read later. Users see clear name results with location and date, can open them or show them in their folder, can cancel or replace a running search, aren't blocked by folders they can't open, and get "No matching files found" when nothing matches. The epic also delivers the Correct Display test-name list and measures name-search speed on a large tree. Phase done when: every name-search criterion passes, including EARS-01, EARS-03 (name search only) and Correct Display of Hebrew and mixed-direction names, and the speed target is measured and recorded.

## Stories

- Story 2.1: Search names in this folder and its subfolders
- Story 2.2: See name results and "No matching files found"
- Story 2.3: Cancel a search, and keep going past folders I can't open
- Story 2.4: Keep name search fast in very large folders

## Requirements & Constraints

- Search runs only on Enter. Typing does nothing. It matches names that *contain* the text (files and folders) in the current folder and every subfolder. Matching is case-insensitive and works for Hebrew and English. An extension typed as text (".pdf") matches like any other text; filtering by type comes later as a separate filter.
- EARS-01: with `report.pdf`, `photo.jpg` and `report-final.docx`, searching `report` returns only the two report files. A folder `reports` would also match.
- Results show name, location and last-modified date, and support Open (default app) and in-app Show in folder.
- EARS-03 (until content search arrives): a name search that finishes with no results and no Filters shows "No matching files found" plus "Try different words." The engine decides this through `searchDone.outcomeCode`. A cancelled search never shows it.
- Cancel: results found so far stay and the notice "Search stopped." appears. A new Enter replaces the running search. Folders skipped for permission don't stop the search; the notice "Some folders couldn't be searched because you don't have permission." appears with the results.
- Correct Display: Hebrew, English and mixed-direction names and paths show in logical order, with extensions at the end and path segments in real order, each isolated. They are verified against a fixed test-name list in `fixtures/`, in the English interface, in both the browse list and Name matches.
- Performance: under 6 s from Enter to results on screen for 90% of searches on a ~50,000-file tree on the Baseline PC (Windows 11, 8 GB RAM, 4 cores, no GPU). Record the measurement in the repo. Walk the tree on every search. A filename cache is allowed only if the measurement misses the target.
- Read-only on user files, offline, no database, simplicity first. Fixtures must be synthetic. Logs hold paths and codes only, never search queries.

## Technical Decisions

- **Search conversation:** one Enter sends one `search` request `{id, text, folder}`. The request shape already allows `dateFilter?`, `typeFilter?` and `literalPhrases[]` for later epics. This epic's replies on that `id`, in order: `searchParsed {mode, dateRange, residualText}` → `nameMatches` → exactly one terminal `searchDone {outcomeCode?, notices[], indexVersion, indexingActive}`, or `cancelled` instead. Content and date-only replies come in later epics, so keep the message order and envelope extensible.
- **Parsing:** query parsing lives in one core function, `parse_query(text, literal_phrases)`, whose normalization will later be shared with date and filler matching. In this epic the mode is always `normal`.
- **File access:** walk with FileSystemPort `walk()` and filter with the same core `is_candidate()` used by browsing (skip hidden/system items, `~$*`, and junction/symlink loops). Never open files. Never descend `RECALL_ON_OPEN` directories. Attributes come from directory enumeration.
- **Concurrency:** latest-wins on the `search` channel: a new search cancels the running one, and only that channel is affected. The walk checks its cancel token between directories. The UI sends `cancel` for the `id` on Esc. Filename search is served right away and never waits for model or Index loading.
- **Thin UI:** the engine sends codes and notice codes, never sentences. Outcomes like no-results, permission-skipped and stopped are codes mapped to strings in the one catalog (`context.code` keys). Add new message types as JSON Schemas with examples in `protocol/`. TS types are generated from them, and tests on both sides parse every example.
- **Paths:** the engine normalizes the incoming `folder`. Results carry original-case display paths as strings, and dates in ISO 8601. Date formatting happens only in the UI catalog.
- **Rules live in the core.** Matching, the outcome decision and which notices to send all go in `engine/core/search`, tested with fake adapters.

## UX & Interaction Patterns

- **Search Bar:** magnifier at the start, 18px input, 44px high, up to 640px wide, 1px primary border (2px when focused), radius 6. Placeholder "Search by name, or describe what you remember". Clear ✕ appears once there is text. A spinner replaces the magnifier while a search runs. Uses `dir="auto"`.
- **Keys:** Ctrl+E or Ctrl+F focuses the bar. Enter searches. Esc cancels a running search, or otherwise clears the bar and returns to the browse view of the current folder (✕ does the same). Browse and search views share one window.
- **Result List:** group header "Name matches (n)" (group-label 13px/600, muted, with the count) in the main list. Arrow keys move the selection. Enter or double-click opens. Show in folder (Ctrl+Shift+E, context menu) leaves search view, navigates there and selects the file. No paging.
- **Rows:** names and paths isolated (`<bdi>` / `dir="auto"`). Long names wrap to two lines, then end with an ellipsis, and a tooltip shows the full name. Location and date use body-sm, muted.
- **Empty state:** an outline icon and one sentence, never red. **Notices** such as "Search stopped." and the permissions notice use the notice-info banner style: a full-width strip above the list with an info icon.
- **Accessibility:** result counts are announced through a polite live region. Everything works by keyboard.
- **Voice:** plain words only. Never say "index", "query" or error codes.

## Cross-Story Dependencies

- 2.1 sets up the `search` request/reply chain, `parse_query` and the walker. 2.2 renders its `nameMatches` and `searchDone.outcomeCode`. 2.3 adds `cancel`/`cancelled`, latest-wins and the permission notice on top of 2.1. 2.4 measures the finished path from 2.1–2.3.
- Reuses from Epic 1: `walk()`, `is_candidate()` and the RECALL rules, access-denied handling, Open and in-app Show in folder, the catalog, the protocol tooling and engine restart handling (pending searches end locally on restart).
- Later reuse: Epic 5 adds "Content matches" beside "Name matches" and moves the EARS-03 decision to the combined results. Epic 6 adds the Type Filter, which also filters Name matches and hides folders from them, and has name search use the text with the Date Phrase removed. Story 7.2 reuses the Correct Display list for both layouts.
