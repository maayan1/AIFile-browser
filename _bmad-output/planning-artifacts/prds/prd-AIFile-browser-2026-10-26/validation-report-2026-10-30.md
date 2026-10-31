# Validation Report — PRD: File Browser 2.0 (revision 2, updated 2026-10-30)

- **PRD:** `_bmad-output/planning-artifacts/prds/prd-AIFile-browser-2026-10-26/prd.md`
- **Rubric:** `.claude/skills/bmad-prd/assets/prd-validation-checklist.md`
- **Run at:** 2026-10-30
- **Grade:** Fair (no thin or broken dimensions, but 1 high finding)
- **Previous run:** `validation-report-2026-10-28.md` (all of its findings were fixed or decided on 2026-10-28)
- **Status after fixes (2026-10-31):** all 10 findings are resolved. The high finding and 5 lows were fixed. The author decided the 3 mediums (preview in any folder; SM-1 wins over the nonsense list, but `xyz123` must always return nothing; at least 5 one-word queries in SM-1). One low (EARS source in another repository) was accepted on purpose. Details are in PRD §12.9.

## Overall verdict
The PRD still holds up: a clear thesis, recorded author decisions, and phases with testable exit criteria. The three Exercise 1 EARS requirements are now present in EARS form, each with an acceptance test and a carrying FR. The risk is in how the new pieces interact. FR-6's EARS-03 bullet contradicts FR-17 once Smart Search exists (one high finding). Two medium gaps need an author decision: whether the Preview Panel shows text for files outside Indexed Folders, and what wins when the Relevance Floor can't satisfy both the nonsense-query list and SM-1.

## Dimension verdicts
- Decision-readiness — strong
- Substance over theater — strong
- Strategic coherence — strong
- Done-ness clarity — adequate
- Scope honesty — adequate
- Downstream usability — strong
- Shape fit — strong

## Exercise 6 checks
| Check | Result |
|---|---|
| The three EARS requirements from Exercise 1 are in the PRD | **Pass.** §4.0 has EARS-01 (event-driven), EARS-02 (state-driven) and EARS-03 (unwanted behavior) in EARS form, with traceability to FR-5, FR-22, FR-6 and FR-17. |
| Every FR is testable, including the EARS requirements | **Pass after one fix.** Each EARS requirement has a concrete acceptance test. The FR-6/FR-17 contradiction (high) has to be fixed for EARS-03 to be testable without ambiguity from Phase 4. |
| Understandable by a non-engineer | **Pass.** The new terms are in the Glossary in plain words. §4.0 explains what EARS form is. No implementation detail was added. |
| UX designer's pass included | **Done outside the PRD.** DESIGN.md, EXPERIENCE.md and 3 mockups are in `ux-designs/ux-AIFile-browser-2026-10-30/`. The PRD doesn't link to them yet (low). |

## Findings by severity

### Critical (0)

### High (1)
**[Done-ness clarity]** — FR-6's EARS-03 bullet contradicts FR-17 from Phase 4 (§4.2 FR-6, §4.4 FR-17)
FR-6 shows "No matching files found" whenever Filename Search finds nothing. From Phase 4 that would appear above real Content matches, or while a Type Filter is active. FR-17 correctly requires both groups to be empty and no Filters active.
Fix: limit the FR-6 bullet to Phases 2–3, and state that FR-17 governs from Phase 4.

### Medium (3)
**[Scope honesty]** — Does the preview show text for files outside the Indexed Folders? (§3 Supported Document, §4.7 FR-22) `[decision needed]`
The Glossary limits Supported Documents to Indexed Folders, and FR-22 shows text only for Supported Documents, so a DOCX elsewhere gets no text preview. The PRD doesn't say whether that's intended or how it relates to FR-7's privacy promise.
Fix: (a) preview text for any TXT, PDF, DOCX or MD file the user selects, read on demand and never stored, or (b) limit text preview to Indexed Folders and show "Not in an indexed folder" elsewhere.

**[Decision-readiness]** — No precedence when the Relevance Floor's two targets conflict (§4.4 FR-17) `[decision needed]`
One fixed floor may not be able to empty every nonsense query and keep SM-1 ≥ 80% at the same time.
Fix: state the order, for example: SM-1 wins, but `xyz123` (the EARS-03 test) must always return nothing.

**[Strategic coherence]** — The Relevance Floor can hide content matches for short queries (§4.4 FR-17, FR-12, UJ-1) `[decision needed]`
One-word queries such as UJ-1's "pension" are likely to score low, and nothing protects them during tuning.
Fix: add at least 5 one-word queries to SM-1 as a tuning guard.

### Low (6)
**[Done-ness clarity]** — "When the selection is cleared" is not defined (§4.0 EARS-02). Fix: "for example by clicking an empty area of the list".
**[Done-ness clarity]** — The Phase 2 search trigger is undefined (§4.2 FR-5). Fix: add "Pressing Enter runs the search" to FR-5.
**[Done-ness clarity]** — The 2-second preview target has no file-size bound (§4.7 FR-22). Fix: reference Open Question 2, or accept.
**[Downstream usability]** — The PRD doesn't point to the UX spines (§0). Fix: add one line to "How to read it".
**[Downstream usability]** — The EARS source is in another repository (§4.0). The text is quoted in full. Fix: accept.
**[Shape fit]** — The revision label doesn't reflect the 2026-10-30 scope change (frontmatter, §12). Fix: note in §12.8 that it extends revision 2, or bump to revision 3.

## Mechanical notes
- FR-1 to FR-22 are contiguous with no duplicates. EARS-01 to EARS-03 are each cited in §4.0, their carrying FR and §8.3.
- New dependencies resolve. FR-22 depends on FR-1 and FR-8. FR-18 and FR-19 include FR-22.
- Assumptions Index: 13 inline tags and 13 index entries, all matched.
- "Relevance Floor" and "Preview Panel" are used in Title Case throughout.

## Reviewer files
- `review-rubric.md` (this run)
- `review-rubric-2026-10-28.md`, `review-structure-prose.md` (previous run)
