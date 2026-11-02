---
title: "PRD: File Browser 2.0"
status: final
revision: 2
created: 2026-10-26
updated: 2026-11-02
---

# PRD: File Browser 2.0

> **Find the file you remember, not just the filename you know.**

## 0. Document Purpose

This product requirements document (PRD) defines what the File Browser 2.0 minimum viable product (MVP), the first public release, must do. It is the input for the architecture phase and for epic and story planning. It builds on the final product brief (`../../briefs/brief-AIFile-browser-2026-10-26/brief.md`) and does not repeat the brief's problem analysis or competitive research.

How to read it:
- Every domain term is defined once in §3 Glossary. The rest of the document uses those terms exactly.
- Features are in §4. Each functional requirement (FR-1 … FR-23) lists its delivery phase, its dependencies and its testable acceptance criteria. The three EARS requirements carried over from Exercise 1 are in §4.0, each with its acceptance test and the FR that carries it.
- Quality requirements that apply to the whole app, called non-functional requirements (NFR-1 … NFR-12), are in §5. Hard constraints (C-1 … C-7), including **no database** and the **fixed technology stack**, are in §6.
- Anything inferred without the author's confirmation is tagged `[ASSUMPTION]` and listed in §11.
- "Post-MVP" means a release after this MVP. It is not a commitment.
- Technical "how" (process layout, index file format, packaging) lives in `addendum.md`.
- How the app looks and behaves (screens, states, keyboard, right-to-left layout and mockups) is in the UX design: `../../ux-designs/ux-AIFile-browser-2026-10-30/` (`DESIGN.md`, `EXPERIENCE.md`, `mockups/`).
- What changed since the previous revision of this PRD is summarized in §12.

## 1. Vision

File Browser 2.0 is an offline Windows 11 file browser for everyday, non-technical users. Users find documents by describing what they remember, in Hebrew or English: *"the parents' committee document from October 2025."* The app searches the contents of the user's Indexed Folders by meaning, applies any Filters, and returns a ranked Result List with a Match Reason for each file.

Everything happens on the user's computer. The embedding model (the app's single local AI component, see §3) ships inside the installer and runs on an ordinary processor. The app needs no internet connection, account or technical setup, and file contents, metadata and queries never leave the device.

Around the search sits a normal file browser (folders, breadcrumbs, open file), so the user never has to switch to File Explorer to act on what they found.

## 2. Target User

### 2.1 Jobs to be done

- **Functional:** "When I need a document I made a while ago, help me find it from what it was about and roughly when I worked on it, even though I've forgotten its name and folder."
- **Emotional:** "Let me feel in control of my files, not stupid for 'losing' them."
- **Contextual:** "I write in Hebrew, English or both, and I won't learn search syntax or install technical tools."
- **Privacy:** "Don't send my personal documents anywhere to do it."
- **Builder (the author):** "Ship a complete, well-engineered local AI product as a public GitHub portfolio project."

### 2.2 Non-users (MVP)

- Power users who want instant filename search across entire drives (Everything serves them better).
- Teams, shared drives and network storage.
- People whose files live only in the cloud.
- Users who need file management: move, rename, delete, deduplicate or organize.

### 2.3 Key user journeys

- **UJ-1. Yossi sets it up and gets value before indexing finishes.**
  Yossi, 67, a retired teacher, downloads the installer once and runs it. No other installs, no account. On first launch the app asks which folders to search and suggests Documents and Desktop. He accepts. Indexing starts in the background with a progress indicator ("Reading your documents: 340 of 2,100"). Meanwhile he types "pension" into the Search Bar and gets Filename Search matches right away. He opens one with a double-click, and it opens in Word. **Edge case:** he types a topic before indexing is done. Content matches come from the files indexed so far, with a notice that indexing is still running.

- **UJ-2. Dana finds last year's school-committee summary in Hebrew.**
  Dana, a working parent who volunteers on her son's school committee, needs a meeting summary from last October. She types: *"סיכום ועד ההורים מאוקטובר 2025"* ("the parents' committee summary from October 2025"). The app recognizes the Date Phrase and sets the Date Filter to **Oct 1–31, 2025**, shown as a filter she can clear. The top result is `סיכום ישיבה 3.docx` in `Documents\Volunteering`, modified October 14, 2025, with the Match Reason (translated from Hebrew) "…the class trip budget was approved by the parents' committee… · Modified Oct 2025." She opens it. **Edge case:** if nothing matches in that range, the app says "No matches from Oct 1–31, 2025" and offers to clear the Date Filter with one click.

- **UJ-3. Michael combines a date range and a topic in English.**
  Michael, a freelance developer, types *"user permission management between January 10 and January 20"* and picks **PDF** in the Type Filter. The app recognizes the Date Phrase and sets the Date Filter to Jan 10–20, 2026 (no year was given, so it uses the most recent January). The app keeps only PDFs modified in that range, ranks them by how closely their content matches the query, and shows the best one with its matching Passage. He clicks "Show in folder".

## 3. Glossary

- **Indexed Folder:** a folder the user explicitly chose for Smart Search, including all its subfolders. The user can add and remove Indexed Folders. Nothing outside them is ever read for indexing. In the interface these are called "Search folders".
- **Supported Document:** a file in an Indexed Folder with a format the MVP can extract text from: TXT, text-based PDF, DOCX or MD.
- **Index:** the local data the app builds from Supported Documents (metadata, extracted text, Passages and their Embeddings). It is stored only on the user's computer, as plain files, never in a database (see C-1). "Index" is a term for this document only: the interface never shows the word to the user.
- **Passage:** a short section of a Supported Document's text. It is the unit Smart Search matches against. One Supported Document has one or more Passages.
- **Embedding:** a list of numbers the local AI model produces for a Passage, so that texts with similar meaning can be found together. The app uses one embedding model (C-3).
- **Search Bar:** the single text input at the center of the app, used for both Filename Search and Smart Search.
- **Filename Search:** matching the Search Bar text against file and folder names in the current folder and its subfolders, read directly from the file system. It does not need the Index.
- **Smart Search:** matching the Search Bar text against the Index by meaning, limited by the active Filters.
- **Date Phrase:** a date expression in the query that the app recognizes by fixed rules ("between January 10 and 20", "in March", "last week"). The supported list is in FR-14. A recognized Date Phrase sets the Date Filter.
- **Date-only search:** a search whose query is only a Date Phrase plus filler words, such as "I worked on a document last week". It lists the documents from that time by date instead of searching by meaning (FR-23).
- **Activity Date:** the file's last-modified time. The Date Filter is compared against it.
- **Filters:** the Date Filter (an Activity Date range) and the Type Filter (one or more of PDF, Word, Text, Markdown). Both are visible controls the user can set or clear.
- **Result List:** the ranked list of files returned by a search.
- **Match Reason:** the short explanation shown with each Smart Search result, saying why the file matched.
- **Close Match:** a Smart Search result shown with a visible low-confidence label because its relevance is below the relevance threshold (FR-17).
- **Relevance Floor:** the minimum relevance a Smart Search result needs to be shown at all. It is lower than the Close Match threshold. Results below it are never shown (FR-17).
- **Preview Panel:** the read-only area beside the file list and the Result List that shows the selected file's details and the start of its text (FR-22).
- **Correct Display:** Hebrew, English and mixed-direction text (names, path segments, Passages) is shown in logical reading order, with file extensions at the end and path segments in the order of the real path. It is verified against a fixed list of test names kept in the repository, compared with reference screenshots.
- **Baseline PC:** the reference computer that performance targets are measured on (spec in NFR-5).

## 4. Features

Each FR states **Phase** (§8.3) and **Depends on** (FRs that must exist first).

### 4.0 EARS requirements (from Exercise 1)

These three requirements come from Exercise 1 (`earsRequirments` in the earlier `file-browser-agentic` repository) and are written in EARS form ("When / While / If … the app shall …"). Wording is adapted only where this product's terms differ. Each is carried by an FR below, and its acceptance test is part of that FR.

| ID | Type | Requirement | Carried by | Phase |
|---|---|---|---|---|
| EARS-01 | Event-driven | When the user enters a search term, the app shall display every file and folder in the current folder and its subfolders whose name contains the search term. | FR-5 | 2 |
| EARS-02 | State-driven | While no file is selected, the app shall display a "Select a file to preview" message in the Preview Panel. | FR-22 | 3 |
| EARS-03 | Unwanted behavior | If a search has finished with no results and no Filters are active, then the app shall display a "No matching files found" message in the Result List. | FR-6, FR-17 | 2, 4 |

**Acceptance tests**
- **EARS-01:** in a folder containing `report.pdf`, `photo.jpg` and `report-final.docx`, searching for `report` shows only `report.pdf` and `report-final.docx`.
- **EARS-02:** in a folder containing files, with no file selected, the Preview Panel shows "Select a file to preview". The same message appears when a folder is selected, and when the selection is cleared (for example by clicking an empty area of the list).
- **EARS-03:** in a folder containing `report.pdf` and `photo.jpg`, with no Filters active, searching for `xyz123` shows no Name matches and no Content matches, and the message "No matching files found" appears. In Phase 2 the test covers Filename Search only. From Phase 4 it covers both groups, with the Index built from the SM-1 collection.

Changes from Exercise 1: "selected folder" became the current folder, and folders are also matched (FR-5). EARS-02 was deferred in Exercise 1 and is now in the MVP (FR-22). EARS-03's "listing has completed" became "a search has finished", and its message is limited to searches with no active Filters (FR-17 keeps a separate message when Filters are active). Exercise 1's project constraints (browser-only processing, no stored metadata) belonged to the earlier project and are replaced by C-1 to C-7.

### 4.1 Folder Browsing

**Description:** A familiar file-browser view. It lets the app stand on its own, and it is where the user acts on search results. Realizes UJ-1 and UJ-3.

#### FR-1: Browse local folders
**Phase:** 1 · **Depends on:** none

The user can open any local drive or folder and see its files and subfolders, with name, type, size and last-modified date.
- On launch, the app opens the user's Documents folder.
- The list can be sorted by each column.
- Hebrew, English and mixed-direction names have Correct Display (verified in Phase 2).

#### FR-2: Navigate
**Phase:** 1 · **Depends on:** FR-1

The user can go into a subfolder, up to the parent folder, back and forward through history, and to any ancestor via clickable breadcrumbs.
- Typing or pasting a valid path into the breadcrumb bar opens that folder. An invalid path shows a message and leaves the current folder open.

#### FR-3: Open a file or its folder
**Phase:** 1 · **Depends on:** FR-1

From the browser view or any Result List, the user can open a file in its Windows default application, or show it in its containing folder.
- Double-click or Enter opens the file. The context action "Show in folder" navigates the app to the containing folder and selects the file.

#### FR-4: Respect Windows permissions
**Phase:** 1 · **Depends on:** FR-1

Folders and files the user cannot access are shown with a clear message instead of an error or a crash.
- Navigating into an access-denied folder shows "You don't have permission to open this folder." The app keeps working.

### 4.2 Filename Search

**Description:** Classic name search, available immediately after install, with no Index needed. Realizes UJ-1.

#### FR-5: Search by full or partial name
**Phase:** 2 · **Depends on:** FR-1

The user can type text into the Search Bar to find files and folders whose names contain that text, in the current folder and all its subfolders.
- Pressing Enter in the Search Bar runs the search.
- Matching is case-insensitive and works for Hebrew and English names.
- "report" returns `Report 2025.pdf`, `monthly-report.docx` and the folder `reports\`.
- Typing an extension as part of the name (".pdf") matches it like any other text. Filtering by type uses the Type Filter (FR-15).
- **EARS-01 acceptance:** in a folder containing `report.pdf`, `photo.jpg` and `report-final.docx`, searching for `report` shows only `report.pdf` and `report-final.docx` (§4.0).

#### FR-6: Filename results
**Phase:** 2 · **Depends on:** FR-3, FR-5

Results show name, location and last-modified date, and each result supports the FR-3 actions.
- Hebrew, English and mixed-direction names and paths have Correct Display.
- The user can cancel a running search. Folders skipped because of permissions do not stop the search (FR-4).
- In Phases 2 and 3, before Smart Search exists: if a Filename Search finishes with no results, the app shows "No matching files found" (EARS-03). From Phase 4, FR-17 decides when this message appears. A cancelled search never shows it.

### 4.3 Document Indexing

**Description:** The user decides what the app may read. The app extracts text, creates Embeddings with the local model, and stores the Index on the user's computer. Realizes UJ-1.

#### FR-7: Choose Indexed Folders
**Phase:** 3 · **Depends on:** FR-1

On first launch the user picks Indexed Folders. Documents and Desktop are suggested. They are indexed only after the user confirms. Later, the user can add or remove Indexed Folders in settings.
- Nothing outside the Indexed Folders is ever indexed.
- Removing an Indexed Folder deletes its data from the Index.

#### FR-8: Extract text from Supported Documents
**Phase:** 3 · **Depends on:** FR-7

The app extracts text from TXT, text-based PDF, DOCX and MD files and splits it into Passages.
- Hebrew text is extracted in correct logical (reading) order, including from PDFs.
- Files the app can't read (scanned or image-only PDFs, password-protected or corrupted files) are skipped with a recorded reason. They still appear in Filename Search.
- Online-only files (cloud placeholders, such as OneDrive files that aren't stored on the PC) are never downloaded. They are skipped with the reason "Stored only in OneDrive" and still appear in Filename Search.
- TXT and MD files are decoded correctly whether saved as UTF-8 or as the legacy Windows Hebrew encoding (Windows-1255). `[ASSUMPTION]`

#### FR-9: Build the Index in the background
**Phase:** 3 · **Depends on:** FR-8

The app creates an Embedding for each Passage with the bundled local model and stores the Index locally as plain files (C-1). Indexing runs without blocking the interface and shows progress ("Reading your documents: 340 of 2,100").
- The user can browse and use Filename Search while indexing runs.
- If the app closes during indexing, the next start continues from where it stopped. Already indexed documents are not processed again.

#### FR-10: Update the Index incrementally
**Phase:** 3 · **Depends on:** FR-9

The Index is updated on app startup and when the user selects "Check for new documents". Only added, modified, renamed and deleted Supported Documents are processed.
- A document counts as modified when its last-modified time or size differs from the values stored in the Index.
- An update on an unchanged collection of ~5,000 Supported Documents finishes in **< 60 seconds** on the Baseline PC.
- Changes made while the app is running are picked up on the next startup or manual update. There is no live file watching.

#### FR-11: Index status and reset
**Phase:** 3 · **Depends on:** FR-9

The user can see the state of the Index and reset it. In the interface this screen is called "Search folders". It explains; nothing on it is needed to get accurate results.
- The status shows the Indexed Folders, the document count, the last update, skipped files with their reasons, and a count of files in Indexed Folders whose format isn't supported, by extension (for example ".doc: 214").
- The user can rebuild the Index or delete all Index data.

### 4.4 Smart Search

**Description:** The core feature. The user types what they remember. The app recognizes any simple Date Phrase, ranks the indexed Passages by meaning, and applies the Filters. Realizes UJ-2 and UJ-3.

#### FR-12: One Search Bar, both kinds of results
**Phase:** 4 · **Depends on:** FR-6, FR-13

Pressing Enter in the Search Bar runs both Filename Search and Smart Search. The Result List shows them in two labeled groups, "Name matches" and "Content matches". `[ASSUMPTION: no mode switch]`
- A one-word query that matches filenames still shows any content matches below them.
- Filename Search uses the query text with any recognized Date Phrase (FR-14) removed.
- A query that is only a Date Phrase plus filler words is a date-only search and follows FR-23 instead.

#### FR-13: Search by meaning
**Phase:** 4 · **Depends on:** FR-9

Smart Search finds Supported Documents whose content matches the query by meaning, not only by exact words.
- A query for "employee management system design" can return a document that says "HR platform architecture" and never uses the query words.
- Queries work in Hebrew and in English.
- While indexing runs, Smart Search returns matches from the documents indexed so far and shows "Indexing in progress: results may be incomplete" (UJ-1).
- Cross-language matching (Hebrew query → English document and the reverse) is not required. `[ASSUMPTION]`

#### FR-14: Recognize simple Date Phrases
**Phase:** 4 · **Depends on:** FR-15

The app recognizes the following Date Phrases in Hebrew and English with fixed rules (no AI model) and sets the Date Filter from them. The Date Phrase is then removed from the text used for meaning matching.

| Pattern | English example | Hebrew example | Date Filter set to |
|---|---|---|---|
| Exact date | "on March 5, 2026", "5.3.2026", "5/3/2026" | "ב-5 במרץ 2026", "5.3.2026" | That day |
| Date range | "between March 1 and 15", "between January 10 and January 20", "between March 28 and April 3" | "בין 1 ל-15 במרץ", "בין 28 במרץ ל-3 באפריל" | That range, inclusive |
| Month | "in March", "from October 2025" | "במרץ", "מאוקטובר 2025" | The whole month |
| Year | "in 2025" | "ב-2025" | The whole year |
| Relative day | "today", "yesterday" | "היום", "אתמול" | That day |
| Relative period | "last week", "last month", "last year", "previous week", "previous month", "previous year", "a week ago", "a month ago", "a year ago" | "בשבוע שעבר", "שבוע שעבר", "בשבוע הקודם", "לפני שבוע", "בחודש שעבר", "חודש שעבר", "בחודש הקודם", "לפני חודש", "בשנה שעברה", "שנה שעברה", "בשנה הקודמת", "לפני שנה" | The full calendar week (Sunday to Saturday), month or year before the current one `[ASSUMPTION: "a week ago" means last week]` |

- Numeric dates are read day first (day.month.year or day/month/year), so "5.3.2026" is March 5, 2026.
- If no year is given, the phrase means the most recent such period that started on or before today. On October 28, 2026, "in March" means March 2026 and "in November" means November 2025.
- Phrases outside this table are treated as ordinary query text. They do not cause an error.
- A fixed test list of at least 60 phrases (30 Hebrew, 30 English) is kept in the repository. It includes every example in this table, the Glossary, UJ-2 and UJ-3, plus negative cases that must not set a Date Filter (for example "in the fall", "March budget.docx"). 100% of the list produces the expected result. `[ASSUMPTION: list size]`

#### FR-15: Date Filter and Type Filter
**Phase:** 4 · **Depends on:** FR-6, FR-12, FR-13

The user can limit results with a Date Filter (the presets "Last week", "Last month" and "Last year", which use the FR-14 definitions, or a custom from–to range) and a Type Filter (PDF, Word, Text, Markdown).
- Active Filters are always visible. The user can clear each one with one click, and the search re-runs.
- A Date Filter set by a Date Phrase (FR-14) looks and behaves the same as one set by hand.
- Once a Date Phrase has set the Date Filter, that phrase is not recognized again for the same query. Clearing that Date Filter turns the phrase back into ordinary query text, and the search re-runs with no Date Filter. A date-only search is the exception (FR-23).
- Both Filters apply to the "Content matches" group. The Type Filter also applies to "Name matches".
- Type Filter extensions: PDF = `.pdf`; Word = `.docx` and `.doc`; Text = `.txt`; Markdown = `.md`. Only `.docx` Word files can appear in "Content matches", because `.doc` is not a Supported Document.

#### FR-16: Ranked results with a Match Reason
**Phase:** 4 · **Depends on:** FR-13, FR-15

Smart Search results are ranked by relevance, best first. Each shows name, location, Activity Date and a Match Reason.
- The Match Reason shows the best-matching Passage (trimmed to about two lines) and each active Filter the file satisfied ("Modified Oct 2025", "PDF").
- The Match Reason comes from the search itself. No generative model is used.

#### FR-17: Uncertain and empty results
**Phase:** 4 · **Depends on:** FR-16

The app shows the best results it has above the Relevance Floor.
- Results below a relevance threshold are labeled Close Match. The threshold is a fixed value, tuned on the SM-1 test set in Phase 4.
- Results below the Relevance Floor are not shown. The floor is a fixed value, tuned in Phase 4 against two targets: SM-1 stays at ≥ 80% (including at least 4 of its 5 one-word queries), and every query in a fixed list of at least 10 nonsense queries (for example "xyz123") returns no Content matches. The list is kept in the repository. `[ASSUMPTION: list size]`
- If one value can't meet both targets, SM-1 wins. Even then, "xyz123", the EARS-03 test query, must always return no Content matches.
- The "Content matches" group shows at most the top 20 results, and at most 5 of them are Close Matches.
- If no results match the active Filters, the app says so ("No matches from Oct 1–31, 2025") and offers a one-click action to clear each active Filter.
- If a search finishes with no results in either group and no Filters are active, the app shows "No matching files found" (EARS-03) and suggests trying different words. A cancelled search does not show this message. While indexing runs, the FR-13 notice is also shown.
- Below that message, the app explains why a file the user knows exists might not be found: it is a scanned document or a picture, it is in a format the app can't read inside (for example `.doc`), or it is not in an Indexed Folder. It suggests searching by name instead and links to the "Search folders" screen (FR-11). A short "Can't find a file you know is there?" link to the same explanation also appears at the end of any Result List. The explanation never asks the user to change anything.

#### FR-23: Date-only search
**Phase:** 4 · **Depends on:** FR-14, FR-15

When the user remembers only when they worked on a document, a query such as "I worked on a document last week" lists the documents from that time instead of searching by meaning.
- A query is date-only when it contains a recognized Date Phrase (FR-14) and the rest of the text is only filler words from a fixed list kept in the repository (for example "I worked on", "document", "file", "עבדתי על", "מסמך", "קובץ"). Fixed rules, no AI model (C-3).
- The Result List shows one group, "Documents from Oct 25–31, 2026 (7)", listing every Supported Document whose Activity Date is in the range, newest first, up to 50. The Type Filter still applies. "Name matches" is not shown.
- No Relevance Floor and no Close Match labels apply, because nothing is ranked by meaning.
- Above the list, the hint "Remember what it was about? Add a word to narrow it down." appears. The user can close it, and it never blocks the list. The app does not ask a follow-up question (§7).
- If the range has no documents, the app shows "No documents from Oct 25–31, 2026" with a one-click action to clear the Date Filter.
- Clearing the Date Filter of a date-only search clears the whole search and returns to browsing the current folder. The phrase does not turn back into query text (an exception to FR-15), because the rest of the query has no content to search for.
- Results appear within 2 seconds of pressing Enter on the Baseline PC with ~5,000 indexed Supported Documents. `[ASSUMPTION: 2 seconds]`
- **Acceptance:** "I worked on a document last week" and "עבדתי על מסמך בשבוע שעבר" both produce the date-only list for the previous calendar week. "budget last week" is not date-only: it runs Smart Search with the Date Filter set.

### 4.5 Interface Language

**Description:** The whole app speaks the user's language, including right-to-left Hebrew. Realizes UJ-2.

#### FR-18: English and Hebrew interface
**Phase:** 5 · **Depends on:** FR-1 to FR-17, FR-22, FR-23 (applies to every screen)

The interface is available in English and Hebrew and follows the Windows display language. English is the fallback. There is no manual language switch in the MVP.
- In Hebrew, the whole layout is right-to-left (RTL).
- Mixed Hebrew/English filenames, paths and Passages have Correct Display in both layouts.
- Every user-visible string, including error messages, exists in both languages.

### 4.6 Offline Packaging

**Description:** A non-technical user installs once and is done. Realizes UJ-1.

#### FR-19: Standalone Windows installer
**Phase:** 5 · **Depends on:** FR-1 to FR-18, FR-22, FR-23

One Windows installer contains the app, the Python backend with its runtime, and the embedding model.
- After install, the app works with the network disabled.
- The user never installs Python, an AI runtime, developer tools or extra downloads.
- The MVP installer is not code-signed. The README explains, step by step, how to get past the Windows SmartScreen warning.

#### FR-20: Manual updates
**Phase:** 5 · **Depends on:** FR-19

Updates are delivered as a new installer that the user downloads and runs by hand. The app never checks for updates on its own.
- Installing a newer version keeps the Indexed Folders and the Index. If the Index format changed, the app rebuilds it automatically and says so.

#### FR-21: Clean uninstall
**Phase:** 5 · **Depends on:** FR-19

Uninstalling removes the app.
- The user is asked whether to also delete the Index data.
- User files are never touched.

### 4.7 File Preview

**Description:** The user can check that a file is the right one before opening it. Supports UJ-2 and UJ-3.

#### FR-22: Preview the selected file
**Phase:** 3 · **Depends on:** FR-1, FR-8

The Preview Panel sits beside the file list and the Result List. When the user selects one file, the panel shows its name, location, type, size and last-modified date. For a file in a supported format (TXT, text-based PDF, DOCX or MD) it also shows the start of its text, in any folder the user can open.
- The file is read only when the user selects it, and nothing from the preview is stored in the Index. Indexed Folders limit only what is indexed (FR-7), not what can be previewed.
- While no file is selected (nothing is selected, or a folder is selected), the Preview Panel shows "Select a file to preview" (EARS-02).
- The text preview shows the first 2,000 characters of the document's text, read-only, extracted the same way as in FR-8. `[ASSUMPTION: 2,000 characters]`
- Hebrew, English and mixed-direction text has Correct Display (verified in Phase 5).
- Files with no text preview (unsupported formats, files the app can't read, online-only files) show their details and a plain reason, such as "No preview for this file type" or "Stored only in OneDrive". Online-only files are never downloaded (FR-8).
- The preview appears within 2 seconds of selecting the file on the Baseline PC. `[ASSUMPTION]` Very large files depend on the maximum file size in Open Question 2.
- Previewing never changes the file (C-4) and works with the keyboard alone (NFR-11).

## 5. Cross-cutting non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-1 | Privacy | The app makes **zero network connections** to other devices or the internet during install and use: no telemetry, no crash reporting, no update checks. "The app" means the app process, its WebView2 component and the Python backend. Windows itself and programs the user opens from the app (FR-3) are not counted. The WebView2 runtime's own updater (the Microsoft EdgeUpdate service) is a Windows component and is not counted. Connections made by the app's WebView2 processes are counted: a Phase 1 check records them with a firewall log and disables each by configuration, and any that can't be disabled is reported to the author before Phase 2. Verified with the network disabled and by firewall log. |
| NFR-2 | Performance: Smart Search | Results in **< 6 seconds** on the Baseline PC with ~5,000 indexed Supported Documents. Measured from pressing Enter to the Result List on screen, and met by 90% of the SM-1 queries, excluding the first search after launch. The first search after launch takes **≤ 10 seconds**. |
| NFR-3 | Performance: Filename Search | Completes in **< 6 seconds** for a folder tree of ~50,000 files on the Baseline PC, measured the same way as NFR-2. `[ASSUMPTION: same target as Smart Search]` |
| NFR-4 | Performance: indexing | ~5,000 Supported Documents fully indexed in **< 30 minutes** on the Baseline PC, in the background. The interface never freezes for more than 0.5 s during indexing. `[ASSUMPTION: 0.5 s threshold]` |
| NFR-5 | Baseline PC | Windows 11 64-bit, 8 GB RAM, 4-core processor, no dedicated graphics or AI chip (GPU or NPU). Windows 11 is the only supported platform. |
| NFR-6 | Resource use | While indexing, the app keeps the PC usable: background-priority work and **≤ 2 GB RAM** for the whole app. `[ASSUMPTION: RAM ceiling]` |
| NFR-7 | Installer size | **≤ 1 GB**, including the Python runtime and the model. |
| NFR-8 | Data safety | The app **never modifies, moves or deletes user files**. It only reads them. A crash or power loss never leaves a corrupted Index. Worst case, the Index rebuilds itself. |
| NFR-9 | Local security | The backend accepts requests only from the app itself and is not reachable from other devices. Index data is stored in the current user's Windows profile (for example `%LOCALAPPDATA%`), not in a shared location. |
| NFR-10 | Error handling | Every error the user can hit (access denied, unreadable file, invalid path, backend not responding) shows a plain-language message in the interface language, with no stack traces or error codes. If the backend stops, the app shows a message and recovers without losing the Index. |
| NFR-11 | Accessibility | Every core action (browse, search, set Filters, open, show in folder) works with the keyboard alone. `[ASSUMPTION]` |
| NFR-12 | Licensing | Every bundled model and library has a license that allows redistribution in a free, public GitHub release. |

## 6. Constraints and guardrails

- **C-1. No database (author decision).** The MVP uses no SQL database, vector database or other database management system.
  - Folder browsing and Filename Search read the Windows file system directly.
  - Smart Search uses a local Index made of JSON files plus locally stored Embedding files.
  - A database may be considered in a later version only if measurement against NFR-2 to NFR-4 shows the plain-file Index can't meet them.
- **C-2. Offline only.** No cloud services, external AI services, accounts or online synchronization. All processing runs locally on the processor (NFR-1, FR-19).
- **C-3. One AI model.** The MVP uses exactly one local embedding model. No generative models, OCR (optical character recognition) models or other AI models. Date Phrases (FR-14) are recognized by fixed rules.
  - If no model meets every constraint, they give way in this order. The license (NFR-12) and offline operation (C-2) never give way. Next is search quality (SM-1 ≥ 80%), then installer size (NFR-7), then speed (NFR-2, NFR-4).
- **C-4. Read-only on user files.** See NFR-8. Any feature that writes to user files is outside the MVP.
- **C-5. Technology stack (author decision).**

  | Layer | Choice |
  |---|---|
  | Frontend | React + TypeScript |
  | Styling | Tailwind CSS |
  | Desktop framework | Tauri |
  | Backend | Python, bundled with the app (FR-19) |
  | AI | One local embedding model (C-3) |
  | Storage | Local JSON files and Embedding files (C-1) |
  | Platform | Windows 11 (NFR-5) |

  Integration and packaging notes are in `addendum.md`.
- **C-6. Simplicity first.** The implementation stays simple and modular, with no abstractions or infrastructure that a current requirement doesn't need. Performance work (caching, splitting files, approximate search) is done only when a measured NFR target is missed. Each phase delivers working, testable software (§8.3).
- **C-7. Public repository.** The source code is published on GitHub. It contains no secrets, keys or personal test documents. Search-quality test fixtures (SM-1) use synthetic or freely licensed documents.

## 7. Non-goals

These describe what the MVP deliberately is not. §8.2 says which of them may come later.

- **Not a file manager.** The MVP does not move, rename, delete, copy, deduplicate or organize files.
- **Not a chat assistant.** No conversation, follow-up questions, generated summaries or answers.
- **Only fixed Date Phrases.** Only the Date Phrases in FR-14 are recognized. For any other date, the user sets the Date Filter by hand.
- **Not cloud or network search.** No Google Drive, OneDrive, network shares or sync.
- **Not a whole-disk indexer.** Only Indexed Folders are read for Smart Search.
- **Not cross-platform.** Windows 11 only.
- **Not an OCR tool.** Scanned and image-only documents are skipped.

## 8. MVP scope and release plan

### 8.1 In scope
FR-1 to FR-23, NFR-1 to NFR-12 and constraints C-1 to C-7. In short: folder browsing, a file Preview Panel, Filename Search, user-selected Indexed Folders, text extraction (TXT, PDF, DOCX, MD), a local plain-file Index, Smart Search (search by meaning) with simple Date Phrases and Filters, an English/Hebrew RTL interface, fully offline operation, and a standalone Windows installer.

### 8.2 Out of scope for the MVP

| Item | Status |
|---|---|
| Seasonal, vague, holiday and Hebrew-calendar date expressions ("in the fall", "a while ago", "around Passover") | Post-MVP |
| Location clues inside the query ("in Documents") | Post-MVP |
| Live file watching, and pausing or resuming indexing | Post-MVP, if users need them |
| Cross-language matching as a requirement | Possible post-MVP (Open Question 1) |
| Legacy Word `.doc`, PPTX, XLSX and other formats | Not in the MVP (author decision: keep the MVP small). These files stay findable by name. |
| Manual interface-language switch | Not in the MVP |
| Code-signed installer | Not in the MVP (README explains the SmartScreen step) |
| OCR for scanned and image-only documents | Post-MVP |
| Conversational search | Post-MVP |
| AI file management: organize, rename, deduplicate | Post-MVP |
| A database or vector database | Only if measurement requires one (C-1) |
| Cloud sources (Google Drive, OneDrive, network shares) | Not planned |
| Windows 10, macOS and Linux | After the MVP |

### 8.3 Release plan
Each phase ends with working, testable software that can be demonstrated in the GitHub repository.

| Phase | Deliverable | Requirements | Phase is done when |
|---|---|---|---|
| 1 | **Basic File Browser.** React, TypeScript, Tailwind and Tauri set up. Basic communication with the Python backend. File and folder browsing, navigation, opening files. | FR-1 to FR-4, C-5 | The app runs from source, lists a real folder via the backend, navigates, and opens a file. An access-denied folder shows the FR-4 message. |
| 2 | **Filename Search.** Search in a folder and its subfolders, result display, Hebrew and English filenames. | FR-5, FR-6 | Every FR-5 and FR-6 criterion passes, including EARS-01, EARS-03 (Filename Search only) and Correct Display of Hebrew and mixed-direction names. NFR-3 is measured and recorded. |
| 3 | **Document Indexing.** Folder selection, text extraction, local Embeddings, plain-file Index, incremental update on startup and on demand. File Preview Panel. | FR-7 to FR-11, FR-22, C-1, C-3, NFR-8 | The EARS-02 test passes. A Hebrew DOCX shows its text in the Preview Panel, and so does a DOCX outside the Indexed Folders. A ~5,000-document test collection indexes, survives a forced close mid-indexing, and updates only changed files. NFR-4 and NFR-6 are measured and recorded. A packaged backend with the model is built and its size is recorded against NFR-7. |
| 4 | **Smart Search.** Hebrew and English queries, simple Date Phrases, Date Filter and Type Filter, ranked results. | FR-12 to FR-17, FR-23 | The FR-14 phrase list passes 100%. The Relevance Floor is tuned as FR-17 requires, and EARS-03 passes for both groups. The FR-23 acceptance queries pass within its time target. A first SM-1 run is recorded. NFR-2 is measured. |
| 5 | **Interface Finalization, Testing and Packaging.** Bilingual English/Hebrew interface with RTL, error handling and usability, search-quality and performance testing, offline verification, backend and model bundled with Tauri, standalone Windows installer. | FR-18 to FR-21, NFR-1 to NFR-12 | The installer installs on a clean Windows 11 PC with the network disabled, and SM-1 to SM-5 pass. |

## 9. Success metrics

**Primary**
- **SM-1: Search quality.** On a fixed test set of 30 Smart Search queries (15 Hebrew, 15 English `[ASSUMPTION: split]`, some including Date Phrases, and at least 5 one-word queries such as "pension" `[ASSUMPTION: 5 one-word queries]`) over a fixed synthetic collection of at least 500 mixed Hebrew and English documents, including look-alike documents on the same topics, the expected file appears in the top 5 results for **≥ 80%** of queries, and for at least 4 of the 5 one-word queries. The test set and its score are kept in the repository and re-run before every release. Validates FR-13 to FR-16.
- **SM-2: Speed.** Smart Search returns results in **< 6 s** on the Baseline PC with ~5,000 Supported Documents. Validates NFR-2.

**Secondary**
- **SM-3: Indexing.** ~5,000 Supported Documents indexed in **< 30 min** on the Baseline PC. Validates FR-9 and NFR-4.
- **SM-4: Privacy.** **0** network connections by the app (as defined in NFR-1) to other devices or the internet during install and a scripted usage session (firewall log). Validates NFR-1 and FR-19.
- **SM-5: First-run usability.** 3 non-technical testers each install the app, choose folders and find a known document with Smart Search without help. Following the README's SmartScreen step (FR-19) counts as without help. `[ASSUMPTION: tester count]` Validates UJ-1 and FR-7.

**Counter-metrics (do not optimize)**
- **SM-C1: Number of results.** Showing more results raises the chance of a top-5 hit but buries the answer and erodes trust. Close Matches stay labeled and within the FR-17 limit. Counterbalances SM-1.
- **SM-C2: Speed bought with a weaker model.** Don't meet SM-2 by switching to a model that drops SM-1 below 80%. Counterbalances SM-2.
- **SM-C3: Indexing speed bought by skipping content.** Don't meet SM-3 by indexing only the start of each document or by skipping Hebrew PDFs. Counterbalances SM-3.

## 10. Open questions

1. Should cross-language matching (Hebrew query → English document) become a goal after the MVP, or stay a nice extra? (FR-13)
2. What's the maximum file size to extract? Very large PDFs could dominate indexing time. Proposal: a 50 MB cap. Larger files are skipped for content but stay findable by name. (FR-8)
3. Should Smart Search include folder and file names in meaning matching (for example a folder called "School committee")? (FR-13)
4. ~~How should a query that is only a Date Phrase ("files from last week") behave?~~ **Resolved 2026-11-01:** see FR-23.
5. Which single embedding model meets Hebrew quality, the 1 GB installer limit, processor speed and license constraints together? This is for the architecture phase, and the answer feeds SM-1 and SM-2. If no model meets all of them, C-3 sets the order in which they give way. (C-3, NFR-7, NFR-12)

The ten questions raised by the validation review were decided by the author on 2026-10-28 (§12.7).

## 11. Assumptions index

- §4.3 FR-8: legacy Hebrew encoding (Windows-1255) support for TXT and MD.
- §4.4 FR-12: one Search Bar runs both searches, with results in two groups and no mode switch.
- §4.4 FR-13: cross-language matching is not required.
- §4.4 FR-14: the Date Phrase test list has at least 60 phrases (30 Hebrew, 30 English).
- §4.4 FR-14: "a week ago", "לפני שבוע" and their month and year forms mean the previous calendar period, like "last week".
- §4.4 FR-23: date-only search shows results within 2 seconds.
- §4.4 FR-17: the nonsense-query list for tuning the Relevance Floor has at least 10 queries.
- §4.7 FR-22: the text preview shows the first 2,000 characters.
- §4.7 FR-22: the preview appears within 2 seconds of selection.
- §5 NFR-3: the Filename Search target equals the Smart Search target (< 6 s for ~50k files).
- §5 NFR-4: the interface never freezes for more than 0.5 s during indexing.
- §5 NFR-6: RAM ceiling of 2 GB while indexing.
- §5 NFR-11: keyboard-only operation of core actions.
- §9 SM-1: a 15 Hebrew / 15 English query split.
- §9 SM-1: at least 5 of the queries are one word long.
- §9 SM-5: 3 non-technical testers.

Confirmed by the author on 2026-10-28 and no longer assumptions: Activity Date is the modified time only; one shared Type Filter; Filename Search results shown when ready, with cancel; Match Reason without word highlighting; NFR-9 local security, including the Index location; NFR-10 error handling; the < 60 s update target (FR-10); the Sunday week start (FR-14).

## 12. Change log: PRD revision 2 (2026-10-28)

Revision 2 simplifies the MVP: it fixes the technology stack, cuts advanced natural-language date interpretation, removes performance work that no measured target requires yet, and reorganizes delivery into five phases. Revision 1 is kept as `prd.v1-2026-10-26.md`. An old requirement can appear in more than one table below when part of it was removed and the rest kept.

### 12.1 Removed from the MVP
| Item | Rev 1 ID | Reason |
|---|---|---|
| Season Time Clues ("in the fall", "last summer") | FR-15 | Advanced date interpretation removed. Post-MVP. |
| Automatic widening of an empty date range | FR-19 | Replaced by one-click clearing of the active Filters (FR-17). |
| Location clues inside the query ("in Documents") | FR-16 | Query parsing reduced to Date Phrases only. Post-MVP. |
| Query-understanding panel (Topic / When / Type) | FR-17 | Removed; replaced by visible, clearable Filters (FR-15). |
| Creation time as a secondary date signal | FR-15 | Activity Date is the modified time only. |
| Windows 10 best-effort support | NFR-5 | Platform fixed to Windows 11. |

### 12.2 Simplified
| Item | Rev 1 ID | Rev 2 ID | Change |
|---|---|---|---|
| Time Clues | FR-15 | FR-14 | Rule-based Date Phrases only: exact dates, ranges, months, years, five relative phrases. |
| Combined clues | FR-16 | FR-15 | Date Filter and Type Filter as visible controls instead of in-query clues. |
| Filter by file type | FR-6 | FR-15 | No in-query extension parsing. One shared Type Filter. |
| Keep the Index current | FR-11 | FR-10 | Incremental update on startup and on demand. No live file watching. |
| Background indexing | FR-10 | FR-9 | Pause/resume deferred. Resume after an interrupted run added (data safety). |
| Filename results | FR-7 | FR-6 | Results shown when ready, with cancel. No progressive streaming. |
| Match Reason | FR-18 | FR-16 | Best Passage excerpt plus satisfied Filters. No word highlighting. |
| No database | C-1 | C-1 | Restated. Also excludes vector databases. |

### 12.3 Added
| Item | Rev 2 ID | Reason |
|---|---|---|
| Fixed technology stack | C-5 | Author decision. |
| One-AI-model limit | C-3 | Author principle: no additional AI models. |
| Simplicity and no premature optimization | C-6 | Author principle. |
| Local security (backend isolation, per-user Index location) | NFR-9 | Needed because of the separate Python backend. |
| Plain-language error handling | NFR-10 | Phase 5 scope: improve error handling. |
| Date Phrase acceptance test list | FR-14 | Measurable acceptance for the simplified date feature. |
| Phase exit criteria | §8.3 | Each phase must deliver working, testable software. |

### 12.4 Release plan
The 8-phase plan became 5 phases (§8.3). Content extraction moved into Document Indexing (Phase 3). The bilingual interface, packaging and testing moved into Phase 5.

### 12.5 Requirement ID mapping
| Rev 1 | Rev 2 |
|---|---|
| FR-1 to FR-5 | FR-1 to FR-5 (unchanged) |
| FR-6 | FR-15 (merged) |
| FR-7 | FR-6 |
| FR-8 | FR-7 |
| FR-9 | FR-8 |
| FR-10 | FR-9 |
| FR-11 | FR-10 |
| FR-12 | FR-11 |
| FR-13 | FR-12 |
| FR-14 | FR-13 |
| FR-15 | FR-14 (simplified) |
| FR-16 | FR-15 (merged) |
| FR-17 | Removed; replaced by FR-15 |
| FR-18 | FR-16 |
| FR-19 | FR-17 |
| FR-20 | FR-19 |
| FR-21 | FR-20 |
| FR-22 | FR-21 |
| FR-23 | FR-18 |

NFR-1 to NFR-8 keep their IDs. Rev 1 NFR-9 (accessibility) is now NFR-11, and rev 1 NFR-10 (licensing) is now NFR-12. Rev 1 C-3 (read-only) is now C-4, and rev 1 C-4 (public repository) is now C-7.

### 12.6 Validation fixes (2026-10-28)
Wording and precision fixes from the BMAD validation review, with no scope change:
- Added Glossary entries for Embedding, Correct Display and Baseline PC. Spelled out acronyms at first use.
- Split the FR-14 "Relative" row so "today" means today. FR-15 presets now use the FR-14 definitions.
- Moved the "indexing in progress" notice from FR-9 to FR-13, so Phase 3 has no Phase 4 criterion.
- Defined the Close Match threshold (FR-17). The empty-result action now clears whichever Filters are active.
- FR-11 now counts unsupported files by extension, so the user can see why a `.doc` file never appears in Content matches.
- Phase 3 now records the size of the packaged backend and model against NFR-7.
- Clarified that §7 lists what the MVP is not, and §8.2 lists what may come later.
- Removed `[ASSUMPTION]` tags from items the author confirmed.

### 12.7 Decisions after validation (author, 2026-10-28)
| Question | Decision | Where |
|---|---|---|
| A cleared Date Filter could be re-set by the same phrase | A phrase that set the Date Filter is not recognized again for that query. Clearing the filter turns it back into ordinary text. | FR-15 |
| OneDrive online-only files | Never downloaded. Skipped with "Stored only in OneDrive" and still findable by name. | FR-8 |
| Unsigned installer | Not code-signed in the MVP. The README explains the SmartScreen step, and SM-5 allows it. | FR-19, SM-5, §8.2 |
| What "the app" means for zero connections | The app process, its WebView2 component and the backend. Windows and programs opened from the app are not counted. | NFR-1, SM-4 |
| Model constraint order | License and offline never give way, then SM-1, then installer size, then speed. | C-3 |
| SM-1 collection | At least 500 mixed Hebrew and English documents, including look-alikes. | SM-1 |
| When the search runs | On Enter. The app opens on Documents. Filename Search drops the Date Phrase. | FR-1, FR-12 |
| Numeric dates and cross-month ranges | Both supported. Numeric dates are read day first. | FR-14 |
| Result limits and timing | At most 20 content matches, at most 5 of them Close Matches. Time from Enter to results, 90% of SM-1 queries, after the first search. The first search takes ≤ 10 s. | FR-17, NFR-2, NFR-3 |
| Type Filter and interface language | Word = `.docx` and `.doc`. No manual language switch in the MVP. | FR-15, FR-18, §8.2 |

### 12.8 Exercise 1 EARS requirements added (author, 2026-10-30)
These changes extend revision 2. Because they add a feature (FR-22), they are listed separately from the 2026-10-28 changes.

| Change | Reason | Where |
|---|---|---|
| EARS-01, EARS-02 and EARS-03 added with acceptance tests and traceability | Exercise 6 requires the three EARS requirements from Exercise 1 | §4.0, FR-5, FR-6, FR-17, FR-22 |
| File Preview Panel added to the MVP (new FR-22, Phase 3) | Author decision, so EARS-02 is live instead of deferred. This is a scope increase. | §3, §4.7, §8.1, §8.3 |
| "No matching files found" shown when a search finishes with no results and no active Filters, in Filename Search (Phase 2) and in both groups (Phase 4) | EARS-03, keeping its exact text | FR-6, FR-17 |
| Relevance Floor added: results below it are never shown | Without it, Smart Search always returned Close Matches, so EARS-03 could never appear once the Index had documents | §3, FR-17, §8.3 |

### 12.9 Validation fixes and decisions (2026-10-31)
The 2026-10-30 validation (`validation-report.md`) found 1 high, 3 medium and 6 low findings. All were fixed or consciously accepted.

| Finding | Resolution | Where |
|---|---|---|
| High: FR-6's EARS-03 message contradicted FR-17 from Phase 4 | Fixed. FR-6's message applies only in Phases 2 and 3. From Phase 4, FR-17 decides. | FR-6 |
| Medium: text preview outside Indexed Folders was unclear | Author decision: any file in a supported format can be previewed, in any folder. It is read only on selection and never stored. | FR-22 |
| Medium: no order when the Relevance Floor's targets conflict | Author decision: SM-1 wins, but "xyz123" must always return no Content matches. | FR-17, §8.3 |
| Medium: one-word queries could fall below the Relevance Floor | Author decision: SM-1 includes at least 5 one-word queries, which guard the tuning. | §9 SM-1, FR-17, §11 |
| Low: how a selection is cleared | Fixed (example added). | §4.0 |
| Low: Phase 2 search trigger | Fixed (Enter runs the search). | FR-5 |
| Low: preview time for very large files | Fixed (linked to Open Question 2). | FR-22 |
| Low: no link to the UX design | Fixed. | §0 |
| Low: revision label | Fixed (note in §12.8). | §12.8 |
| Low: EARS source in another repository | Accepted. The full text is quoted in §4.0. | §4.0 |

The re-validation on 2026-10-31 graded the PRD Excellent and found 2 low findings. The author fixed both on 2026-11-01:

| Finding | Resolution | Where |
|---|---|---|
| Low: the one-word guard couldn't fail SM-1 on its own | Fixed. At least 4 of the 5 one-word queries must pass. | §9 SM-1, FR-17 |
| Low: Phase 3 exit didn't test preview outside Indexed Folders | Fixed. A DOCX outside the Indexed Folders must also show its text. | §8.3 Phase 3 |

### 12.10 Changes from the UX review (author, 2026-11-01)
The author reviewed the UX design with the UX designer. These changes bring the PRD in line with it.

| Change | Reason | Where |
|---|---|---|
| New FR-23: date-only search lists the documents from the range, newest first, with a hint to add a word | "I worked on a document last week" left only filler words for Smart Search, so it returned nothing. Resolves Open Question 4. | FR-12, FR-23, §8.3, §10 |
| More Date Phrase forms ("previous week", "a week ago", "בשבוע הקודם", "שבוע שעבר", "לפני שבוע" and month and year forms) | People don't phrase dates the way a table does | FR-14, §11 |
| The interface never says "index": the Index status screen is "Search folders", and "Update index" is "Check for new documents" | "Index" is jargon for non-technical users | §3, FR-10, FR-11 |
| "Can't find a file you know is there?" explanation under "No matching files found" and at the end of any Result List | Explains why a file might be missing (scanned, unsupported type, folder not searched) at the moment it matters. It informs and never asks the user to change anything. | FR-17 |
| Validation fix (2026-11-02): clearing the Date Filter of a date-only search clears the whole search | Otherwise Smart Search ran on filler words and showed "No matching files found" | FR-23, FR-15 |
| Validation fix (2026-11-02): "Date-only search" added to the Glossary | Two FRs depend on the term | §3 |

### 12.11 Clarification from the architecture review (author, 2026-11-02)
| Change | Reason | Where |
|---|---|---|
| The WebView2 runtime's own updater counts as Windows; connections from the app's WebView2 processes are counted, measured in Phase 1 and disabled by configuration | The architecture review found that WebView2 contacts Microsoft servers beyond SmartScreen. The author chose to keep the runtime updated by Windows rather than ship a fixed runtime that never gets security updates. | NFR-1 |
