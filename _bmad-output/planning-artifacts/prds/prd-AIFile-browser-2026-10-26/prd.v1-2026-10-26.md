---
title: "PRD: File Browser 2.0"
status: draft
created: 2026-10-26
updated: 2026-10-26
---

# PRD: File Browser 2.0

> **Find the file you remember, not just the filename you know.**

## 0. Document Purpose

This PRD defines what the File Browser 2.0 MVP must do. It is the input for the architecture phase (`bmad-architecture`) and for epic and story planning (`bmad-create-epics-and-stories`). It builds on the final product brief (`../../briefs/brief-AIFile-browser-2026-10-26/brief.md`) and does not repeat the brief's problem analysis or competitive research.

How to read it:
- Every domain term is defined once in §3 Glossary. The rest of the document uses those terms exactly.
- Features are in §4, with globally numbered requirements (FR-1 … FR-N), each with testable consequences.
- Cross-cutting quality requirements (NFR-N) are in §5, and hard constraints, including **no database**, are in §6.
- Anything inferred without the author's confirmation is tagged `[ASSUMPTION]` and listed in §11.
- Technical "how" (index file layout, embedding storage, crash safety) lives in `addendum.md`.

## 1. Vision

File Browser 2.0 is an offline Windows file browser for everyday, non-technical users. Users find documents by describing what they remember, in Hebrew or English: *"the document about the school committee I worked on in the fall."* The app identifies the Topic and the Time Clue, searches the contents of the user's Indexed Folders by meaning, and returns a ranked Result List with a Match Reason for each file.

Everything happens on the user's computer. The AI models ship inside the installer and run on an ordinary CPU. The app needs no internet connection, account or technical setup, and file contents, metadata and queries never leave the device.

Around the search sits a normal file browser (folders, breadcrumbs, file details, open file), so the user never has to switch to File Explorer to act on what they found.

## 2. Target User

### 2.1 Jobs To Be Done

- **Functional:** "When I need a document I made a while ago, help me find it from what it was about and roughly when I worked on it, even though I've forgotten its name and folder."
- **Emotional:** "Let me feel in control of my files, not stupid for 'losing' them."
- **Contextual:** "I write in Hebrew, English or both, and I won't learn search syntax or install technical tools."
- **Privacy:** "Don't send my personal documents anywhere to do it."
- **Builder (the author):** "Ship a complete, well-engineered local AI product as a public GitHub portfolio project."

### 2.2 Non-Users (MVP)

- Power users who want instant filename search across entire drives (Everything serves them better).
- Teams, shared drives and network storage.
- People whose files live only in the cloud.
- Users who need file management: move, rename, delete, deduplicate or organize.

### 2.3 Key User Journeys

- **UJ-1. Yossi sets it up and gets value before indexing finishes.**
  Yossi, 67, a retired teacher, downloads the installer once and runs it. No other installs, no account. On first launch the app asks which folders to search and suggests Documents and Desktop. He accepts. Indexing starts in the background with a progress indicator ("Reading your documents: 340 of 2,100"). Meanwhile he types "pension" into the Search Bar and gets Filename Search matches right away. He opens one with a double-click, and it opens in Word. **Edge case:** he types a topic before indexing is done. Results come from the files indexed so far, with a notice that indexing is still running.

- **UJ-2. Dana finds last fall's school-committee summary in Hebrew.**
  Dana, a working parent who volunteers on her son's school committee, needs last fall's meeting summary. She types: *"מסמך על ועד ההורים שעבדתי עליו בסתיו"* ("the document about the parents' committee I worked on in the fall"). The app shows how it understood her: **Topic:** parents' committee · **When:** Sep–Nov 2025. The top result is `סיכום ישיבה 3.docx` in `Documents\Volunteering`, modified October 14, 2025, with the Match Reason "Mentions 'ועד הורים' and the class trip budget · modified in fall 2025." She opens it. **Edge case:** if nothing matches in Sep–Nov, the app widens the range, says so ("No matches from fall 2025, showing nearby dates"), and labels the results as Close Matches.

- **UJ-3. Michael combines a date range and a topic in English.**
  Michael, a freelance developer, types *"a file I worked on between January 10 and January 20 about user permission management."* The app filters to Supported Documents with an Activity Date of Jan 10–20, 2026, ranks them by how closely their content matches "user permission management", and shows a PDF and a Markdown note, each with a highlighted Passage. He clicks "Show in folder" on the Markdown note.

## 3. Glossary

- **Indexed Folder:** a folder the user explicitly chose for Smart Search, including all its subfolders. The user can add and remove Indexed Folders. Nothing outside them is ever read for indexing.
- **Supported Document:** a file in an Indexed Folder with a format the MVP can extract text from: TXT, text-based PDF, DOCX or MD.
- **Index:** the local data the app builds from Supported Documents (metadata, extracted text, Passages and their embeddings). Stored only on the user's computer, as plain files, never in a database (see C-1).
- **Passage:** a short section of a Supported Document's text. It is the unit Smart Search matches against. One Supported Document has one or more Passages.
- **Search Bar:** the single text input at the center of the app, used for both Filename Search and Smart Search.
- **Filename Search:** matching the Search Bar text against file and folder names in the current folder and its subfolders, read directly from the file system. It does not need the Index.
- **Smart Search:** matching a natural-language query against the Index by meaning, combined with any Time Clue, file-type clue and location clue in the query.
- **Topic:** the subject part of a Smart Search query ("school committee", "user permission management").
- **Time Clue:** the time part of a Smart Search query ("in the fall", "between March 1 and 15", "last week"), turned into a date range.
- **Activity Date:** the date a Time Clue is compared against. It is the file's last-modified time. The creation time is a weaker secondary signal (see FR-15).
- **Result List:** the ranked list of files returned by a search.
- **Match Reason:** the short, human-readable explanation shown with each Smart Search result, saying why the file matched.
- **Close Match:** a Smart Search result shown with a visible low-confidence label, because its relevance is low or the date range was widened.

## 4. Features

### 4.1 Folder Browsing

**Description:** A familiar file-browser view. It lets the app stand on its own, and it is where the user acts on search results. Realizes UJ-1 and UJ-3.

#### FR-1: Browse local folders
The user can open any local drive or folder and see its files and subfolders, with name, type, size and last-modified date.
- The list can be sorted by each column.
- Hebrew and English names display correctly, including mixed-direction names.

#### FR-2: Navigate
The user can go into a subfolder, up to the parent folder, back and forward through history, and to any ancestor via clickable breadcrumbs.
- Typing or pasting a valid path into the breadcrumb bar opens that folder.

#### FR-3: Open a file or its folder
From the browser view or any Result List, the user can open a file in its Windows default application, or show it in its containing folder.
- Double-click / Enter opens the file. A context action "Show in folder" navigates the app to the containing folder and selects the file.

#### FR-4: Respect Windows permissions
Folders and files the user cannot access are shown with a clear message instead of an error or a crash.
- Navigating into an access-denied folder shows "You don't have permission to open this folder." The app keeps working.

### 4.2 Filename Search

**Description:** Classic name search, available immediately after install, with no Index needed. Realizes UJ-1.

#### FR-5: Search by full or partial name
The user can type text into the Search Bar to find files and folders whose names contain it.
- Matching is case-insensitive and works for Hebrew and English.
- "report" returns `Report 2025.pdf`, `monthly-report.docx` and `reports\` (a folder).

#### FR-6: Filter by file type
The user can limit Filename Search to a file type by typing an extension ("pdf", ".docx") or choosing a type filter.
- "report pdf" returns only PDF files whose names contain "report". `[ASSUMPTION: a trailing known extension in the query acts as a type filter]`

#### FR-7: Scoped, cancellable results
Filename Search covers the current folder and all its subfolders. Results show name, location and last-modified date.
- Results appear as they are found. The user can cancel a running search.
- Each result supports FR-3 actions.

### 4.3 Indexed Folders and Background Indexing

**Description:** The user decides what the app may read. Indexing runs in the background and keeps the Index current. Realizes UJ-1.

#### FR-8: Choose Indexed Folders
On first launch the user picks Indexed Folders. Documents and Desktop are suggested but not pre-selected without confirmation. Later, the user can add or remove Indexed Folders in settings.
- Removing an Indexed Folder deletes its data from the Index.
- Nothing outside the Indexed Folders is ever indexed.

#### FR-9: Extract text from Supported Documents
The app extracts text from TXT, text-based PDF, DOCX and MD files and splits it into Passages.
- Hebrew text is extracted in correct logical (reading) order, including from PDFs.
- Files the app can't read (scanned or image-only PDFs, password-protected files, corrupted files) are skipped. They still appear in Filename Search, and the index status shows "content not readable" for them.
- TXT and MD files are decoded correctly whether saved as UTF-8 or as the legacy Windows Hebrew encoding (Windows-1255). `[ASSUMPTION]`

**Out of Scope:** OCR, PPTX, XLSX and any other format (author decision).

#### FR-10: Index in the background
Indexing runs without blocking the UI and shows progress ("Reading your documents: 340 of 2,100").
- The user can browse, use Filename Search, and run Smart Search over the documents indexed so far while indexing runs (UJ-1 edge case).
- The user can pause and resume indexing. `[ASSUMPTION]`

#### FR-11: Keep the Index current
The Index reflects added, modified, renamed and deleted Supported Documents.
- While the app is running, changes in Indexed Folders are picked up automatically.
- When the app starts, it catches up on changes made while it was closed. Only changed files are processed again. `[ASSUMPTION: no background service runs while the app is closed]`

#### FR-12: Index status and reset
The user can see the index status (folders, document count, last update, skipped files with reasons), rebuild the Index, or delete all Index data.

### 4.4 Smart Search

**Description:** The core feature. The user types what they remember. The app turns it into a Topic plus optional Time Clue, file-type clue and location clue, then ranks the indexed Passages by meaning. Realizes UJ-2 and UJ-3.

#### FR-13: One Search Bar, both kinds of results
Typing into the Search Bar runs both Filename Search and Smart Search. The Result List shows them in two labeled groups: "Name matches" and "Content matches". `[ASSUMPTION: no mode switch for the user]`
- A one-word query that matches filenames still shows any content matches below them.

#### FR-14: Search by meaning
Smart Search finds Supported Documents whose content matches the Topic by meaning, not only by exact words.
- A query for "employee management system design" can return a document that says "HR platform architecture" and never uses the query words.
- Queries work in Hebrew and in English.
- `[ASSUMPTION: cross-language matching (Hebrew query → English document and the reverse) is desirable but not required for the MVP]`

#### FR-15: Understand Time Clues
Smart Search recognizes Time Clues in Hebrew and English and filters by Activity Date. Supported patterns:

| Pattern | English example | Hebrew example | Interpreted as |
|---|---|---|---|
| Exact date / range | "between March 1 and 15" | "בין 1 ל-15 במרץ" | That range, inclusive |
| Month | "in March" | "במרץ" | The whole month |
| Relative | "last week", "last month", "last year", "yesterday" | "בשבוע שעבר", "בחודש שעבר", "בשנה שעברה", "אתמול" | Calendar period relative to today. The week start follows the Windows regional setting |
| Season | "in the fall", "last summer" | "בסתיו", "בקיץ שעבר" | Fall = Sep–Nov, Winter = Dec–Feb, Spring = Mar–May, Summer = Jun–Aug |

- If no year is given, the clue means the most recent such period that started on or before today. On October 26, 2026, "in March" means March 2026, and "in the fall" means Sep–Nov 2026.
- The Activity Date is the last-modified time. A file whose creation time falls in the range but whose modified time doesn't still qualifies, ranked lower.

**Out of Scope (V2):** Hebrew-calendar and holiday expressions ("around Passover", "before Rosh Hashanah"), and real edit history beyond file timestamps.

#### FR-16: Combine clues
One query can combine a Topic with a Time Clue, a file-type clue ("PDF", "Word document", "מסמך וורד") and a location clue ("in Documents"). All recognized clues apply together.

#### FR-17: Show how the query was understood
Above the Result List, the app shows how it read the query (for example **Topic:** parents' committee · **When:** Sep–Nov 2025 · **Type:** any). The user can remove a recognized clue with one click to re-run the search without it. `[ASSUMPTION]`

#### FR-18: Ranked results with a Match Reason
Smart Search results are ranked by relevance, best first. Each shows name, location, Activity Date and a Match Reason.
- The Match Reason includes the best-matching Passage with the matching words highlighted, plus each clue the file satisfied ("modified in fall 2025", "PDF").
- The Match Reason is built from the search itself. No generative model is needed.

#### FR-19: Handle uncertain and empty results
The app always shows the best results it has.
- Results below a relevance threshold are labeled Close Match.
- If a Time Clue range returns no results, the app widens the range once, by one month on each side `[ASSUMPTION]`, shows "No matches from <period>, showing nearby dates", and labels those results Close Matches.
- If there are still no results, the app suggests next steps: rephrase, remove the date, or check that the folder is indexed.

### 4.5 Offline Installation and Updates

**Description:** A non-technical user installs once and is done. Realizes UJ-1.

#### FR-20: Single self-contained installer
One Windows installer contains the app and every AI model and runtime it needs.
- After install, the app works with the network disabled.
- No Python, Ollama, developer tools or extra downloads are needed.

#### FR-21: Manual updates
Updates are delivered as a new installer that the user downloads and runs by hand. The app never checks for updates on its own.
- Installing a newer version keeps the Indexed Folders and the Index. If the Index format changed, the app rebuilds it automatically and says so.

#### FR-22: Clean uninstall
Uninstalling removes the app. The user is asked whether to also delete the Index data. User files are never touched.

### 4.6 Interface Language

#### FR-23: English and Hebrew interface
The interface is available in English and Hebrew and follows the Windows display language. English is the fallback.
- In Hebrew, the whole layout is right-to-left (RTL).
- Mixed Hebrew/English filenames, paths and Passages display correctly in both layouts.

## 5. Cross-Cutting Non-Functional Requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-1 | Privacy | The app makes **zero network connections** during install and use: no telemetry, no crash reporting, no update checks. Verified with the network disabled and by firewall log. |
| NFR-2 | Performance: Smart Search | Results in **< 6 seconds** on the Baseline PC (NFR-5) with ~5,000 indexed Supported Documents. |
| NFR-3 | Performance: Filename Search | First results in **< 6 seconds** for a folder tree of ~50,000 files on the Baseline PC. `[ASSUMPTION: same target as Smart Search]` |
| NFR-4 | Performance: indexing | ~5,000 Supported Documents fully indexed in **< 30 minutes** on the Baseline PC, in the background. The UI never freezes for more than 0.5 s during indexing. `[ASSUMPTION: 0.5 s threshold]` |
| NFR-5 | Baseline PC | Windows 11 64-bit, 8 GB RAM, 4-core CPU, no dedicated GPU or NPU. Windows 10 64-bit is best effort. |
| NFR-6 | Resource use | While indexing, the app keeps the PC usable: background-priority work and **≤ 2 GB RAM**. `[ASSUMPTION: RAM ceiling]` |
| NFR-7 | Installer size | **≤ 1 GB**, including all models. |
| NFR-8 | Data safety | The app **never modifies, moves or deletes user files**. It only reads them. A crash or power loss never leaves a corrupted Index. Worst case, the Index rebuilds itself. |
| NFR-9 | Accessibility | Every core action (browse, search, open, show in folder) works with the keyboard alone. `[ASSUMPTION]` |
| NFR-10 | Licensing | Every bundled model and library has a license that allows redistribution in a free, public GitHub release. |

## 6. Constraints and Guardrails

- **C-1. No database in the MVP (author decision).** The MVP uses no SQL or other database management system.
  - Folder browsing and Filename Search read the Windows file system directly.
  - Smart Search uses a lightweight local Index made of JSON files plus locally stored embeddings.
  - The design must stay simple and modular, so a database or more advanced index can replace the plain-file Index later, but only if performance testing against NFR-2 to NFR-4 shows it is needed.
  - Simplicity, working functionality and ease of development come before advanced infrastructure. Implementation guidance is in `addendum.md`.
- **C-2. Offline only.** No cloud services, external AI APIs, accounts or online synchronization. All AI runs locally on the CPU (NFR-1, FR-20).
- **C-3. Read-only on user files.** See NFR-8. Any feature that writes to user files is outside the MVP.
- **C-4. Public repository.** The source code is published on GitHub. It contains no secrets, keys or personal test documents. Search-quality test fixtures (SM-1) use synthetic or freely licensed documents.

## 7. Non-Goals

- **Not a file manager.** The MVP does not move, rename, delete, copy, deduplicate or organize files.
- **Not a chat assistant.** There's no conversation or follow-up questions in the MVP (conversational search is V2), and no generated summaries or answers.
- **Not cloud or network search.** No Google Drive, OneDrive, network shares or sync.
- **Not a whole-disk indexer.** Only Indexed Folders are read for Smart Search.
- **Not cross-platform yet.** macOS and Linux come after the Windows MVP.
- **Not an OCR tool.** Scanned and image-only documents are skipped.

## 8. MVP Scope and Release Plan

### 8.1 In Scope
FR-1 to FR-23, NFR-1 to NFR-10 and constraints C-1 to C-4. In short: folder browsing, Filename Search, Indexed Folders with background indexing, Smart Search with Hebrew/English Time Clues and Match Reasons, an offline self-contained installer, and an English/Hebrew RTL interface.

### 8.2 Out of Scope for the MVP
- PPTX, XLSX and other formats (author decision: keep the MVP small)
- OCR (V2+)
- Hebrew-calendar and holiday Time Clues (V2)
- Conversational search (V2)
- AI file management: organize, rename, deduplicate, with preview and undo (V2+)
- A database or vector database (only if performance testing requires one)
- Cloud sources (not planned)
- macOS and Linux (after the MVP)

### 8.3 Release Plan
Each phase ends with working, testable software that can be demonstrated in the GitHub repository.

| Phase | Deliverable | Requirements |
|---|---|---|
| 1 | Windows file browser | FR-1 to FR-4, FR-23 (RTL foundation) |
| 2 | Filename Search | FR-5 to FR-7 |
| 3 | Local indexing | FR-8, FR-10 to FR-12, C-1 |
| 4 | Content extraction and content search | FR-9 |
| 5 | Semantic search | FR-13, FR-14, FR-18 |
| 6 | Natural-language search with Time Clues | FR-15 to FR-17, FR-19 |
| 7 | Offline packaging | FR-20 to FR-22, NFR-7, NFR-10 |
| 8 | Testing and validation | SM-1 to SM-5, NFR-1 to NFR-6 |

## 9. Success Metrics

**Primary**
- **SM-1: Search quality.** On a fixed test set of 30 Smart Search queries (15 Hebrew, 15 English `[ASSUMPTION: split]`) over a fixed synthetic document collection, the expected file appears in the top 5 results for **≥ 80%** of queries. The test set and its score are kept in the repository and re-run before every release. Validates FR-14 to FR-16 and FR-18.
- **SM-2: Speed.** Smart Search returns results in **< 6 s** on the Baseline PC with ~5,000 Supported Documents. Validates NFR-2.

**Secondary**
- **SM-3: Indexing.** ~5,000 Supported Documents indexed in **< 30 min** on the Baseline PC. Validates FR-10 and NFR-4.
- **SM-4: Privacy.** **0** network connections during install and a scripted usage session (firewall log). Validates NFR-1 and FR-20.
- **SM-5: First-run usability.** 3 non-technical testers each install the app, choose folders and find a known document with Smart Search without help. `[ASSUMPTION: tester count]` Validates UJ-1 and FR-8.

**Counter-metrics (do not optimize)**
- **SM-C1: Number of results.** Showing more results raises the chance of a top-5 hit but buries the answer and erodes trust. Close Matches stay labeled and few. Counterbalances SM-1.
- **SM-C2: Speed bought with a weaker model.** Don't meet SM-2 by switching to a model that drops SM-1 below 80%. Counterbalances SM-2.
- **SM-C3: Indexing speed bought by skipping content.** Don't meet SM-3 by indexing only the start of each document or by skipping Hebrew PDFs. Counterbalances SM-3.

## 10. Open Questions

1. Should cross-language matching (Hebrew query → English document) be a goal or just a nice extra? (FR-14)
2. What's the maximum file size to extract? Very large PDFs could dominate indexing time. `[NOTE FOR PM: suggest 50 MB cap, file still findable by name]`
3. Should Smart Search include folder names and file names as part of meaning matching (for example a folder called "School committee")?
4. How exactly does Smart Search treat a query that is only a Time Clue ("files from last week")? Should it list everything modified in that range, sorted by date?
5. Where on disk does the Index live (for example `%LOCALAPPDATA%`), and can the user see its size? This is an architecture decision, but it is visible to the user in FR-12.
6. Which embedding model meets Hebrew quality, the 1 GB installer limit, CPU speed and license constraints together? This is for the architecture phase, and the answer feeds SM-1 and SM-2.

## 11. Assumptions Index

- §4.2 FR-6: a trailing known extension in a query acts as a type filter.
- §4.3 FR-9: legacy Hebrew encoding (Windows-1255) support for TXT and MD.
- §4.3 FR-10: indexing can be paused and resumed.
- §4.3 FR-11: no background service while the app is closed; it catches up at startup.
- §4.4 FR-13: one Search Bar runs both searches, with results in two groups and no mode switch.
- §4.4 FR-14: cross-language matching is not required.
- §4.4 FR-17: the interpreted query is shown, and clues can be removed with one click.
- §4.4 FR-19: an empty date range widens by one month on each side, once.
- §5 NFR-3: Filename Search target equals the Smart Search target (< 6 s for ~50k files).
- §5 NFR-4: the UI never freezes for more than 0.5 s during indexing.
- §5 NFR-6: RAM ceiling of 2 GB while indexing.
- §5 NFR-9: keyboard-only operation of core actions.
- §9 SM-1: a 15 Hebrew / 15 English query split.
- §9 SM-5: 3 non-technical testers.
