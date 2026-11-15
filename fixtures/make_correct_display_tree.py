"""Builds the Correct Display tree in a folder, for the manual check under `tauri dev`.

    python fixtures/make_correct_display_tree.py <folder>

Creates each entry of correct-display-names.json inside its segments below <folder>: a folder for
`kind: folder`, an empty file otherwise. Existing items are left as they are; nothing is deleted.
Then browse <folder> and its subfolders, and search it for "." (every name holds a dot).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

NAMES = Path(__file__).resolve().parent / "correct-display-names.json"


def build(root: Path) -> list[Path]:
    """Creates the tree under `root`; returns every entry's path, in the list's order."""
    paths: list[Path] = []
    for entry in json.loads(NAMES.read_text(encoding="utf-8"))["entries"]:
        folder = root.joinpath(*entry["segments"])
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / entry["name"]
        if entry["kind"] == "folder":
            path.mkdir(exist_ok=True)
        elif not path.exists():
            path.touch()  # only when missing: an existing file keeps its modified date
        paths.append(path)
    return paths


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python fixtures/make_correct_display_tree.py <folder>", file=sys.stderr)
        return 2
    root = Path(argv[1])
    sys.stdout.reconfigure(encoding="utf-8")  # Hebrew names, whatever the console's code page
    for path in build(root):
        print(path.relative_to(root))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
