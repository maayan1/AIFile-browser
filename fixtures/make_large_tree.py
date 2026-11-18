"""Builds the synthetic large tree for the name-search speed measurement (NFR-3, Story 2.4).

    python fixtures/make_large_tree.py <empty folder> [--seed N] [--files N]

Defaults: seed 2024 and 50,000 files in about 2,500 folders (one folder per 20 files), nested up to
MAX_DEPTH levels, with a few very large folders. Names are English, Hebrew and mixed, with the
usual extensions. Every file is empty. The same seed and file count give the same relative paths
with the same Python minor version (3.14; Python keeps only `random()` itself stable across
versions), so the tree is never committed (C-7): anyone can rebuild it.

The names are planted so that each of the 20 searches in `engine/scripts/measure_name_search.py`
hits its intended range: a few rare names, common words in 0.2-4% of the files, `.pdf` in about
12%, and filler words that contain none of the searched words. Change the two lists together;
`engine/tests/test_name_search_measurement.py` checks they still agree.

It writes only inside <folder>, creates it (but no parent of it) when missing, and refuses
(exit 2, nothing written) a folder that already holds anything, or whose parent doesn't exist. It
never deletes.
"""

from __future__ import annotations

import argparse
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_SEED = 2024
DEFAULT_FILES = 50_000
FILES_PER_FOLDER = 20  # so the default tree has about 2,500 folders
MAX_DEPTH = 6  # folder levels below the root; keeps every path well under MAX_PATH

# A few very large folders, as shares of all files (3,000, 2,500 and 2,000 at the default size).
LARGE_FOLDERS = (0.06, 0.05, 0.04)

# Rare names: exactly this many files each, whatever the tree's size.
RARE = {
    "Zephyrine": 1,
    "Invoice 7731": 2,
    "Kilimanjaro": 4,
    "Passport scan": 6,
    "מכתב המלצה": 3,
}

# Common words: this share of the files each (one planted word per file at most).
COMMON = {
    "report": 0.020,
    "meeting": 0.012,
    "budget": 0.008,
    "photo": 0.016,
    "contract": 0.005,
    "notes": 0.010,
    "presentation": 0.004,
    "סיכום": 0.010,
    "חשבונית": 0.006,
    "פגישה": 0.008,
    "תמונה": 0.005,
}

# Extensions and their weights; `.pdf` is about 12% of the files.
EXTENSIONS = {
    ".docx": 22, ".pdf": 12, ".xlsx": 12, ".jpg": 14, ".png": 7, ".txt": 8,
    ".pptx": 6, ".csv": 4, ".zip": 3, ".mp4": 3, ".msg": 4, ".doc": 3, ".heic": 2,
}

# Filler words: none contains a searched word (checked by the measurement test).
FILLER_EN = [
    "scan", "copy", "final", "draft", "version", "summary", "list", "plan", "form", "letter",
    "receipt", "table", "chart", "image", "data", "backup", "export", "minutes", "review",
    "proposal", "quote", "order", "schedule", "agenda", "lesson", "homework", "trip", "family",
    "garden", "kitchen", "car", "insurance", "salary", "tax", "bank", "statement", "client",
    "project", "design", "sketch", "update", "monthly", "weekly", "annual", "new", "old",
]
FILLER_HE = [
    "טיוטה", "סופי", "עותק", "גרסה", "רשימה", "תוכנית", "טופס", "קבלה", "טבלה", "גיבוי",
    "הצעה", "הזמנה", "לוח", "שיעור", "טיול", "משפחה", "גינה", "מטבח", "רכב", "ביטוח",
    "משכורת", "מס", "בנק", "דוח", "לקוח", "פרויקט", "עיצוב", "עדכון", "חודשי", "שבועי",
    "שנתי", "חדש", "ישן", "מסמך", "תעודה", "אישור", "בקשה", "חוזה",
]
FOLDER_EN = [
    "Archive", "Projects", "Clients", "Scans", "Misc", "Old", "Drafts", "Work", "Home", "Travel",
    "School", "Taxes", "Family", "Shared", "Inbox", "Bills", "Media", "Forms",
]
FOLDER_HE = [
    "ארכיון", "פרויקטים", "לקוחות", "סריקות", "שונות", "ישן", "טיוטות", "עבודה", "בית",
    "נסיעות", "לימודים", "מיסים", "משפחה", "משותף", "חשבונות", "מדיה", "טפסים",
]


@dataclass
class Folder:
    rel: tuple[str, ...]
    depth: int
    names: set[str] = field(default_factory=set)  # casefolded names already used in it
    files: list[str] = field(default_factory=list)


def plan(seed: int = DEFAULT_SEED, files: int = DEFAULT_FILES) -> tuple[list[tuple[str, ...]], list[tuple[str, ...]]]:
    """The tree for `seed` and `files`: (folders, files) as relative path parts, in creation order.

    Pure: the same arguments give the same lists (with the same Python minor version).
    """
    if files < 1:
        raise ValueError("files must be at least 1")
    rng = random.Random(seed)

    root = Folder((), 0)
    folders = [root]
    parents = [root]  # the folders that may still hold a subfolder
    for _ in range(max(1, files // FILES_PER_FOLDER)):
        parent = rng.choice(parents)
        folder = Folder((*parent.rel, _unique(parent, _folder_name(rng), rng)), parent.depth + 1)
        folders.append(folder)
        if folder.depth < MAX_DEPTH:
            parents.append(folder)

    # What each file's name must contain: a rare name, a common word, or nothing.
    planted: list[str | None] = [None] * files
    order = list(range(files))
    rng.shuffle(order)
    at = 0
    for text, count in RARE.items():
        for _ in range(min(count, files - at)):
            planted[order[at]] = text
            at += 1
    for text, share in COMMON.items():
        for _ in range(min(round(share * files), files - at)):
            planted[order[at]] = text
            at += 1

    # Which folder each file goes in: the large folders take their share, the rest spread out.
    subfolders = folders[1:]
    large = rng.sample(subfolders, min(len(LARGE_FOLDERS), len(subfolders)))
    homes: list[Folder] = []
    for folder, share in zip(large, LARGE_FOLDERS):
        homes += [folder] * round(share * files)
    homes = homes[:files]
    homes += [rng.choice(folders) for _ in range(files - len(homes))]
    rng.shuffle(homes)

    for want, home in zip(planted, homes):
        stem = _stem(rng, want)
        home.files.append(_unique(home, stem + _extension(rng), rng))

    return [f.rel for f in subfolders], [(*f.rel, name) for f in folders for name in f.files]


def _folder_name(rng: random.Random) -> str:
    roll = rng.random()
    if roll < 0.45:
        name = rng.choice(FOLDER_EN)
    elif roll < 0.8:
        name = rng.choice(FOLDER_HE)
    else:
        name = f"{rng.choice(FOLDER_HE)} {rng.choice(FOLDER_EN)}"  # mixed direction
    if rng.random() < 0.5:
        name += f" {rng.randint(2009, 2026)}"
    return name


def _stem(rng: random.Random, want: str | None) -> str:
    """A file name without its extension: one to three filler words, `want` among them if given."""
    roll = rng.random()
    if roll < 0.45:
        pool = [FILLER_EN]
    elif roll < 0.75:
        pool = [FILLER_HE]
    else:
        pool = [FILLER_EN, FILLER_HE]  # mixed direction
    words = [rng.choice(rng.choice(pool)) for _ in range(rng.randint(1, 3))]
    if want is not None:
        words.insert(rng.randint(0, len(words)), _cased(rng, want))
    if rng.random() < 0.4:
        words.append(rng.choice([str(rng.randint(2009, 2026)), f"v{rng.randint(1, 9)}", f"({rng.randint(1, 9)})"]))
    sep = rng.choice([" ", " ", "_", "-"])
    return sep.join(words)


def _cased(rng: random.Random, word: str) -> str:
    """`word` as people write it: lower, Title or UPPER (Hebrew has no case)."""
    return rng.choice([word.lower(), word[:1].upper() + word[1:], word.upper()])


def _extension(rng: random.Random) -> str:
    return rng.choices(list(EXTENSIONS), weights=list(EXTENSIONS.values()))[0]


def _unique(folder: Folder, name: str, rng: random.Random) -> str:
    """`name`, or `name` with a number added, so no two items in `folder` share a name."""
    candidate = name
    while candidate.casefold() in folder.names:
        stem, dot, ext = name.rpartition(".") if "." in name else (name, "", "")
        candidate = f"{stem} {rng.randint(10, 9999)}{dot}{ext}"
    folder.names.add(candidate.casefold())
    return candidate


def build(root: Path, seed: int = DEFAULT_SEED, files: int = DEFAULT_FILES) -> tuple[int, int, int]:
    """Creates the tree under `root` (empty, or missing with an existing parent); returns
    (files, folders, largest folder)."""
    folders, names = plan(seed, files)
    root.mkdir(exist_ok=True)  # never its parents: nothing is written outside `root`
    for rel in folders:
        root.joinpath(*rel).mkdir()
    sizes: dict[tuple[str, ...], int] = {}
    for rel in names:
        with open(root.joinpath(*rel), "xb"):  # never overwrites
            pass
        sizes[rel[:-1]] = sizes.get(rel[:-1], 0) + 1
    return len(names), len(folders), max(sizes.values())


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="make_large_tree.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("folder", type=Path, help="an empty (or missing) folder to build the tree in")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help=f"default {DEFAULT_SEED}")
    parser.add_argument("--files", type=int, default=DEFAULT_FILES, help=f"default {DEFAULT_FILES}")
    args = parser.parse_args(argv[1:])
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    root: Path = args.folder
    if args.files < 1:
        print("--files must be at least 1", file=sys.stderr)
        return 2
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        print(f"refusing: {root} is not an empty folder; nothing was written", file=sys.stderr)
        return 2
    if not root.exists() and not root.parent.is_dir():
        print(f"refusing: the folder {root.parent} doesn't exist; nothing was written", file=sys.stderr)
        return 2
    files, folders, largest = build(root, args.seed, args.files)
    print(f"seed {args.seed}: {files} files in {folders} folders (largest folder: {largest} files) under {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
