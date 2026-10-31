---
title: "Addendum: File Browser 2.0 PRD"
created: 2026-10-26
updated: 2026-10-26
---

# Addendum: File Browser 2.0 PRD

Technical detail and context for the architecture phase. The PRD states capabilities; this file holds the "how". Background research and analysis notes are in `../../briefs/brief-AIFile-browser-2026-10-26/addendum.md`.

## Architecture Constraint: No SQL Database in the MVP (stated by the author, 2026-10-26)

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

### Analyst notes on feasibility (Mary, 2026-10-26)

- **Fits the MVP targets.** At ~5,000 documents split into ~10 passages each, the index holds roughly 50,000 vectors. With a 384-dimension model stored as float32, that's about 75 MB. A brute-force similarity scan over that many vectors takes well under a second on a modern CPU, comfortably inside the < 6 s search target. No vector database is needed at this scale.
- **Store vectors in binary, not as JSON numbers.** Writing embeddings out as JSON text makes the files about 3× larger and slow to load. Keep metadata (path, timestamps, file type, passage text, content hash) in JSON, and keep the vectors in a binary array file next to it, for example `.npy` or raw float32. Both are still plain files, not a database.
- **Crash safety.** Write index files atomically: write to a temporary file, then rename it over the old one. That way a crash or power cut can't leave a half-written index. Let the index rebuild itself if a file is corrupted.
- **Incremental updates.** Store each file's modified time and size, and a content hash, so only changed files are re-extracted and re-embedded. Splitting the index into one file per indexed folder, or per shard, avoids rewriting one huge JSON file on every change.
- **Filename search straight from the file system.** Walking the folder tree on every search works for the user's selected folders. Very large trees (100k+ files) may get slow. Watch this against the 6 s target, and consider a cached filename list as a future step.
- **Modularity seam.** Hide the index behind a small interface (add, remove, search by vector, filter by metadata). A future SQLite or vector database can then replace the JSON files without touching the UI or the search logic.
