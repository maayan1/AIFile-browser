# Epic 2 Context: Find files by name

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let users find files and folders by full or partial name in the current folder and all its subfolders, straight from the file system. Name search needs no Index, so it works right after install. Users see name results with location and date, can open them or show them in their folder, can cancel or replace a running search, aren't blocked by folders they can't open, and get "No matching files found" when nothing matches. The project now ends at Epic 2, so the epic also takes one add-on, Story 2.5: a square file thumbnail in the Preview Panel. Images show the real image, other files show a "mini page", and TXT/MD files show their first lines. Story 2.5 is not in the epics file and no planning doc defines thumbnails, so its story spec governs the details. The full text preview (2,000 characters, PDF/DOCX extraction, Epic 4) is out of scope.

## Stories

- Story 2.1: Search names in this folder and its subfolders
- Story 2.2: See name results and "No matching files found"
- Story 2.3: Cancel a search, and keep going past folders I can't open
- Story 2.4: Keep name search fast in very large folders
- Story 2.5: File thumbnail in the Preview Panel (add-on)

## Requirements & Constraints

- **Name search:** runs only on Enter. Matches file and folder names that contain the text, case-insensitive, Hebrew and English, in the current folder and every subfolder. An extension typed as text matches like any other text. EARS-01: with `report.pdf`, `photo.jpg` and `report-final.docx`, searching `report` returns only the two report files.
- **Results** show name, location and last-modified date, with Open and in-app Show in folder.
- **No results:** a finished search with no results and no Filters shows "No matching files found" and "Try different words." The engine decides this through `searchDone.outcomeCode`. It never appears after a cancel.
- **Cancel:** results found so far stay, and "Search stopped." appears. Folders skipped for permission don't stop the search; the permission notice appears with the results.
- **Speed:** under 6 s from Enter to results for 90% of searches on a ~50,000-file tree on the Baseline PC (Windows 11, 8 GB RAM, 4 cores). Record the measurement. Add no filename cache unless the target is missed.
- **Read-only:** the app never modifies, moves or deletes user files. The only exception is New file (`createFile`). It creates one new, empty file in the listed folder. The name must be a single valid file name, never a path. It never overwrites, never creates a missing folder, and never changes anything that exists. The row menu stays Open and Show in folder only. A thumbnail only reads.
- **Privacy:** offline only, with no network code anywhere. Logs hold paths and codes only, never document text, file contents or search text. Thumbnail content is read on selection and never stored or cached to disk.
- **Strings:** every user-visible string lives in the one EN/HE catalog with `context.code` keys. A test asserts that every protocol code has an English and a Hebrew string. Never use jargon like "index", "query" or error codes.
- **Correct Display:** names and paths show in logical order, with extensions at the end and each item isolated. They are checked against the fixed test-name list in `fixtures/`, which covers the browse list, Name matches and the Preview Panel.

## Technical Decisions

- **Search conversation:** each search sends one `search {id, text, folder}`. The replies come in order: `searchParsed` → `nameMatches` → exactly one terminal `searchDone {outcomeCode?, notices[], indexVersion, indexingActive}`, or `cancelled`. Query parsing goes through one core `parse_query()`.
- **Hexagonal engine:** product rules live in `engine/core`, which talks to the world only through ports. Core tests use fake adapters.
- **One path to user files:** all file access goes through the engine's FileSystemPort (`list()`, `walk()`) and the core's `is_candidate()`. That predicate skips hidden and system items, `~$*` files, and junction/symlink loops. Attributes come from directory enumeration. Never open a `RECALL_ON_DATA_ACCESS` file, and never descend into a `RECALL_ON_OPEN` directory. Online-only OneDrive files are never downloaded. The UI shell's only direct OS call is "open with default app", so image and text bytes for a thumbnail come through the engine, not straight from the UI. Any read for a preview needs a size cap and a timeout taken from `engine/core/rules/`.
- **Latest-wins per channel:** there are three channels, `search`, `preview` and `listFolder`. A new request cancels the running one on its own channel only. Holding ↓ must never queue previews, and a stale reply must never overwrite a newer selection. Long operations check their cancel token between files or directories.
- **ReadOutcome:** one core enum shared by preview and (later) indexing. Its values include `storedOnlyInOneDrive`, `passwordProtected`, `noTextLayer`, `tooLarge`, `cannotRead` and `unsupportedType`. Adapters return raw facts, the core maps them to an outcome, and the UI maps outcome codes to catalog strings. Per-file failures are ReadOutcomes, not protocol errors.
- **Thin UI:** the engine sends codes and data, never sentences. The UI holds no product rules, such as which files get which preview. New messages are added as JSON Schemas plus examples in `protocol/`. TS types are generated from them, and both sides parse every example.
- **Paths and dates:** the engine normalizes incoming paths. Replies carry original-case display paths and ISO 8601 dates. Formatting happens only in the UI catalog.

## UX & Interaction Patterns

- **Search Bar:** 44px high, up to 640px wide, 18px input, radius 6, 1px primary border (2px when focused). Placeholder "Search by name, or describe what you remember". A clear ✕ appears once there is text, and a spinner replaces the magnifier while a search runs. Uses `dir="auto"`. Esc cancels a running search, or otherwise clears the bar and returns to browse.
- **Result List:** "Name matches (n)" group label (13px/600). Arrow keys move the selection, and Enter or double-click opens. Ctrl+Shift+E is Show in folder. The empty state is an outline icon and one sentence, never red. Notices use the notice-info banner.
- **Preview Panel:**
  - Layout: surface-pane background (#F3F3F3 / #202020), 320px wide, flat, with a 1px border and no shadow. File icon and name in the title style (20px/600), then a details block (location, type, size, modified) in body-sm 13px muted. Text uses the excerpt style (14px/1.5) inside a ScrollArea and is selectable and read-only.
  - Behavior: it follows the selection with no extra click and updates within 2 s.
  - States: with no file selected or a folder selected, it shows a centered "Select a file to preview" (EARS-02). While loading, the details appear at once with a skeleton for the content. When there is nothing to show, it gives a plain reason: "No preview for this file type", "This file can't be read" or "Stored only in OneDrive".
  - Shape and color: radii 4/6/8, and only the theme tokens, which follow Windows light/dark.
- **Responsive (Story 4.1, out of scope):** at 1280px or wider, all three panes show. From 960 to 1279px, the Preview is hidden by default and opens as a side overlay with Alt+P. The toggle and window size are remembered.
- **Accessibility:** everything works by keyboard, including preview. Focus shows a 2px primary ring, and meaning never relies on color alone. Contrast meets WCAG 2.2 AA. The layout survives 200% text scaling, and long names wrap to two lines with the full name in a tooltip and the Preview. Forced colors are respected. With reduced motion, skeletons don't animate. Result counts are announced in a polite live region.
- **Bidirectional text:** names, paths and preview text are isolated (`<bdi>` / `dir="auto"`). The whole layout mirrors in Hebrew, with the Preview on the left. Directional icons mirror, and file-type icons don't.

## Cross-Story Dependencies

- 2.1 sets up the `search` chain, `parse_query` and the walker. 2.2 renders `nameMatches` and `searchDone.outcomeCode`. 2.3 adds `cancel`/`cancelled`, latest-wins and the permission notice. 2.4 measures the finished path.
- 2.5 builds on the Preview Panel shell, which today shows only "Select a file to preview", and on selection in both the browse list and Name matches. It adds the first `preview`-channel request, so it must follow the latest-wins and ReadOutcome rules above and stay compatible with Epic 4's future preview message (details first, then content).
- Reuses from Epic 1: FileSystemPort and `is_candidate()`, the RECALL rules, access-denied handling, Open and Show in folder, the catalog, the protocol tooling, and engine restart handling (pending requests end locally on restart).
