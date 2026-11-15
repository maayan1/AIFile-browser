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

Later stories add the FR-14 Date Phrase list, filler and nonsense-query lists,
the SM-1 synthetic collection and the EARS fixtures here.
