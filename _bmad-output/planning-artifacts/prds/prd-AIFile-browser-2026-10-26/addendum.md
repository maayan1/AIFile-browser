---
title: "Addendum: File Browser 2.0 PRD"
created: 2026-10-26
updated: 2026-10-28
---

# Addendum: File Browser 2.0 PRD

Technical detail and context for the architecture phase. The PRD states capabilities; this file holds the "how". Two items here are author decisions: the technology stack (PRD C-5) and no database (PRD C-1). Everything else is guidance, not a decision, and the architecture phase confirms or replaces it. Background research and analysis notes are in `../../briefs/brief-AIFile-browser-2026-10-26/addendum.md`. Revision 1 of this file is kept as `addendum.v1-2026-10-26.md`.

## Technology stack integration notes (C-5, author decision)

*Decided by the author on 2026-10-28. The stack itself is listed in the PRD's C-5 table.*

- **Python backend as a Tauri sidecar.** Tauri can launch a bundled executable as a sidecar process. Building the Python backend into a single executable (for example with PyInstaller or Nuitka) means the user never installs Python (FR-19).
- **Prefer stdin/stdout messages to a localhost HTTP port.** A local HTTP server opens a port that other processes on the PC can reach. Talking to the sidecar over its standard input and output keeps the backend private to the app (NFR-9) and creates no network traffic that firewall checks would flag (NFR-1). If a local port is used anyway, bind it to loopback only and require a per-session token.
- **Watch the installer size early.** A Python runtime plus PyTorch can easily exceed the 1 GB installer limit (NFR-7). Packaging the embedding model for ONNX Runtime instead of PyTorch usually makes the installer much smaller. The Phase 3 exit records the packaged size (PRD §8.3).
- **Backend restart.** The frontend should detect a dead sidecar and restart it, so a backend crash shows a message instead of breaking the app (NFR-10).
- **Direction-neutral layout from Phase 1.** The Hebrew right-to-left interface is finished in Phase 5 (FR-18). Using direction-neutral styling from the start (CSS logical properties such as `margin-inline-start`, and Tailwind's `rtl:` and `ltr:` variants) makes Phase 5 a switch, not a rewrite.
- **One embedding model.** Selection criteria: good Hebrew and English quality, processor-only speed that fits NFR-2 and NFR-4, a size that fits NFR-7, and a redistributable license (NFR-12). See PRD Open Question 5. If no model meets every criterion, PRD C-3 sets the order in which they give way.

### Windows 11 environment notes (decided by the author on 2026-10-28)

- **WebView2 network traffic (NFR-1).** Tauri draws its interface with Microsoft's WebView2 component, which NFR-1 counts as part of the app. Its SmartScreen check and the runtime's own updater can connect to the internet, and Tauri's default installer mode downloads WebView2 during install. Options: disable SmartScreen inside WebView2, and use the offline or fixed-version WebView2 install mode.
- **OneDrive online-only files (FR-8).** Documents and Desktop are often synced with OneDrive, and many files there are placeholders. Reading a placeholder makes OneDrive download it, which FR-8 forbids. Windows marks these files with a "recall on data access" attribute, which the indexer can check before opening a file.
- **Unsigned installer (FR-19).** Windows SmartScreen warns about unsigned installers, so the README must show the "More info → Run anyway" step. Smart App Control can block unsigned executables on clean installs, and PyInstaller builds are frequent antivirus false positives. Test the Phase 5 installer on a clean Windows 11 PC early.

## No database in the MVP (C-1, author decision)

*Stated by the author on 2026-10-26, restated on 2026-10-28.*

> The initial MVP of File Browser 2.0 will not use SQL or a database management system.
>
> The application will access the Windows file system directly for folder navigation and filename search.
>
> For intelligent search, the application may maintain a lightweight local index using JSON files and locally stored embeddings.
>
> All data processing and storage will remain on the user's computer.
>
> The architecture should remain simple and modular, allowing a database or more advanced indexing engine to be introduced in a future version if performance requirements justify it.
>
> The MVP will prioritize simplicity, working functionality, and ease of development over advanced infrastructure.

### Feasibility notes

*By the business analyst on 2026-10-26. Trimmed on 2026-10-28 to remove performance work that no measured target requires yet (C-6).*

- **Brute-force search is enough.** At ~5,000 documents with ~10 Passages each, the Index holds roughly 50,000 vectors. With a 384-dimension model stored as float32, that's about 75 MB. A brute-force similarity scan takes well under a second on a modern processor, comfortably inside the < 6 s target. No vector database or approximate search is needed at this scale (C-6).
- **Store vectors in binary, not as JSON numbers.** JSON text makes the files about 3× larger and slow to load. Keep metadata (path, modified time, size, file type, Passage text) in JSON, and keep the vectors in a binary array file next to it, for example `.npy`. Both are still plain files, not a database.
- **Crash safety (NFR-8).** Write Index files atomically: write to a temporary file, then rename it over the old one. If a file is corrupted, rebuild the Index. Saving progress after each batch of documents also gives FR-9 its "continue after an interrupted run" behavior.
- **Incremental updates (FR-10).** Store each file's modified time and size, so only changed files are re-extracted and re-embedded at startup or on "Update index".
- **Start with the simplest layout.** One metadata JSON file and one vector file is fine to begin with. Split them per Indexed Folder only if measurement shows rewrites are too slow (C-6).
- **Filename Search straight from the file system.** Walking the folder tree on every search should work for typical folders. Measure against NFR-3 in Phase 2. A cached filename list is a future step only if the target is missed.
- **Keep one seam, not a framework.** Put Index reads and writes in one module with a small set of functions (add, remove, search by vector, filter by metadata). That's enough to swap in a database later without touching the interface. No further abstraction layers are needed (C-6).

## Date Phrase recognition (FR-14)

- Use a small hand-written rule set (regular expressions plus Hebrew and English month-name tables). Numeric dates are read day first (FR-14). No date-parsing AI and no large language-processing library.
- Hebrew prefixes attach to words ("במרץ", "מאוקטובר", "ב-2025"). Rules should strip the common prefixes ב, מ and ל, and an optional hyphen, before matching month names and years.
- Keep the FR-14 test list as a plain data file in the repository, so the rules and their tests are easy to read and extend after the MVP.
