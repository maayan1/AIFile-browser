# fixtures

Synthetic test data only (C-7): no real user documents, names or text.

## Correct Display names

`correct-display-names.json` is the fixed list of Hebrew, English and mixed-direction names and
folder paths that must read correctly on screen: in logical order, with the extension at the end,
and with path segments in their real order, each isolated. Each entry is `{segments[], name, kind}`:
an item `name` (a `file` or a `folder`) inside the folders `segments` below the folder searched.
Every name contains a dot, so a search for `.` finds them all; no segment does.

It is used by:

- the app tests, which render every entry in the browse list and in Name matches
  (`app/src/browse/BrowseList.test.tsx`, `app/src/search/ResultList.test.tsx`);
- the engine round trip, which builds the tree on disk, searches it and gets every name and folder
  back unchanged (`engine/tests/test_stdio_roundtrip.py`);
- the manual check: `python fixtures/make_correct_display_tree.py <folder>` builds the tree with
  empty files; browse it under `tauri dev`, then search `.` and compare both views.

Story 7.2 reuses the list for the Hebrew interface.

## Large tree (name-search speed)

`make_large_tree.py` builds the synthetic tree for the NFR-3 measurement (Story 2.4):
`python fixtures/make_large_tree.py <empty folder> [--seed N] [--files N]`. The default (seed 2024,
50,000 files) gives about 2,500 nested folders, a few very large folders, English, Hebrew and
mixed names with the usual extensions, and empty files. The same seed and file count give the
same relative paths with the same Python minor version (3.14), so the tree itself is never
committed. It writes only inside the folder given (creating it, but not its parents, when missing),
and refuses (exit 2, nothing written) a folder that isn't empty or whose parent doesn't exist.

It plants names so each of the 20 searches in `engine/scripts/measure_name_search.py` hits its
intended range; change the two lists together. It is used by:

- the measurement, `engine/scripts/measure_name_search.py` (method and results in
  `docs/name-search-speed.md`);
- `engine/tests/test_name_search_measurement.py`, on small trees in temp folders.

Later stories add the FR-14 Date Phrase list, filler and nonsense-query lists,
the SM-1 synthetic collection and the EARS fixtures here.
