# Adversarial review: ARCHITECTURE-SPINE.md (File Browser 2.0)

Reviewer: independent adversarial pass, 2026-11-02. Lens: pairs of separately built units that obey every AD and convention to the letter yet still don't fit together.

**Verdict: Needs revision before epics. The paradigm and the storage and privacy invariants are sound. The spine leaves the search protocol shape, persistent app state outside the versioned Index, process exclusivity, and the operational envelope unsettled, so independently built stories will not fit together. That gives 3 critical, 8 high, 9 medium and 3 low findings.**

---

## Critical

### 1. One Enter runs two searches, and "latest search wins" makes them cancel each other
- **Unit A:** Phase 2 story "Filename Search" (FR-5/6). It defines request `type:"filenameSearch"`. Under AD-10 it is a "search", so a new one cancels the running one.
- **Unit B:** Phase 4 story "Smart Search" (FR-12/13). It defines `type:"smartSearch"`. The UI sends both on Enter, because FR-12 says both run together and UX says name matches appear first.
- **Collision:** AD-10 says "a new search request cancels any running search", so the second request kills the first. If the builder instead exempts one of them, then an Enter pressed while a previous Enter is still running leaves an orphan running. FR-12 also requires that Filename Search uses the query *with the Date Phrase removed*, but only the engine may parse dates (AD-3). So the UI can't build the filenameSearch text without first making a round trip. EARS-03 ("No matching files found" only when *both* groups are empty and no Filter is active, never after a cancel) needs one place that sees both outcomes. With two requests that place can only be the UI, which AD-3 forbids. FR-23 needs Name matches suppressed, which a filenameSearch request cannot know about.
- **Severity:** Critical. This is the core interaction of the product, and every Phase 4 story touches it.
- **Fix (new AD):** "One Enter = one `search` request `{id, text, folder, dateFilter?, typeFilter?, literalPhrases?}`. The engine replies on that id in a fixed order: `searchParsed{dateRange, phraseText, residualText, mode: normal|dateOnly}` → `nameMatches{…}` (omitted in dateOnly) → `contentMatches{…}` | `dateOnlyResults{…}` → terminal `searchDone{outcomeCode?, notices[]}` or terminal `cancelled`. Every request ends with exactly one terminal message. Latest-wins applies per channel (`search`, `preview`, `listFolder`), not across channels. In Phase 2, `search` returns only `nameMatches` + `searchDone`." Phase 2 then builds the same request Phase 4 extends.

### 2. The Indexed Folders list lives inside the versioned, format-dependent `meta-<v>.json`
- **Unit A:** the FR-20 upgrade story. On a format mismatch it "triggers a full rebuild" (AD-6). The new code cannot safely parse a meta file in the old format, so it starts from empty.
- **Unit B:** the FR-7/FR-11 "Search folders" story. It reads and writes the folder list through pipeline commands (AD-5), and it lives in meta (AD-6, Configuration convention).
- **Collision:** FR-20 requires "keeps the Indexed Folders" across a format change, but they sit in a file the new version declares incompatible. "Delete all Index data" (FR-11) deletes them too, and a rebuild that starts from an empty version loses them. There are also timing gaps:
  - A folder added or removed only becomes durable at the next pipeline commit. If the app crashes before that, the user's Remove is undone and a privacy-motivated removal comes back. This is exactly the "resurrected entries" AD-5 claims to prevent.
  - During a 30-minute first index, a Remove command queues behind the current batch.
  - First-run state ("Start" pressed vs "Skip for now", which must not re-prompt) has no owner. The shell's window-state file and the engine's "no manifest = first run" will both be built, and they disagree after "Delete all".
  - "Last checked today at 9:14 AM" either needs a full-version commit for a no-op check or is lost on restart.
- **Severity:** Critical. It is user-visible data loss, or a privacy regression, on upgrade, delete and crash.
- **Fix (tighten AD-5/AD-6):** "User intent lives outside the versioned Index, in `%LOCALAPPDATA%\FileBrowser2\settings.json`. It holds the Indexed Folders, the first-run outcome, the last-check time and any pending one-time notices. Its schema is independent of the index format version. It is written atomically by the engine's command handler *before* the command is acknowledged. The Index is derived data. On every start and after every command, the pipeline reconciles the Index against `settings.json`. Rebuild and Delete-all never touch `settings.json`. Only uninstall, if the user agrees, removes it."

### 3. Nothing guarantees there is only one engine process, so "single writer" holds per process only
- **Unit A:** the shell story "sidecar lifecycle / NFR-10 restart" (AD-2). It restarts the sidecar when it "exits unexpectedly". A builder adds a "not responding" timeout and spawns a new sidecar while the hung one is still alive. Killing a PyInstaller onedir process tree on Windows is not guaranteed to be immediate.
- **Unit B:** the UI protocol-client story. It spawns the sidecar from JS (`Command.sidecar().spawn()`, a legitimate Tauri API). A WebView reload re-runs the spawn. F5 is bound to "reload folder" in UX but reloads the WebView by default. The old child is orphaned.
- **Also:** the user double-clicks the app icon twice, giving two shells and two sidecars.
- **Collision:** each engine obeys AD-5 and AD-10 internally, yet two indexing workers write `manifest.json`, `meta-<v>` and `vec-<v>` concurrently, with the same next-version number. That violates NFR-8.
- **Severity:** Critical. It corrupts the Index, which is the one thing NFR-8 forbids.
- **Fix (new AD or extend AD-2/AD-5):** "The Rust side of the shell alone spawns, restarts and kills the sidecar. The JS side never spawns. The app is single-instance (Tauri single-instance plugin). The engine takes an exclusive OS lock on `index\.lock` before reading or writing the Index. If it cannot get the lock it exits with a defined code, and the shell waits for the old process to die before retrying. A restart kills the whole old process tree first."

---

## High

### 4. Two units fight over stdout: library prints, concurrent writers and the Windows code page
- **Unit A:** an extractor adapter (the PDF library from the Phase 3 spike, or python-docx) or ONNX Runtime prints a warning to stdout. pdfminer-family libraries and ORT both emit diagnostics.
- **Unit B:** `stdio_transport` writes JSON lines from the request pool *and* the indexing worker (progress events).
- **Collision:**
  - A stray print injects a non-JSON line.
  - Two threads writing at once interleave half-lines.
  - A frozen Python with piped stdout defaults to the ANSI code page (cp1252), so the first Hebrew path raises `UnicodeEncodeError` in the transport even though AD-2 says "UTF-8".
  - Each unit is correct on its own.
- **Severity:** High. Hebrew users and indexing progress hit it in Phase 1–3 testing in ways that are hard to reproduce.
- **Fix (convention):** "At startup `main.py` dups the real stdout fd for the transport only, then redirects `sys.stdout` and fd 1 to the log or stderr. All protocol output goes through one writer queue and thread. Stdin and stdout are opened as UTF-8 explicitly. Each message is a single line under a stated maximum size, and large payloads (big folder listings) are chunked as multiple replies on the same id." Also verify how the Tauri shell plugin frames stdout on line boundaries for very long lines.

### 5. "Show in folder" means two different things
- **Unit A:** the shell story implements `explorer.exe /select,<path>`. AD-4 lists "show in folder" as one of the two OS calls the shell makes directly.
- **Unit B:** the UI search-view story follows PRD FR-3 ("navigates *the app* to the containing folder and selects the file") and the UX Content result row ("leaves the search view, navigates to the containing folder and selects the file", Ctrl+Shift+E).
- **Collision:** both are spine-compliant, but they produce two different features. AD-4 encodes a behavior the PRD and UX don't ask for.
- **Severity:** High. Flow 3's climax depends on it.
- **Fix (amend AD-4):** "'Show in folder' is in-app navigation: a `listFolder` request for the parent folder plus a selection held in UI state. The shell's only direct OS call is 'open with the default app'."

### 6. Change detection versus Activity Date storage
- **Unit A:** the commit stage stores Activity Date "as ISO 8601 with offset" (AD-9), for example `2025-10-14T21:03:11+03:00`. That is second precision, and the offset is whatever `astimezone()` gives.
- **Unit B:** the FR-10 check stage compares "last-modified time or size" to the stored values using `os.stat().st_mtime` or `st_mtime_ns`.
- **Collision:** sub-second precision never matches, so every file looks modified on every startup. That is a full re-embed, and FR-10's 60 s target fails. The offset adds two more problems:
  - If the indexer stamps the *current* offset rather than the offset in effect at mtime, files near midnight move across days and Sunday–Saturday weeks after DST changes.
  - If the user changes time zone, stored offsets and "local calendar days" disagree between date-list building and range computation.
- **Severity:** High.
- **Fix (tighten AD-9):** "The Index stores `mtime_ns` (integer) and `size` as the change key. Activity Date is derived from `mtime_ns` and converted to a local calendar date at load time, when the date list is rebuilt (AD-7), using the current zone rules. ISO 8601 with offset is the *protocol* form only."

### 7. The embedding contract has no owner: prefixes, normalization, score scale and document aggregation
- **Unit A:** the chunk/embed stage (Phase 3) prepends `passage: ` because e5-small needs it, or doesn't because granite doesn't, and stores raw vectors.
- **Unit B:** the ranking story (Phase 4) embeds the query through EmbedderPort, scores with a dot product, takes the top 20 *Passages*, then dedups by document. It applies the Close Match threshold and Relevance Floor read from `rules/`.
- **Collision:**
  - A double prefix, or a missing one, silently costs SM-1 points.
  - Un-normalized vectors make dot product ≠ cosine, so the tuned thresholds mean nothing after a model swap.
  - Deduping after taking the top 20 Passages returns fewer than 20 documents, and the "≤ 5 Close Matches" cap is counted on Passages rather than files.
  - AD-8 calls prefixes part of the format, but AD-6's manifest field list doesn't include them.
- **Severity:** High. These are silent quality failures that only an SM-1 run shows.
- **Fix (tighten AD-8 and AD-7):** "EmbedderPort has `embed_query(text)` and `embed_passages(texts)`. The adapter owns prefixes and returns L2-normalized float32. Score = dot product. A document's score is its best Passage's score, and Floor, threshold, top-20 and the 5-Close-Match cap all apply to documents. The manifest records the query and passage prefixes. Threshold values in `rules/` are keyed by model id."

### 8. The date-phrase lifecycle across re-runs: suppression, presets and manual filters
- **Unit A:** the FR-15 filter-chip story. Clearing a phrase-set chip "puts the phrase back into the Search Bar as ordinary text" and re-runs. The builder re-sends the full text with `parseDates:false`.
- **Unit B:** the FR-14 parser story treats every request statelessly and recognizes the phrase again. Another builder keeps "suppressed phrases" in engine memory per session, which is lost on sidecar restart.
- **Collision:**
  - The phrase is re-set, which breaks FR-15. Or a global `parseDates:false` stops recognizing a *different* phrase the user types next.
  - Presets: under AD-9 the engine computes "Last week", but the UI may send computed ISO dates or a preset token, and the chip label can be "Last week" or "Oct 25–31". FR-15 requires phrase-set and hand-set filters to look the same.
  - Manual Date Filter with an empty or filler-only bar: is it date-only (FR-23 rules, 50 cap, clear = exit search) or Smart Search on nothing? FR-23 is defined only for a recognized phrase.
- **Severity:** High.
- **Fix (part of the AD in #1):** "Requests carry `literalPhrases: [string]`. The UI holds them because it holds the bar text; they are phrases the engine must not recognize again. `dateFilter` is either `{preset}` or `{from,to}`, and the engine always echoes the resolved `{from,to,source}` in `searchParsed`. The chip label is always the resolved range. The engine decides `mode`. A Date Filter plus empty or filler-only text is `dateOnly` whatever set the filter, and the UI's 'clear date = exit search' behavior keys only on `mode`."

### 9. Skip reasons and unsupported files don't match the Search folders UX
- **Unit A:** the indexing scan story stores "unsupported-extension counts" (AD-6) and skipped documents with reason codes. In line with FR-10 ("only … Supported Documents are processed") it recounts nothing on incremental update and never re-checks a skipped file whose mtime and size are unchanged.
- **Unit B:** the Search folders section ② story (UX). Groups are "scanned documents and pictures", ".doc", "other file types", "password-protected" and "OneDrive", and *each group expands to list its files with their locations*. That includes unsupported files, which have only counts.
- **Collision:**
  - There is no data to list unsupported files.
  - The grouping mixes skip reasons (image-only PDF) with extensions (.jpg, .png), and nothing says who maps extension → group. The UI builder will write that mapping in TypeScript, which breaks AD-3.
  - A OneDrive placeholder that is later downloaded keeps its mtime and size, so it stays skipped for good.
  - Unsupported counts go stale.
- **Severity:** High. A whole UX section can't be built from the stored shape.
- **Fix (tighten AD-6 and AD-1):**
  - "meta stores, per Indexed Folder, unsupported files as `{path, ext}` up to a stated cap (with total counts above the cap)."
  - "The core owns the mapping from reason or extension to display group and sends group codes."
  - "Every update re-scans unsupported counts and re-checks every skipped file (skip entries carry the attribute or reason that caused them), not just changed ones."

### 10. Startup, readiness and liveness: the operational envelope has no rules
- **Unit A:** `main.py` (AD-1 seed: "wires adapters, starts stdio loop + indexing worker") loads the model and the whole Index into memory *before* serving, which takes 5–10 s on the Baseline PC.
- **Unit B:** the shell's NFR-10 story detects "backend not responding" with a reasonable 3–5 s timeout and restarts.
- **Collision:** a restart loop on every cold start of a slow PC. Phase 1 browsing (`listFolder`) also waits behind model load, though it needs neither the model nor the Index. Three cases have no rules:
  - A corrupt `meta` makes the engine crash on load, the shell restarts it, and it crashes again. NFR-8's "worst case, the Index rebuilds itself" has no trigger.
  - Requests in flight at the time of a crash have no defined end, so the spinner never stops.
  - There is no restart backoff or cap.
- **Severity:** High.
- **Fix (new AD "Engine lifecycle"):**
  - "The stdio loop starts first and answers `listFolder`, `filenameSearch` and `status` immediately. Model and Index load lazily or in the background, and searches that need them wait inside the engine, not in the shell."
  - "The engine emits `ready{protocolVersion, phase}` within 1 s of start. Liveness = a `ping` answered within N s."
  - "A load failure of meta or vec leads to quarantining the files and a rebuild, never a crash."
  - "Restarts back off exponentially, and after K failures the banner stays."
  - "On restart the UI fails every pending id locally and re-requests `status`."

### 11. The concurrency envelope inside one Python process
- **Unit A:** the indexing worker thread runs pure-Python PDF extraction (holding the GIL) and an ONNX session with default intra-op threads (all 4 cores). It is "below-normal priority" (AD-10), implemented as `SetPriorityClass` on the *whole process* because Python can't easily lower one thread's priority.
- **Unit B:** the request pool runs Filename Search walks and the query embedding.
- **Collision:**
  - Under the GIL and full core use, "user requests never wait for the indexing worker" is false in practice, so NFR-2 and NFR-3 fail during indexing.
  - A process-wide priority lowers searches too.
  - A second ONNX session for queries doubles model memory (NFR-6).
  - Previews are not latest-wins. Holding ↓ through a folder of PDFs queues dozens of extractions, which fills the "small" pool and blocks the search that follows.
- **Severity:** High. NFR-2, NFR-4 and NFR-6 are all at stake.
- **Fix (tighten AD-10):**
  - "One shared ORT session (thread-safe). The indexing worker caps ORT intra-op threads at cores−1 and yields between files."
  - "CPU-heavy extraction runs in a single child worker *process* owned by the indexing worker (extraction only, no Index writes) or is time-sliced. Pick one and state it."
  - "Previews are latest-wins per channel (see #1). Every long operation checks its cancel token between files or directories."
  - State the measured envelope: the RAM budget split (model, two Index copies during a switch, extraction).

---

## Medium

### 12. Commit cadence, reload path and Windows file semantics
- **Unit A:** the commit stage writes a *complete* new `meta`/`vec` pair (AD-5/AD-6) after every batch of, say, 20 documents.
- **Unit B:** the serving story reloads from disk on every version switch (AD-7), maybe with `np.load(mmap_mode='r')` to save RAM (NFR-6).
- **Collision:**
  - About 250 full rewrites of a meta file that holds Passage text (tens of MB), each followed by a full re-parse, will miss the 30-minute indexing target (NFR-4) and the CPU budget.
  - A memory-mapped old `vec` cannot be deleted on Windows, so "delete after switch" raises PermissionError and the commit story treats it as a failure.
  - A crash between "rename into place" and the manifest rewrite leaves an unreferenced `meta-<v+1>`, and the next commit's rename collides (`os.rename` fails if the target exists).
- **Fix (tighten AD-6/AD-7):**
  - "Commit at most every T seconds or N documents (values in `rules/`)."
  - "The writer hands the new in-memory snapshot to readers directly. Disk reload happens only at start. No mmap of Index files."
  - "Use `os.replace`. On start, delete temp files and any versions not named by the manifest. Old-version deletion failures are retried at the next start, never fatal."

### 13. One vocabulary for "why this file can't be read"
- **Unit A:** the indexing story persists skip codes, for example `storedOnlyInOneDrive`, `passwordProtected` and `noTextLayer`, in `meta`. The OneDrive check sits in the FileSystemPort adapter (AD-4), which raises or returns its own value.
- **Unit B:** the preview story (FR-22) invents `previewUnavailable{reason:"cloud"}` and `cannotRead`. The error-handling story uses `accessDenied` as a protocol error for `listFolder`.
- **Collision:**
  - The same condition gets two codes, or the same code is used in two contexts that need different wording. `accessDenied` for a folder should read "You don't have permission to open this folder"; in a preview it should read "This file can't be read".
  - Persisted codes renamed later in `protocol/` become unknown to the UI.
  - Nothing checks that every code has an EN and an HE catalog string.
- **Fix (convention):**
  - "The core defines one `ReadOutcome` enum used by indexing and preview. Adapters return raw facts (an attribute, an exception kind) and the core maps them."
  - "Catalog keys are `context.code`. A CI or unit test asserts that every code in `protocol/` has EN and HE strings."
  - "Persisted codes are frozen per index format version."

### 14. Command scheduling: remove vs a running index, cancel, nesting and missing folders
- **Unit A:** the pipeline queue (AD-5) is FIFO.
- **Unit B:** the "Remove folder" button, the "cancel by id" contract (AD-10 says *each request* can be cancelled) and the "Add folder" picker.
- **Collision:**
  - Remove waits behind an in-progress first index, and searches keep returning the removed folder's content (readers see the last commit). Users remove folders for privacy.
  - One builder makes `cancel` stop a queued `rebuild`. Another assumes commands are not cancellable, because pause and resume are deferred.
  - Adding `Documents\Volunteering` under an indexed `Documents`, then removing `Documents`, deletes documents still covered by the child.
  - An Indexed Folder on an unplugged drive at startup is read as "all files deleted".
- **Fix (tighten AD-5):**
  - "Remove preempts. The pipeline stops the current batch, commits the removal immediately, and readers filter by the current folder set from `settings.json` in the meantime."
  - "Commands are not cancellable by `cancel`, which applies to user requests only."
  - "A document is kept while *any* Indexed Folder covers it. Adding a nested folder is a no-op."
  - "An unreachable folder keeps its entries and is reported as a status code."

### 15. Where the UI gets indexing status
- **Unit A:** the search-results story renders "Indexing in progress: results may be incomplete" whenever the last `indexProgress` event said "running". That is a UI decision, and AD-3 forbids it.
- **Unit B:** the engine search story includes no such flag, because AD-3 says the engine picks messages but the spine doesn't put this one in the result.
- **Collision:**
  - Indexing can finish between the search and the render.
  - After a sidecar restart the UI has missed every event, so the status bar shows nothing until the next progress tick.
  - The progress phases are undefined: "Reading … 340 of 2,100" vs "Checking for changed documents…", and the total is unknown until the scan finishes.
  - So is the payload of the index-version-change event, and whether the UI re-queries anything when it arrives.
- **Fix:**
  - "Search replies carry `{indexVersion, indexingActive}` as a snapshot, and notices are listed in `searchDone.notices`."
  - "`status` is a request/reply snapshot: phase ∈ {idle, scanning, checking, indexing, rebuildingForUpgrade}, done/total (total null while scanning), document count, last check."
  - "Events are hints that the UI may coalesce. The UI re-requests `status` on connect and on an `indexVersionChanged` event."

### 16. The query-parsing seam between Date Phrases and date-only
- **Unit A:** the FR-14 parser returns `remaining_text` by deleting a substring. The Hebrew prefix rule (addendum) leaves fragments, for example the stray "-" or "ב" in "ב-2025", a trailing comma, or a doubled space. It recognizes the first phrase only.
- **Unit B:** the FR-23 story splits the remainder on whitespace and matches tokens exactly against `rules/filler`.
- **Collision:**
  - "עבדתי על המסמך בשבוע שעבר": "המסמך" with the article prefix isn't in the list, and leftover punctuation fails the match, so the query is not treated as date-only and the FR-23 acceptance can fail by accident.
  - Two phrases ("in March 2025 last week") are handled differently by each unit.
- **Fix (convention):**
  - "`core/search/query.py` owns `parse_query(text, literal_phrases) → ParsedQuery{range, phraseSpan, residualTokens, isDateOnly}`. Normalization (punctuation, Hebrew ה/ב/ל/מ/ו prefixes, case) is defined once and used for both phrase and filler matching."
  - "At most one Date Phrase sets the filter (the first one). Any others stay as text."
  - "The filler list is tested together with the FR-14 list."

### 17. While an FR-20 rebuild runs, what is served?
- **Unit A:** the upgrade story starts the rebuild and keeps serving the old committed version "so search still works", following AD-5 ("readers read the latest committed version").
- **Unit B:** the query story embeds with the *new* model.
- **Collision:**
  - Queries are scored against vectors from a different model, so the results are nonsense with no error.
  - If the app restarts during the rebuild, the "one-time notice" either repeats or never appears, because its state has no home.
  - Downgrading (an older app on a newer format) is undefined.
- **Fix (tighten AD-6):**
  - "On mismatch the old version is never loaded. The engine serves an empty version plus what the rebuild commits, with `indexingActive` set."
  - "The pending notice is stored in `settings.json` (#2) and cleared when the UI acknowledges it."
  - "A newer format than shipped is treated as a mismatch."

### 18. Path identity: comparison key vs display path
- **Unit A:** the commit stage keys documents by `casefold(normpath(p))` (AD-9) and, for simplicity, stores and returns that string.
- **Unit B:** the result-row and Preview stories display the path they receive, and pass it back to `preview` and to "open".
- **Collision:**
  - Names show up lower-cased in results.
  - NFC vs NFD Hebrew (or niqqud) forms of the same name compare unequal.
  - `\\?\` long-path prefixes and 8.3 short names coming from Windows APIs or the folder picker create duplicate identities, for example an Indexed Folder added twice under different spellings.
- **Fix (tighten AD-9):** "Store and transmit the original-case display path. The identity key = `casefold(NFC(normpath(full long path)))` is computed inside the core and never sent. Paths from the UI (picker, breadcrumb) are normalized by the engine on arrival."

### 19. Nothing enforces the `protocol/` schemas
- **Unit A:** the engine validates against `protocol/*.json`.
- **Unit B:** the UI hand-writes TypeScript interfaces "conforming" to them.
- **Collision:**
  - A field renamed in a schema updates one side only.
  - The shapes of the Type Filter (`["pdf","word"]` vs `[".pdf",".docx",".doc"]`), Match Reason tags and progress payloads are each decided by whoever builds first.
  - There is no protocol version, so a partially updated install (sidecar replaced, UI not) fails silently.
- **Fix (convention):**
  - "TS types are generated from `protocol/` at build time, and Python validates at the transport layer in debug builds."
  - "Example messages for each type live in `protocol/examples/`, and tests on both sides parse them."
  - "`protocolVersion` goes in `ready` (#10)."
  - "The Type Filter travels as category tokens. The token → extensions map lives in `core/rules`."

### 20. Extraction limits and hangs: Open Question 2 is left open
- **Unit A:** the indexing extract stage obeys AD-1 ("a stage that cannot process a file records a skip reason, never stops the pipeline") for *exceptions*.
- **Unit B:** a 300 MB PDF, or a malformed one that makes the parser loop.
- **Collision:**
  - The single indexing worker hangs forever, so the pipeline effectively stops and nothing in AD-1 covers it.
  - Preview (FR-22, 2 s) calls the same extractor and blocks a pool thread.
  - One builder adds a 50 MB cap with a `tooLarge` reason and another doesn't, so Search folders groups differ.
  - The preview story may change the ExtractorPort signature (`extract(path, max_chars)`) while the indexing story uses `extract(path)`.
- **Fix (tighten AD-1 and AD-4):** "ExtractorPort: `extract(path, max_chars: int | None)`. Every extraction has a size cap (default 50 MB, in `rules/`, giving reason `tooLarge`) and a wall-clock timeout (giving reason `cannotRead`). Preview and indexing call the same port with different limits."

---

## Low

### 21. Three walkers and no shared "visible file" predicate
Browse (FR-1), Filename Search (FR-5) and the indexing scan each walk the file system "through FileSystemPort", but nothing says they share one walker. Their rules on hidden and system files, Office lock files (`~$x.docx`, which would fill "can't read" with noise), junction loops (`My Music` under Documents) and symlinks will differ. **Fix:** "FileSystemPort exposes one `walk()` and one `list()`, and the core owns one `is_candidate(entry)` rule used by all three."

### 22. Membership of the date-only list and Type Filter edge cases
- Should the FR-23 list include skipped Supported-format files? The PRD says "every Supported Document" and UX says "every indexed document". A password-protected DOCX satisfies one reading and not the other.
- Under a Type Filter, do folders stay in Name matches?
- **Fix:** add one line each to the search AD: "the date-only list = documents with text in the Index" and "a Type Filter hides folders from Name matches", or the opposite, but stated.

### 23. Uninstall and log location
FR-21 offers to delete "Index data", but logs, the planned `settings.json` and the Index all sit under `%LOCALAPPDATA%\FileBrowser2\`. The NSIS hook could delete the whole root, or only `index\`, leaving folders and logs behind. **Fix:** "The uninstall 'delete data' option removes the whole `FileBrowser2` root. 'Keep' keeps all of it."

---

## Structural dimensions the spine leaves silent (at its own altitude)

1. **Operational envelope:** the start-up sequence, readiness, liveness, restart policy, process exclusivity, the RAM budget split, thread and core allocation, commit cadence and orphan-file cleanup (#3, #10, #11, #12). These cut across every epic and none of them is a story-level choice.
2. **Persistent application state outside the Index:** where user intent lives (folders, first run, last check, pending notices) and how it survives rebuild, delete and upgrade (#2, #17).
3. **The search interaction protocol:** the request/reply sequence, terminal messages and per-channel cancellation (#1, #8, #15). The spine fixes the envelope but not the conversation, and every Phase 2 and Phase 4 story depends on the conversation.
4. **Contract enforcement:** schema → type generation, catalog coverage, protocol versioning (#13, #19).
5. **Search-quality contract:** the score scale, document aggregation, and thresholds keyed by model (#7). These are needed so that the Phase 3 indexing and Phase 4 ranking stories can be built by different agents.
