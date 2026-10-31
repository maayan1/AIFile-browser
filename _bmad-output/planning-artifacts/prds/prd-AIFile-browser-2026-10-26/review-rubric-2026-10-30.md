# PRD Quality Review — PRD: File Browser 2.0 (revision 2, updated 2026-10-30)

Scope: a full rubric walk, with extra attention to the 2026-10-30 changes (§4.0 EARS requirements, FR-6 and FR-17 EARS-03 wording, the Relevance Floor, FR-22 Preview Panel, §8.3 exit criteria, §11, §12.8). The 2026-10-28 review is kept as `review-rubric-2026-10-28.md`.

## Overall verdict
The PRD still holds up: a clear thesis, recorded author decisions, and phases with testable exit criteria. The three Exercise 1 EARS requirements are now present in EARS form, each with an acceptance test and a carrying FR. The risk is in how the new pieces interact. FR-6's EARS-03 bullet contradicts FR-17 once Smart Search exists (one high finding). Two medium gaps need an author decision: whether the Preview Panel shows text for files outside Indexed Folders, and what wins when the Relevance Floor can't satisfy both the nonsense-query list and SM-1.

## Decision-readiness — strong
The scope increase (Preview Panel) and the change from "always show the best results" to a Relevance Floor are stated as author decisions with reasons (§12.8). §4.0 states openly how each EARS requirement was adapted from Exercise 1, including that EARS-02 moved from deferred to in scope.

### Findings
- **medium** No precedence when the Relevance Floor's two targets conflict (§4.4 FR-17) — the floor must make "every query" in the nonsense list return nothing "while SM-1 stays at ≥ 80%". Embedding models often give nonsense strings moderate similarity, so both targets may not be reachable with one fixed value, and the PRD doesn't say which one gives way. *Fix:* state the order, for example: SM-1 ≥ 80% wins; the nonsense list must still return nothing for the EARS-03 test query `xyz123`.

## Substance over theater — strong
The new content is earned. The Preview Panel is tied to a user need ("check that a file is the right one before opening it") and to EARS-02. The Relevance Floor exists because EARS-03 was otherwise unreachable, and §12.8 says exactly that.

## Strategic coherence — strong
Both additions serve the thesis "find the file you remember": the preview helps confirm the find, and the floor stops unrelated files from looking like answers, which matches counter-metric SM-C1.

### Findings
- **medium** The Relevance Floor can hide content matches for short queries (§4.4 FR-17, FR-12, UJ-1) — UJ-1's one-word query "pension" and FR-12's "a one-word query … still shows any content matches" are the kind of query most likely to score low. Neither SM-1 nor the nonsense list protects them, so tuning could silently remove UJ-1's content matches. *Fix:* add at least 5 one-word queries to SM-1, or a short "must return" list, as a tuning guard. `[decision needed]`

## Done-ness clarity — adequate
Every EARS requirement has a concrete acceptance test (§4.0), mirrored in its carrying FR, and the phase exit criteria name them (§8.3 Phases 2–4). FR-22 has bounded criteria (2,000 characters, 2 seconds, fixed messages). One contradiction weakens EARS-03's testability.

### Findings
- **high** FR-6's EARS-03 bullet contradicts FR-17 from Phase 4 (§4.2 FR-6, §4.4 FR-17) — FR-6 says "If a Filename Search finishes with no results, the app shows 'No matching files found'". From Phase 4 the same search runs alongside Smart Search, so a query with zero Name matches but several Content matches, or with a Type Filter active, would show "No matching files found" above real results. FR-17 correctly requires both groups to be empty and no Filters active. *Fix:* limit the FR-6 bullet to Phases 2–3 (before Smart Search exists) and state that FR-17 governs from Phase 4.
- **low** "When the selection is cleared" is not defined (§4.0 EARS-02 acceptance) — the PRD never says how a user clears a selection. *Fix:* add "for example by clicking an empty area of the list".
- **low** The Phase 2 search trigger is undefined (§4.2 FR-5) — "search on Enter" is defined only in FR-12 (Phase 4), but the EARS-01 test runs in Phase 2. *Fix:* add "Pressing Enter runs the search" to FR-5.
- **low** The 2-second preview target has no file-size bound (§4.7 FR-22) — very large PDFs may not meet it, and the size cap is still Open Question 2. *Fix:* reference Open Question 2, or accept.

## Scope honesty — adequate
The scope increase is explicit (§12.8, §8.1). The new assumptions are tagged and indexed. One boundary is unclear.

### Findings
- **medium** Does the preview show text for files outside the Indexed Folders? (§3 Supported Document, §4.7 FR-22) — the Glossary defines a Supported Document as "a file in an Indexed Folder", and FR-22 shows text only "for a Supported Document". The user can browse any folder (FR-1), so a DOCX outside the Indexed Folders gets no text preview, and the PRD doesn't say whether that's intended. Reading files outside Indexed Folders also touches the privacy promise in FR-7. `[decision needed]` *Fix:* either (a) preview text for any TXT, PDF, DOCX or MD file the user selects, read on demand and never stored in the Index, or (b) keep text preview to Indexed Folders and show a reason ("Not in an indexed folder") elsewhere.

## Downstream usability — strong
The §4.0 traceability table connects each EARS ID to its FRs and phases. The new Glossary terms (Relevance Floor, Preview Panel) are used consistently. The UX spines now exist in `../../ux-designs/ux-AIFile-browser-2026-10-30/`.

### Findings
- **low** The PRD doesn't point to the UX spines (§0) — downstream readers find DESIGN.md and EXPERIENCE.md only by browsing the folder. *Fix:* add one line to §0 "How to read it".
- **low** The EARS source is in another repository (§4.0) — `earsRequirments` lives in `file-browser-agentic`, which isn't reachable from this repo. The full text is quoted in §4.0, so this is acceptable. *Fix:* accept.

## Shape fit — strong
A consumer product with meaningful UX, named-protagonist journeys and a chain-top role (UX, architecture, stories): the shape fits. The length grew again with §4.0 and §12.8. This was already accepted on purpose (2026-10-28).

### Findings
- **low** The revision label doesn't reflect the 2026-10-30 scope change (frontmatter `revision: 2`, §12 heading dated 2026-10-28) — a feature was added after "revision 2" was closed. *Fix:* note in §12.8 that it extends revision 2, or bump to revision 3.

## Mechanical notes
- IDs: FR-1 to FR-22 are contiguous with no duplicates. EARS-01 to EARS-03 are each cited in §4.0, in their carrying FR and in §8.3.
- New dependencies resolve: FR-22 depends on FR-1 and FR-8 (Phase 1 and 3, both ≤ Phase 3). FR-18 and FR-19 now include FR-22.
- Assumptions Index roundtrip: 13 inline tags and 13 index entries, all matched (3 new: FR-17 list size, FR-22 2,000 characters, FR-22 2 seconds).
- Glossary: "Relevance Floor" and "Preview Panel" are used in Title Case throughout. "Close Match" is unchanged.
- §0 says "FR-1 … FR-22" and points to §4.0. §8.1 says "FR-1 to FR-22".
