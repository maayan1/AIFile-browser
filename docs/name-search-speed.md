# Name search speed (NFR-3)

**Claim:** for 90% of name searches on a tree of about 50,000 files, results are on screen in
under 6 s from Enter, on the Baseline PC (Windows 11, 8 GB RAM, 4 cores, no GPU). The first search
after the engine starts may take up to 10 s (NFR-2) and isn't counted in the 90%.

**Status:** engine part, measured on this development PC (above Baseline): **pass**, p90 1.04 s.
The claim as a whole (results *on screen*) isn't settled yet. Open:

- **Baseline PC run: open.** Nobody has run it on the Baseline PC yet; the result goes into
  [Runs](#runs) below.
- **On-screen check: open.** The in-app timer is in place but hasn't been read yet, especially for
  `a` and `e` (20,000+ matches, every row rendered); see [On-screen check](#on-screen-check).
- **Cold-cache first search: open.** Every run so far searched a tree still in the OS file cache
  (it had just been generated); a first search after a reboot hasn't been measured.

No filename cache was added (C-6 stays deferred).

## Method

1. **The tree.** `fixtures/make_large_tree.py` builds a synthetic tree (C-7) of empty files in an
   empty folder. It isn't committed: the same seed and file count give the same relative paths
   with the same Python minor version (3.14; Python keeps only `random()` itself stable across
   versions), so anyone can rebuild it. The default (seed 2024, 50,000 files) has:
   - 50,000 files in 2,500 folders, nested up to 6 levels below the root;
   - three very large folders (3,016, 2,517 and 2,022 files); the others hold about 16 each;
   - English, Hebrew and mixed-direction names, in lower, Title and UPPER case, with the usual
     extensions (`.docx`, `.pdf`, `.xlsx`, `.jpg`, `.png`, `.txt`, `.pptx`, `.csv`, `.zip`,
     `.mp4`, `.msg`, `.doc`, `.heic`);
   - planted names, so each search below hits its intended range.
2. **The searches.** `engine/scripts/measure_name_search.py` holds 20 fixed searches, all
   counted: 5 rare names (1-10 matches, one of them Hebrew), 11 common words (100-2,000 matches,
   4 of them Hebrew), `.pdf` (about 6,000), a nonsense word (0) and 2 single letters (tens of
   thousands). A match is a file or a folder whose name contains the text.
3. **The run.** The script starts the real engine (`engine/main.py`) and talks to it over
   stdin/stdout in JSON lines, as the shell does, with a throwaway log folder. Protocol
   validation is off, as in a release build (`--validate` turns it on, as the debug shell does).
   Each search is timed from sending `search` to receiving its terminal `searchDone`. The first
   search after the engine starts (`report`) runs once on its own first: it is reported on its
   own line, must take at most 10 s, and isn't counted. Then the 20 searches run in order.
4. **The report.** Each search's time and match count, then the median, the p90 (nearest rank:
   the 18th fastest of 20) and the maximum. Exit 0 within target; exit 1 when the p90 is 6 s or
   more, or the first search took over 10 s; exit 2 when the folder is missing or the engine fails
   (it is always closed).
5. **On screen.** The script measures the engine's part. The rest (the UI receiving and rendering
   the matches) is spot-checked in the app: under `tauri dev`, the dev console shows
   `[search] on screen <id> <ms> ms` for each search, from Enter to the second animation frame
   after its `searchDone` (a frame callback runs before that frame's layout and paint, so the
   second one runs once the results have been painted). The timer is dev only
   (`import.meta.env.DEV`), never in a release build, and never logs the search text. The search
   text never reaches the engine log either. Because it exists only in dev builds, its numbers
   always include protocol validation: the debug shell sets `FB2_VALIDATE_PROTOCOL=1`
   (`app/src-tauri/src/engine.rs`), which makes searches with thousands of matches several times
   slower (run 3: single letters about 10 s). Read them against the script's `--validate` run on
   the same tree: the on-screen time minus that run's engine time is the UI's part, and it's the
   UI's part plus the release engine time (validation off) that counts for NFR-3. A dev number over
   6 s for `a` or `e` is not by itself a miss.

`engine/tests/test_name_search_measurement.py` keeps both scripts working on small trees in temp
folders: the generator's determinism and refusal, each search's range on a scaled-down tree, and
the script end to end (report, exit codes, a missing folder, an engine error).

## How to run

```powershell
uv run --project engine python fixtures/make_large_tree.py <empty folder>
uv run --project engine python engine/scripts/measure_name_search.py <that folder>
```

Then, for the on-screen check: run the script once more with `--validate` on the same tree (the
dev shell validates every message, so that run is the engine time the dev app sees), then
`cd app; npx tauri dev`, open the folder, search a few of the 20 (including `a` and `e`, the ones
with the most matches) and read the `[search] on screen` lines in the dev console. Record them in
[On-screen check](#on-screen-check) with the `--validate` engine time beside each.

## Machines

| Machine | CPU | Cores | RAM | Disk | Windows | GPU |
|---------|-----|-------|-----|------|---------|-----|
| Development PC (**above Baseline**) | Intel Core i7-12700H | 14 cores, 20 logical | 16 GB | Samsung PM9B1 1 TB NVMe SSD | Windows 11 Pro 10.0.26300 | RTX 3050 Ti Laptop, Iris Xe |
| Baseline PC | (to record) | 4 | 8 GB | (to record) | Windows 11 | none |

## Runs

| # | Date | Machine | Tree | Validation | First search | Median | p90 | Max | Result |
|---|------|---------|------|------------|--------------|--------|-----|-----|--------|
| 1 | 2026-11-16 | Development PC (above Baseline) | seed 2024, 50,000 files, 2,500 folders | off | 0.42 s | 0.96 s | 1.04 s | 1.93 s | pass |
| 2 | 2026-11-16 | Development PC (above Baseline) | the same tree | off | 0.41 s | 0.95 s | 1.03 s | 2.25 s | pass |
| 3 | 2026-11-16 | Development PC (above Baseline) | the same tree | on (debug) | 0.55 s | 1.08 s | 2.93 s | 10.15 s | pass |
| - | | Baseline PC | seed 2024, 50,000 files | off | | | | | **open** |

The tree had just been generated, so it was in the OS file cache for every run (a cold-cache
first search is still open). Python 3.14.10.

## On-screen check

Under `tauri dev` (validation on), from the dev console. UI part = on screen minus the `--validate`
engine time for the same search.

| # | Date | Machine | Search | On screen (dev) | Engine, `--validate` | UI part | Result |
|---|------|---------|--------|-----------------|----------------------|---------|--------|
| - | | Development PC | `a`, `e` and a few others | | | | **open** |

### Run 1 in full

```
first search after start: 'report' 0.422 s, 1000 matches (limit 10 s: ok; not counted)

 #  search           kind       seconds  matches
 1  report           common       0.401     1000
 2  zephyrine        rare         0.371        1
 3  סיכום            common       0.386      500
 4  .pdf             extension    0.498     6035
 5  meeting          common       0.394      600
 6  invoice 7731     rare         0.788        2
 7  a                letter       1.793    21610
 8  חשבונית          common       0.976      300
 9  budget           common       0.985      400
10  qxzvbnw          none         0.934        0
11  kilimanjaro      rare         0.925        4
12  photo            common       1.003      800
13  פגישה            common       1.015      400
14  contract         common       1.041      250
15  מכתב המלצה       rare         0.919        3
16  notes            common       0.990      500
17  e                letter       1.929    25143
18  passport scan    rare         0.973        6
19  תמונה            common       0.960      250
20  presentation     common       0.957      200

median 0.959 s, p90 1.041 s, max 1.929 s over 20 searches
p90 target: under 6 s: ok
verdict: PASS
```

## Findings

- Every search walks the whole tree, so the time hardly depends on the text: about 0.4-1.0 s for
  a few hundred matches, about 2 s for the single letters (20,000+ matches each, mostly the cost of
  sending them).
- In both runs the times rose from about 0.4 s to about 1.0 s partway through and stayed there.
  Not investigated: it stays far inside the target.
- With protocol validation on (debug builds only), the searches with thousands of matches slow down
  a lot (`.pdf` 2.9 s, single letters about 10 s). Release builds don't validate.
- The cheap known causes in `deferred-work.md` are still open. The engine-side one (flushing only
  between folders) wasn't needed for the engine number. The UI-side one (the matches copied per
  batch in `SearchSession`) can't be seen by the script, so it stays unmeasured until the on-screen
  check runs.

## Verdict

**Engine part: pass on the development PC (above Baseline):** p90 1.04 s against 6 s, first
search 0.42 s against 10 s (warm cache). That leaves a wide margin for a slower machine and for
rendering, but NFR-3 isn't passed until the open items above are done: the Baseline PC run, the
on-screen check (especially `a` and `e`) and a cold-cache first search.
