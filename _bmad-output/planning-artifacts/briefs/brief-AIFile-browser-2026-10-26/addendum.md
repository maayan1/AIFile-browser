---
title: "Addendum: File Browser 2.0 Product Brief"
created: 2026-10-26
updated: 2026-10-26
---

# Addendum: File Browser 2.0

Supporting detail for the brief and for later documents (PRD, architecture). The brief cites this rather than repeating it.

## Notes for PRD and Architecture

Points raised during analysis on 2026-10-26. These are not decisions yet.

- **"Natural language" means two separate AI tasks.**
  - (a) *Understanding the question*: pulling out the time clue ("in the fall", "between Jan 10 and 20") and the topic. This might not need a full LLM. A Hebrew and English date and expression parser plus simple rules could handle the example queries. A bundled LLM would make the installer much larger and searches slower on a CPU.
  - (b) *Matching by meaning*: embedding similarity between the topic and document contents. This needs a small multilingual embedding model, around 100 MB, which runs on a CPU.
  - To be decided in the architecture phase, based on the query patterns the PRD requires.
- **Windows timestamps.** Modified time is reliable. Created time resets when a file is copied (for example from a USB stick or an email attachment). Last-access updates are often turned off. "Worked on" should probably map to modified time, with created time as a secondary signal.
- **Hebrew.** The embedding model must support Hebrew. Text extracted from Hebrew PDFs is often in reversed (visual) order and must be checked. The interface needs right-to-left support for Hebrew queries and filenames. Hebrew time expressions include Jewish holidays and the Hebrew calendar ("around Passover", "before Rosh Hashanah").
- **Installer size.** The installer has to include the models and the runtime. Set a size budget early.
- **Explanations.** "Why it matched" can come from matched terms, the best-matching passage, and the date-range match. It doesn't need a generative model.
- **Public GitHub repository.** No secrets in the code. Model licenses must allow redistribution inside the installer.

## Competitive Landscape (October 2026)

Collected by web research on 2026-10-26. Some rows rest on a single source; see "Unverified" below.

| Name | What it does | Local / cloud | Notable limits |
|---|---|---|---|
| Windows Search with Copilot+ semantic indexing | Natural-language search in File Explorer, runs offline on the NPU, includes OneDrive photos | Local (NPU) + OneDrive | Copilot+ PCs only (40+ TOPS NPU). Indexed locations only. 6 languages. Finds files but can't act on or reorganize them. |
| File Explorer AI actions / Ask Copilot / Copilot Actions | Summarize and edit from the right-click menu. Agents work on local folders (preview). | Hybrid | Summarize needs M365 + Copilot and works only on OneDrive/SharePoint files. Copilot Actions is an opt-in Insider preview. |
| Recall | Searchable screenshot timeline | Local | Privacy backlash (blocked by Signal, Brave, AdGuard). Now opt-in. |
| macOS Tahoe Spotlight | Actions, quick keys, filters. Apple Intelligence through Shortcuts. | Local / Private Cloud Compute | No clear semantic search over file contents. |
| Google Drive + Gemini | Natural-language file finding, "Ask Gemini in Drive" | Cloud | Paid AI plans only. Parts in US beta. |
| OneDrive Copilot | Find, analyze, and act on files in natural language | Cloud | Preview Aug 2026, GA expected Dec 2026. Paid add-on (~$30/user/mo). |
| Dropbox Dash | Universal search across connected apps | Cloud | ~$19/user/mo. Built for teams. |
| Box AI | Extract agents, Hubs, Box Agent / Automate | Cloud | Enterprise only. |
| Everything (voidtools) | Instant filename search | Local | Filenames only. No content or semantic search. |
| Raycast / Alfred | Launchers with keyword content search | Local | Keyword search, not semantic. AI is a separate chat feature. |
| Sparkle (Every) | Auto-organizes Mac Desktop, Downloads, and Documents | Cloud LLM | Mac only. Reportedly sorts by filename, not content. ~$9+/mo. |
| LlamaFS / Local-File-Organizer | Open-source LLM rename and sort | Optional local | Prototypes, apparently not maintained. |
| DigUp, VaultSeek, Dotient | Local semantic search (ONNX / EmbeddingGemma / CLIP) | Local | Small, unproven. Dotient handles images only. |
| AnythingLLM | Local RAG workspace you chat with | Local / BYO model | Chats over documents. It is not a file browser. |
| Claude Cowork | Agent that reads, edits and organizes a folder you choose | Local files, cloud model | Asks before deleting, but has no undo. |
| Rewind / Limitless | Exited | — | Bought by Meta Dec 2025. Mac app shut down. |

### Insights

- **Biggest risk: OS and cloud vendors are building this in.** Microsoft ships semantic search, AI actions and agents in Explorer. Google and Microsoft are adding natural-language search to their clouds. The openings left are non-Copilot+ PCs (most of the installed base), macOS, and storage that mixes local drives, NAS, and several clouds.
- **Nobody combines all the pieces.** Filename search (Everything), semantic search (Windows), organizers (Sparkle, LlamaFS), and RAG chat (AnythingLLM) are separate products. No explorer offers all of them.
- **Safe natural-language file operations are wide open.** Agents act on files, but without a preview, transactions, or undo.
- **Privacy influences which tools people choose.** The Recall backlash and Rewind's exit show distrust of AI indexing local files. Local-first indexing with an on-device model and explicit folder scoping is a selling point.
- **Cross-source search is either team-priced or missing.** No one serves a prosumer whose files sit on a local disk plus Drive plus OneDrive.
- **User pain:** Windows indexing is slow and heavy on CPU, so many people switch to Everything, which can't search inside files.

### Unverified

Mentioned in research but not confirmed: Fenrir, Khoj, Msty, Fabric, and Sider. The Windows 26H2 rollout date and Box's April 2026 agents each rest on a single source. User-pain points come from press and forum coverage, not primary Reddit or HN threads. Pricing comes from third-party aggregators.
