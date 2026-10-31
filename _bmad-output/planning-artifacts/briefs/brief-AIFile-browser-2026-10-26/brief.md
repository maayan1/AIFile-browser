---
title: "Product Brief: File Browser 2.0"
status: final
created: 2026-10-26
updated: 2026-10-30
---

# Product Brief: File Browser 2.0

> **Find the file you remember, not just the filename you know.**

## Executive Summary

File Browser 2.0 is an offline file browser for Windows 11 that finds documents from what you remember about them. A user types, in Hebrew or English, something like *"the school committee summary from October 2025."* The app recognizes the date, searches the contents of the user's documents by meaning, and shows the matching files with their locations and a short explanation of why each one matched.

Everything runs on the user's computer. A single local AI model ships inside the installer, runs on an ordinary CPU, and never needs an internet connection. File contents, metadata, and search queries never leave the device. No account, no cloud, and no Python or Ollama to install.

**Why now:** small multilingual AI models can now search by meaning on an ordinary laptop. The big vendors' versions of this search don't serve most people: Windows' own semantic search needs a Copilot+ PC with an NPU, and Google Drive and OneDrive AI search require uploading your files and paying for a subscription. That leaves most Windows PCs, and most privacy-conscious users, without this kind of search.

**Project context:** this is also a learning and portfolio project, to be published on GitHub.

## The Problem

People remember *what* a document was about and *roughly when* they worked on it. They rarely remember its filename or which folder it went into. Today's tools assume the opposite:

- **Windows Search and File Explorer** mostly match filenames. Content search is limited, indexing is slow, and search by meaning exists only on Copilot+ PCs.
- **Fast tools like Everything** search only filenames.
- **Cloud AI search** (Google Drive with Gemini, OneDrive with Copilot) works only on files uploaded to that cloud, usually on a paid plan.

So people open folder after folder, sort by date, guess at names, or give up and rewrite the document. Non-technical users are hit hardest, because they don't know search syntax or tricks. `[ASSUMPTION: based on the author's experience and public complaints about Windows Search, not on user research]`

## The Solution

1. **Install and choose folders.** One Windows installer with everything included. On first run the user picks the folders to search, such as Documents or Desktop. Only those folders are ever indexed.
2. **Background indexing.** The app reads the supported documents and builds a local index without freezing the interface.
3. **One search bar, two ways to use it.**
   - Type part of a filename ("report") for classic filename search.
   - Describe the file ("the permissions design doc from January") for intelligent search, which searches content by meaning and recognizes simple dates ("between March 1 and 15", "last month"). A recognized date becomes a visible date filter, and a file-type filter sits next to it. The user can clear either one with one click.
4. **Results you can trust.** Each result shows the filename, its folder, and its date, plus a one-line reason it matched. Weak matches are labeled as such, and when nothing matches, the app says so plainly instead of showing unrelated files. Opening a result launches its usual program, or the user can jump to its folder.
5. **A normal file browser around the search.** Browse folders, use breadcrumbs, and see file types, sizes, and dates, so the app works on its own without File Explorer. A preview panel shows the selected file's details and the start of its text, so the user can check a file before opening it.

## What Makes This Different

The product has no technical moat. What sets it apart is this **combination**, which no single product offers today:

| | File Browser 2.0 | Windows semantic search | Cloud AI search | Everything |
|---|---|---|---|---|
| Works on any Windows PC (no NPU) | ✅ | ❌ Copilot+ only | ✅ | ✅ |
| Fully offline and private | ✅ | ✅ | ❌ | ✅ |
| Searches by meaning and dates | ✅ | ✅ | ✅ | ❌ |
| Explains why a file matched | ✅ | ❌ | Partly | ❌ |
| Hebrew queries | ✅ | `[ASSUMPTION: likely not among its 6 languages; unverified]` | ✅ | n/a |
| No setup for non-technical users | ✅ | ✅ | Needs account and upload | ✅ |

Microsoft could bring semantic search to all PCs. For a learning project, that risk is acceptable: the value is in building the product well, not in protecting it from competitors. Full competitor research is in `addendum.md`.

## Who This Serves

**Primary: everyday Windows users with no technical background.** They have years of documents in Documents, Desktop, and Downloads, and they write in Hebrew, English, or both. One example is a parent who volunteers on the school committee and needs last October's meeting summary. For them, success means typing what they remember and seeing the right file on the first screen, without learning anything new.

**Secondary: privacy-conscious users** who won't let cloud AI or Recall-style tools near their files.

**Not for (MVP):** power users who want instant filename search across whole drives (Everything serves them), teams and shared drives, and people whose files live only in the cloud.

## Success Criteria

Targets confirmed by the author on 2026-10-26.

| Area | Signal | Target |
|---|---|---|
| Search quality | The right file appears in the top 5 results on a fixed test set of Hebrew and English queries | ≥ 80% of 30 queries |
| Speed | Search response on a standard laptop (8 GB RAM, no GPU) | < 6 seconds |
| Indexing | A background index of ~5,000 documents finishes without blocking the UI | < 30 minutes |
| Privacy | No network traffic during installation and use | 0 connections, checked with the network disabled and a firewall log |
| Project | Public GitHub repository with a downloadable Windows installer, a README, and a demo | Released |

## Scope

**In the MVP:**
- Folder browsing, opening files in their usual program, and a preview panel for the selected file
- Filename and extension search
- User-selected folders, indexed locally in the background and kept up to date
- Text extraction from TXT, text-based PDF, DOCX, and MD files
- Content search by meaning, in Hebrew and English
- Simple dates in the query (exact dates, ranges, months, years, "last week"), plus visible date and file-type filters
- A short explanation for each result, and a plain message when nothing matches
- An offline Windows 11 installer with the AI model included

**Out of the MVP:**
- Conversational search (after the MVP)
- Vague and seasonal time phrases ("in the fall", "around Passover") and location clues in the query ("in Documents")
- Move, rename, delete, duplicate detection, auto-organization, and bulk operations
- OCR for scanned documents and image-based PDFs
- All cloud sources (Google Drive, OneDrive) and external AI APIs
- Windows 10, macOS, and Linux

## Open Questions (resolved in the PRD)

The PRD (`../../prds/prd-AIFile-browser-2026-10-26/prd.md`) answered every question this brief raised. Background notes for questions 1, 2, 5, and 7 are in `addendum.md`.

1. **What does "I worked on it" map to?** The modified date only (PRD Glossary, Activity Date).
2. **How are vague time phrases interpreted?** They aren't in the MVP. Only a fixed list of simple dates is recognized (FR-14).
3. **Which Hebrew and English query patterns must work?** The FR-14 table, checked by a test list of at least 40 phrases.
4. **What does the app show when results are uncertain or empty?** Weak matches are labeled. Below a minimum relevance nothing is shown, and the app says "No matching files found" (FR-17).
5. **What's the installer size limit?** 1 GB or less (NFR-7).
6. **How do updates work without the cloud?** The user downloads and runs a new installer. The app never checks for updates (FR-20).
7. **Is Hebrew text extracted correctly from PDFs?** It's a requirement (FR-8), checked in Phase 3.

## Vision

If the MVP works, File Browser 2.0 grows from *finding* files to *understanding* them. After the MVP, users can talk with their files ("which version did I send to the principal?"). Later come safe AI file management (organize, rename, and deduplicate, always with a preview and undo), OCR for scans, and macOS and Linux versions. The aim stays the same as in the author's original vision: a workspace where nobody needs to remember where a file lives, and their data never leaves their computer.
