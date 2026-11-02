---
name: File Browser 2.0
title: "EXPERIENCE: File Browser 2.0"
status: final
created: 2026-10-30
updated: 2026-11-01
sources:
  - ../../prds/prd-AIFile-browser-2026-10-26/prd.md
  - DESIGN.md
---

# File Browser 2.0 — Experience Spine

Terms in Title Case (Indexed Folder, Search Bar, Filename Search, Smart Search, Date Phrase, Filters, Result List, Match Reason, Close Match, Relevance Floor, Preview Panel, Correct Display, Activity Date) are used exactly as defined in the PRD Glossary (§3). Items tagged `[ASSUMPTION]` were inferred by Sally and accepted by the author on 2026-10-30.

**Mockups** (illustrations only; this spine and `DESIGN.md` win on any conflict):
- [`mockups/key-search.html`](mockups/key-search.html): search view in English (Flow 3) and in Hebrew RTL (Flow 2).
- [`mockups/key-states.html`](mockups/key-states.html): browse view with no selection and indexing running (EARS-02), no results with no Filters (EARS-03), and no results with a Filter active.
- [`mockups/key-first-run.html`](mockups/key-first-run.html): first-run folder chooser (Flow 1). Its part 2 ("Index settings") is superseded by `key-search-folders.html`.
- [`mockups/key-search-folders.html`](mockups/key-search-folders.html): the "Search folders" dialog, and the "Can't find a file you know is there?" box in the no-results state.
- [`mockups/key-date-only.html`](mockups/key-date-only.html): date-only search ("I worked on a document last week") in Hebrew RTL and English, with the narrowing hint (PRD FR-23).

The context menu, the Date and Type popovers, the dark theme and the backend-error banner are spine-only.

## Foundation

- **Form factor:** a single-window Windows 11 desktop app (Tauri). Mouse and keyboard; touch works but isn't designed for.
- **UI system:** shadcn/ui (Radix primitives) on React + TypeScript + Tailwind. `[ASSUMPTION]` This spine specifies only behavior beyond shadcn defaults.
- **Visual identity:** `DESIGN.md`. Tokens are referenced as `{path.to.token}`.
- **Languages:** English and Hebrew interface, following the Windows display language (PRD FR-18). Hebrew is fully RTL.
- **Offline:** nothing in the experience depends on a network. No sign-in, update check or online help link. Help is in the app and in the README.

## Information Architecture

| Surface | Reached from | Purpose | PRD |
|---|---|---|---|
| First-run folder chooser | First launch only | Pick the Indexed Folders. Documents and Desktop are pre-checked. | FR-7 |
| Main window: browse view | App open (Documents folder), nav pane, breadcrumbs | Browse, sort and open files | FR-1 to FR-4 |
| Main window: search view | Pressing Enter in the Search Bar | Result List in two groups, "Name matches" and "Content matches" | FR-5, FR-6, FR-12 to FR-17 |
| Preview Panel | Always beside the main list (browse and search views) | Check the selected file before opening it | FR-22 |
| Search folders | Gear button in the top bar, the status bar, or the links in the "Can't find a file you know is there?" box | See and change which folders are searched, check for new documents, and see which files can't be searched inside and why | FR-7, FR-10, FR-11 |

- The browse view and the search view are the same window. Clearing the Search Bar (✕ or Esc) returns to the browse view of the current folder.
- The nav pane lists: the Indexed Folders under the heading "Search folders", then Documents, Desktop and Downloads, then the local drives. `[ASSUMPTION]`
- The word "index" never appears in the interface. The Indexed Folders are called "Search folders", and the PRD's "Update index" is labeled "Check for new documents" (PRD §3, FR-10, FR-11).
- Search folders opens as a `Dialog` (one level deep). No other surface stacks on top of it.
- The installer and uninstaller (FR-19, FR-21) use the standard Windows installer UI and are out of scope here.

## Voice and Tone

Plain, calm, everyday words. The user never sees "embedding", "vector", "query", "backend" or error codes. Brand posture lives in `DESIGN.md`.

| Do | Don't |
|---|---|
| "Reading your documents: 340 of 2,100" | "Indexing… 16% (340/2100 docs embedded)" |
| "Search by name, or describe what you remember" | "Enter a semantic query" |
| "No matching files found" | "0 results returned" |
| "You don't have permission to open this folder." | "Error 5: Access denied" |
| "Close match" | "Low confidence (0.42)" |
| "Remember what it was about? Add a word to narrow it down." | "What was the document about?" as a question the user must answer (PRD §7: no follow-up questions) |
| "Indexing in progress: results may be incomplete" | "Index not ready" |
| "Stored only in OneDrive" | "Cloud placeholder, not hydrated" |
| "The search stopped working. Trying again…" | Stack traces or "Python process exited" |

Fixed strings come from the PRD verbatim, and each has a Hebrew version (FR-18). The Hebrew translations are written by the author. `[ASSUMPTION]`

## Component Patterns

Behavioral. Visual specs are in `DESIGN.md` → Components.

| Component | Behavior |
|---|---|
| Search Bar | Typing does nothing until **Enter** (PRD FR-12). Enter runs Filename Search and Smart Search together. If a Date Phrase is recognized, it is removed from the Search Bar text and becomes the active Date Filter chip, and the remaining text stays in the bar. If the remaining text has no content words (only filler such as "I worked on", "document", "file", "עבדתי על", "מסמך", "קובץ", from a fixed list, no AI), the search becomes a **date-only search** (see State Patterns). `[ASSUMPTION: filler list]` ✕ or **Esc** clears the text and returns to the browse view. While a search runs, Esc cancels it. |
| Breadcrumb bar | Each segment is clickable. Clicking the empty area or pressing **Alt+D** turns it into an editable path field. Enter opens a valid path. An invalid path shows "This folder doesn't exist." under the field and keeps the current folder (FR-2). |
| Filter chips | **Date** opens a `Popover` with the presets "Last week", "Last month", "Last year" and a custom from–to `Calendar`. **Type** opens a `DropdownMenu` with checkboxes for PDF, Word, Text and Markdown. Each change re-runs the current search. ✕ on an active chip clears it and re-runs the search. A Date Filter set by a Date Phrase looks and works exactly like one set by hand. Clearing it puts the phrase back into the Search Bar as ordinary text (FR-15). |
| File list (browse) | Columns: name, type, size, modified. Clicking a header sorts by it, and clicking again reverses. Single click selects (and updates the Preview Panel). Double-click or Enter opens. Right-click or **Shift+F10** opens the context menu. Single selection only. `[ASSUMPTION]` |
| Result List | "Name matches" appear first as soon as Filename Search finishes, then "Content matches" below them. Each group is a separate list with its own count. Arrow keys move across both groups. At most 20 content matches, at most 5 of them Close Matches (FR-17). No paging and no "show more". |
| Content result row | Selecting it updates the Preview Panel. Enter or double-click opens the file. The context menu has "Open" and "Show in folder". "Show in folder" leaves the search view, navigates to the containing folder and selects the file (FR-3). |
| Preview Panel | Follows the selection with no extra click. Updates within 2 seconds (FR-22). Shows the details, then the first 2,000 characters of text for TXT, text-based PDF, DOCX and MD files in any folder, including folders that aren't indexed. The file is read only on selection and nothing is stored. The text is read-only and can be selected and copied. A toggle (the panel icon in the top bar, or **Alt+P**) hides or shows it, and the choice is remembered. `[ASSUMPTION: Alt+P]` |
| Context menu | "Open" and "Show in folder" only. No rename, delete or move (PRD C-4). |
| Status bar | Shows indexing progress, or "Up to date · N documents" when idle. Clicking it opens Search folders. |
| Folder chooser | Heading "Which folders should I search inside?", one explanatory line, and the privacy line "Your files stay on this computer." Checkbox list with Documents and Desktop pre-checked, "Add folder…" (Windows folder picker), and "Start" (primary). Nothing is read until Start is pressed (FR-7). "Skip for now" closes it, and Filename Search and browsing still work. `[ASSUMPTION: skip allowed]` |
| Search folders | Lead line: "I search inside the documents in these folders. Every other file can still be found by its name." Three sections. **① Folders I search inside:** the Indexed Folders with "Remove" for each, "+ Add folder…", and a status line "✓ Up to date · N documents · last checked today at 9:14 AM" with a "Check for new documents" button (FR-10). **② Files I can't search inside:** "I can still find these by name, just not by what's inside them. There's nothing you need to fix." Skipped and unsupported files are grouped by reason, each group with a count and a one-line explanation in the first person (scanned documents and pictures; older Word files, .doc; other file types; password-protected; stored only in OneDrive). A group expands to list its files with their locations (FR-11). **③ Advanced** (collapsed): start over (rebuild) and delete what the app has learned, each with a plain confirmation that says user files are not touched (FR-11). Button: "Done". This section is informational: nothing in ② asks the user to act. |

## State Patterns

| Surface | State | Treatment |
|---|---|---|
| Browse view | Loading a folder | Skeleton rows for up to 300 ms, then the list. `[ASSUMPTION]` |
| Browse view | Empty folder | Empty state: "This folder is empty." |
| Browse view | Access denied | Empty state: "You don't have permission to open this folder." Back still works (FR-4). |
| Search view | Search running | Spinner in the Search Bar. Results already found stay visible. Esc cancels. |
| Search view | Cancelled | Results found so far stay. Notice: "Search stopped." No "No matching files found" message (FR-6, FR-17). |
| Search view | Indexing still running | Notice banner: "Indexing in progress: results may be incomplete" above "Content matches" (FR-13). |
| Search view | Close Matches present | Close Matches sit at the end of "Content matches", each with the "Close match" label. |
| Search view | No results, no Filters active (EARS-03) | Empty state: "No matching files found" and "Try different words." Below it, an info box in `{colors.notice-info}`: "Can't find a file you know is there? I may not be able to search inside it, if: it's a scanned document or a picture; it's an older Word file (.doc), or an Excel or PowerPoint file; it's in a folder I don't search inside. Try searching for a word from its name instead." Links: "See files I can't search inside" (opens Search folders at section ②) and "Search folders". |
| Search view | Results shown, but maybe not the one wanted | A single line at the end of the Result List: "Can't find a file you know is there? See why" opens the same explanation. `[ASSUMPTION]` |
| Search view | No results with Filters active | Empty state: "No matches from Oct 1–31, 2025" (filter text varies), with one button per active Filter: "Clear date filter", "Clear type filter" (FR-17). |
| Search view | Date-only search ("I worked on a document last week") | Instead of the two groups, one list: "Documents from Oct 19–25, 2025 (7)", every indexed document whose Activity Date is in the range, newest first, up to 50. The Type Filter still applies. No Relevance Floor and no Close Match labels, because nothing is ranked by meaning. Above the list, a hint in `{colors.notice-info}`: "Remember what it was about? Add a word to narrow it down." It has a ✕ and never blocks the list. If the range has no documents: "No documents from Oct 19–25, 2025" with "Clear date filter". Clearing the Date Filter of a date-only search clears the whole search and returns to browsing. `[ASSUMPTION: 50 cap, Name matches hidden]` (PRD FR-23) |
| Search view | No Indexed Folders yet | "Content matches" shows: "Choose folders to search inside your documents." with a "Choose folders" button. Name matches work as usual. |
| Search view | Some folders skipped (permissions) | Results still show. Small notice: "Some folders couldn't be searched because you don't have permission." (FR-6) |
| Preview Panel | No file selected, or a folder selected (EARS-02) | Centered message: "Select a file to preview". |
| Preview Panel | File in a supported format (any folder) | Details, then the text preview. Hebrew and mixed text with Correct Display. |
| Preview Panel | No text preview | Details, then a plain reason: "No preview for this file type", "This file can't be read", or "Stored only in OneDrive". Online-only files are never downloaded. |
| Preview Panel | Loading | Details appear at once. The text area shows a skeleton until the text arrives. |
| Status bar | First indexing | "Reading your documents: 340 of 2,100" with a progress bar. |
| Status bar | Idle | "Up to date · 2,100 documents". |
| Status bar | Updating on startup | "Checking for changed documents…" |
| Global | Backend not responding | Banner: "The search stopped working. Trying again…". Browsing that doesn't need the backend stays usable. When it recovers, the banner disappears and the Index is intact (NFR-10). |
| Global | Index format changed after an update | One-time notice: "Your documents are being re-read for the new version." (FR-20) |

## Interaction Primitives

**File Explorer muscle memory.** Users bring File Explorer habits, so shortcuts match File Explorer wherever one exists. `[ASSUMPTION: exact map]`

| Key | Action |
|---|---|
| Ctrl+E or Ctrl+F | Focus the Search Bar |
| Enter (in the Search Bar) | Run the search |
| Esc | Cancel a running search, or else clear the Search Bar and return to browsing |
| Alt+D | Edit the path in the breadcrumb bar |
| Alt+← / Alt+→ | Back / forward |
| Alt+↑ | Parent folder |
| ↑ / ↓ | Move the selection (updates the Preview Panel) |
| Enter (on a row) | Open the file or folder |
| Shift+F10 or the Menu key | Context menu |
| Ctrl+Shift+E | Show in folder |
| Alt+P | Show or hide the Preview Panel |
| F5 | Reload the current folder |

- In the Hebrew interface, Alt+← and Alt+→ keep their meaning (back and forward), but the arrow icons are mirrored.
- **Not supported:** drag and drop, multi-select, rename in place, and any action that changes a file (PRD C-4, NFR-8).
- No auto-search while typing. Search runs only on Enter, so the user is in control and slow searches don't fire on every key.

## Accessibility Floor

Behavioral. Visual contrast is in `DESIGN.md` → Colors.

- Every core action (browse, search, set Filters, open, show in folder, preview) works with the keyboard alone (PRD NFR-11).
- WCAG 2.2 AA is the target. `[ASSUMPTION]`
- Tab order follows reading order: top bar → filter bar → nav pane → main list → Preview Panel → status bar. In Hebrew it follows the mirrored order.
- Focus is always visible, with a 2px `{colors.primary}` ring.
- Windows Narrator: result counts ("12 content matches") and indexing progress are announced through a polite live region, at most once every 10 seconds for progress. Close Match rows announce "Close match" before the file name.
- Windows text scaling up to 200% works without clipped text. Long names wrap to two lines and then truncate with an ellipsis, and the full name appears in a tooltip and in the Preview Panel.
- Windows contrast themes (forced colors) are respected. The Close Match label and active chips stay distinguishable through their text and border, not only their color.
- No information is carried by color alone: Close Match has a text label, and active Filters show their value.
- Reduced motion: when Windows animation effects are off, the progress bar and skeletons don't animate.

## Bidirectional Text and RTL

This section turns the PRD's Correct Display requirement into behavior.

- **Layout mirroring** (Hebrew interface): the whole window mirrors, as described in `DESIGN.md` → Layout & Spacing. Directional icons (back, forward, breadcrumb separators) mirror. Icons with no direction (search, file type, gear) don't.
- **File names, paths and Passages** are shown in their own direction in either interface. Each one is isolated (`<bdi>` / `dir="auto"`), so a Hebrew name in the English interface, or an English name in the Hebrew interface, doesn't reorder the text around it.
- **Extensions stay at the end of the name**, in the logical order: `סיכום ישיבה 3.docx`, never `docx.3 סיכום ישיבה`.
- **Paths keep the real order of their segments** (`Documents › Volunteering`), and each segment is isolated.
- **Dates and numbers** use the interface language's format: "Oct 14, 2025" in English, "14 באוק׳ 2025" in Hebrew. Numbers in progress text ("340 of 2,100") are isolated, so they don't flip.
- **Search Bar direction** follows the first strong character typed (`dir="auto"`), so a Hebrew query is right-aligned even in the English interface.
- The fixed list of test names in the repository (PRD Glossary, Correct Display) covers the browse list, both result groups and the Preview Panel.

## Responsive & Platform

The app runs in a resizable desktop window.

| Window width | Behavior |
|---|---|
| ≥ 1280px | Nav pane, main list and Preview Panel all visible |
| 960–1279px | The Preview Panel is hidden by default and opens as an overlay from the side when toggled (Alt+P). The nav pane stays. |
| < 960px | Not supported. The minimum window size is 960×600. |

The app remembers its window size, position and Preview Panel toggle between sessions. `[ASSUMPTION]`

## Inspiration & Anti-patterns

- **Taken from Windows File Explorer:** layout, breadcrumb bar with an editable path, column sorting and the keyboard map. Users shouldn't have to learn a new file browser.
- **Taken from Explorer's preview pane:** a side panel that follows the selection, now with the text of the document.
- **Rejected: a chat interface.** The app isn't a chat assistant (PRD §7). One Search Bar, one Result List.
- **Rejected: a "here's what I understood" panel** (Topic / When / Type). It was removed in PRD revision 2. Visible, clearable Filter chips replace it.
- **Rejected: silently widening an empty date range.** The user sees "No matches from …" and chooses to clear the Filter.
- **Rejected: highlighting matched words** (PRD FR-16). The Passage excerpt is the explanation.
- **Rejected: an endless result list.** At most 20 content matches. Showing more buries the right file (PRD SM-C1).
- **Rejected: AI decoration** (sparkles, "magic" wording, animated thinking). It works against the "calm File Explorer" posture.

## Key Flows

### Flow 1 — Yossi sets it up and gets value before indexing finishes (UJ-1)

Yossi, 67, a retired teacher, has just installed the app on his home PC.

1. On first launch, the folder chooser opens: "Which folders should I search inside?" Documents and Desktop are already checked. A line under the list says: "Your files stay on this computer."
2. He presses **Start**. The main window opens on Documents, and the status bar shows "Reading your documents: 0 of 2,100".
3. He clicks the Search Bar, types "pension" and presses Enter.
4. "Name matches (2)" appears at once. Below it, the banner "Indexing in progress: results may be incomplete" sits above three content matches.
5. He presses ↓ to select the first name match. The Preview Panel shows its details and the first lines of the letter.
6. **Climax:** the letter in the Preview Panel is the one he was looking for. He presses Enter, and it opens in Word. He found it without waiting for indexing and without learning anything new.

Failure: he presses "Skip for now" in the folder chooser by mistake. Name matches still work, and "Content matches" shows "Choose folders to search inside your documents." with a "Choose folders" button that brings the chooser back.

### Flow 2 — Dana finds last year's school-committee summary in Hebrew (UJ-2)

Dana, a working parent who volunteers on her son's school committee, uses the Hebrew interface. The layout is mirrored.

1. She types *"סיכום ועד ההורים מאוקטובר 2025"* and presses Enter.
2. The Date Phrase "מאוקטובר 2025" leaves the Search Bar and becomes the active chip "Date: Oct 1–31, 2025" (in Hebrew). The text "סיכום ועד ההורים" stays in the bar.
3. "Content matches" shows `סיכום ישיבה 3.docx` first, located in `Documents › Volunteering`, modified "14 באוק׳ 2025". The extension stays at the end of the name.
4. The Match Reason shows the Passage "…the class trip budget was approved by the parents' committee…" (in Hebrew), followed by the tag "Modified Oct 2025".
5. **Climax:** she selects it, the Preview Panel shows the meeting summary in correct right-to-left order, and she presses Enter to open it.

Failure: nothing matches in October 2025. The empty state says "No matches from Oct 1–31, 2025" with a "Clear date filter" button. She presses it, the phrase returns to the Search Bar as plain text, the search re-runs with no Date Filter, and a summary from November appears.

### Flow 3 — Michael combines a date range and a topic in English (UJ-3)

Michael, a freelance developer, uses the English interface and the keyboard.

1. He presses Ctrl+E and types *"user permission management between January 10 and January 20"*.
2. He opens the **Type** chip and checks **PDF**, then presses Enter.
3. Two chips are active: "Date: Jan 10–20, 2026" and "Type: PDF". "Name matches" shows only PDFs, and "Content matches" shows PDFs modified in that range, best first.
4. The top content match shows a Passage about role-based access, which doesn't use the word "permission".
5. **Climax:** he presses Ctrl+Shift+E. The app leaves the search view, opens the PDF's folder and selects the file, ready for his next step.

Failure: the top two results are labeled "Close match". He reads the Passages in the Preview Panel, decides they're wrong, and clears the Type Filter with ✕. The search re-runs, and a Word document with the right content appears.

### Flow 4 — Checking a file before opening it (EARS-02, EARS-03)

Dana is browsing `Documents › Volunteering` in the browse view.

1. Nothing is selected yet. The Preview Panel shows "Select a file to preview".
2. She clicks a subfolder once. The panel still shows "Select a file to preview", because a folder isn't a file.
3. She presses ↓ to select `photo.jpg`. The panel shows its details and "No preview for this file type".
4. She types "xyz123" in the Search Bar and presses Enter. No Filters are active.
5. **Climax:** the main list shows "No matching files found" with "Try different words" and the "Can't find a file you know is there?" box, instead of unrelated files. She trusts that the file isn't there and rewords her search.

Failure: she presses Esc while the search is still running. The search stops with the notice "Search stopped", and "No matching files found" doesn't appear, because the search didn't finish.
