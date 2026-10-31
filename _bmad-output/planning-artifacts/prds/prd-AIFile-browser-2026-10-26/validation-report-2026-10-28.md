# Validation Report — PRD: File Browser 2.0 (revision 2)

- **PRD:** `_bmad-output/planning-artifacts/prds/prd-AIFile-browser-2026-10-26/prd.md`
- **Rubric:** `.claude/skills/bmad-prd/assets/prd-validation-checklist.md`
- **Run at:** 2026-10-28
- **Grade:** Fair (no thin or broken dimensions, but 3 high findings). All three need an author decision.
- **Status after fixes:** every finding that needed no product decision has been fixed in `prd.md` and `addendum.md`. The author accepted all 10 suggested decisions on 2026-10-28; they are written into the PRD and recorded in PRD §12.7. Wherever a finding below says **Decision (Qn)**, it is now resolved.
- **Still open:** the three EARS requirements for Exercise 6 are not in the PRD, and no Exercise 6 brief was found in the project.

## Overall verdict

The PRD is ready for the architecture phase. It has a clear thesis ("find the file you remember"). Its author decisions (C-1, C-3, C-5) record their trade-offs. Its five phases build on each other, each with an exit criterion and no forward "Depends on" links. Rule-based Date Phrase recognition (FR-14) is in MVP scope everywhere it appears. The risks are in two places. First, how Date Phrases, Filters and the combined Search Bar interact in edge cases (FR-12, FR-14, FR-15, FR-17). Second, real Windows 11 conditions the PRD didn't mention: OneDrive online-only files in the suggested folders, unsigned-installer blocking, and WebView2 traffic against the zero-connection rule. None is critical. Three are high because each would show up as a visible failure in a core journey or a release gate.

The structure and prose review rated both documents *pass with revisions*. Their structure was sound, and the problems were wording: "Version 2", "V2" and "2.0" meant three different things; non-goals overlapped with deferred items; acronyms and AI terms weren't explained; and a few terms drifted from the Glossary. All of these are fixed.

## Dimension verdicts
- Decision-readiness — strong
- Substance over theater — strong
- Strategic coherence — strong
- Done-ness clarity — adequate
- Scope honesty — adequate
- Downstream usability — strong
- Shape fit — strong

## User-requested checks
| Check | Result |
|---|---|
| Functional requirements are clear, testable and consistent | **Pass after fixes.** IDs are contiguous, all "Depends on" links point to the same or an earlier phase, and all 23 revision 1 FRs are mapped. Fixed: FR-14 "today" contradiction, the untestable "display correctly" (now the Glossary term Correct Display), the FR-9 Phase 4 criterion, and the FR-17 trigger wording. The behaviors that still need decisions are in §10, questions 6, 12, 13 and 14. |
| Understandable to non-technical stakeholders | **Pass after fixes.** Acronyms (PRD, MVP, FR, NFR, OCR, RTL, GPU/NPU) are spelled out. Embedding, Baseline PC and Correct Display are now in the Glossary. BMAD skill names were removed from §0. |
| Architecture and technology constraints consistent with MVP goals | **Pass, with one open item.** C-1, C-3 and C-5 fit offline use, the ≤ 1 GB installer, ≤ 2 GB RAM and Windows 11. Installer size is now measured in Phase 3. Open: the WebView2 boundary of the zero-connection rule (§10 question 9). |
| Natural-language date parsing remains in the MVP | **Confirmed.** FR-14 (rule-based Date Phrases in Hebrew and English) is in scope in §1, §3, §4.4, C-3, §7, §8.1, §8.3 Phase 4, SM-1 and the addendum. The §7 heading was renamed to "Only fixed Date Phrases" so it no longer reads as a contradiction. |
| Five phases are incremental and each produces working, testable software | **Confirmed.** Every phase has a "Phase is done when" criterion that can be demonstrated. No phase depends on a later one. |
| Three EARS requirements for Exercise 6 | **Not found.** No requirement in the PRD uses EARS syntax ("When/While/If … the system shall …"), and no Exercise 6 brief exists in the project. Nothing was invented. |

## Findings by severity

Status key: **Fixed** = applied in this pass · **Decision** = waiting on the author (PRD §10 question number).

### Critical (0)

### High (6)
**[Done-ness / rubric]** — Clearing a Date Filter set by a Date Phrase may bring it straight back (FR-14, FR-15, FR-17, UJ-2). **Decision (Q6).**
**[Scope honesty / rubric]** — OneDrive online-only files in the suggested folders get downloaded when read (FR-7, FR-8, NFR-1). **Decision (Q7).**
**[Scope honesty / rubric]** — An unsigned installer may be warned about or blocked on Windows 11, which affects the Phase 5 exit and SM-5 (FR-19). **Decision (Q8).**
**[Structure and prose]** — "Version 2", "V2" and "2.0" meant three different things (§0, §8.2, §12). **Fixed:** "PRD revision 2" and "post-MVP".
**[Structure and prose]** — Non-goals (§7) overlapped with deferred items (§8.2), so "never" and "later" were mixed. **Fixed:** §7 is scoped to the MVP, and §8.2 is a status table.
**[Structure and prose]** — Acronyms and AI terms were unexplained for non-technical readers (§0, §1). **Fixed.**

### Medium (22)
- Rubric: no priority order if one model can't meet every constraint. **Decision (Q10).**
- Rubric: SM-1 collection size and contents are undefined. **Decision (Q11).**
- Rubric: the 1 GB installer limit was unchecked until Phase 5. **Fixed** (Phase 3 exit).
- Rubric and prose (raised by both): FR-14 "Relative" row contradicted itself, and the preset definitions were missing. **Fixed.**
- Rubric: numeric dates and ranges across months were unspecified. **Decision (Q13).** The repeated-month range example was added.
- Rubric: Search Bar trigger, scope, start folder and query text were undefined. **Decision (Q12).**
- Rubric: "display correctly" was untestable. **Fixed** (Glossary: Correct Display).
- Rubric: Close Match threshold, result cap and empty-result action. **Fixed** (threshold; clear active Filters). **Decision (Q14)** for the result cap.
- Rubric: the method for measuring the 6-second targets is undefined. **Decision (Q14).**
- Rubric: the zero-connection boundary (WebView2, opened apps, the operating system). **Decision (Q9).** A risk note was added to the addendum.
- Rubric: `.doc` and other unsupported files disappeared with no signal. **Fixed** (FR-11 count by extension; `.doc` named in §8.2).
- Rubric: the UJ-1 "indexing in progress" notice had no FR, and FR-9 had a Phase 4 criterion. **Fixed** (moved to FR-13).
- Prose: "Baseline PC" and "Embedding" were missing from the Glossary. **Fixed.**
- Prose: terms drifted from the Glossary ("date filter", "AI Semantic Search"). **Fixed.**
- Prose: the FR-17 trigger wording was ambiguous. **Fixed.**
- Prose: "changed" in FR-10 was used as if it were a defined term. **Fixed.**
- Prose: §0 front-loaded the revision history. **Fixed** (moved to §12).
- Prose: the §12.5 three-pair grid was hard to read, and a removed ID was also mapped forward. **Fixed.**
- Prose: an internal note was left in Open Question 2. **Fixed.**
- Prose: the addendum preamble seemed to let architecture replace C-1 and C-5. **Fixed.**
- Prose: the §8.2 date bullet coordination was ambiguous. **Fixed.**

### Low (23)
- Rubric: the RTL layout had no Phase 1 guardrail. **Fixed** (addendum note).
- Rubric: the FR-14 test list had no required contents or negative cases. **Fixed.**
- Rubric: the Type Filter extension mapping. **Decision (Q15).**
- Rubric: confirmed items were still tagged `[ASSUMPTION]`. **Fixed.**
- Rubric: the §7 heading "Not a natural-language date interpreter". **Fixed.**
- Rubric: the interface language can't be changed by hand. **Decision (Q15).**
- Rubric: length (about 4× the 2-page target, mostly §12). **Kept on purpose:** the author asked for removed, simplified and deferred items to be identified in the PRD.
- Rubric (Downstream): "Embedding" and "Baseline PC" missing from the Glossary (same as the prose medium finding). **Fixed.**
- Prose: 14 polish items (UJ-2 translation note, UJ-3 voice, FR-5 word order, FR-7 double negative, the Close Match antecedent, FR-15 open preset list, the §7 "handled by" wording, cross-language wording, addendum subject and verb, "Mary", addendum heading length, addendum stack duplication, FR schema consistency, heading case). **Fixed.**
- Prose: serial comma. **Not applied:** the document consistently uses no serial comma, and the one in FR-19 is kept for clarity.

## Mechanical notes
- IDs: FR-1 to FR-21, NFR-1 to NFR-12, C-1 to C-7, SM-1 to SM-5, SM-C1 to SM-C3 and UJ-1 to UJ-3 are contiguous, with no duplicates.
- FR-15 now lists FR-12 in Depends on.
- §12.1 and §12.5 now agree on revision 1 FR-17 ("Removed; replaced by FR-15").
- Assumptions Index: 10 inline tags and 10 index entries, all matched. 8 confirmed items are listed as confirmed.

## Reviewer files
- `review-rubric.md`
- `review-structure-prose.md`
