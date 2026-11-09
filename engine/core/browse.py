"""list_folder(): one folder's candidate entries as protocol data (codes, never words).

The path rules live here too (AD-9): the port resolves the incoming path, and the core derives the
folder's parent and its breadcrumb segments from the resolved string. The core never touches the
file system itself, so it works on the string: `\\` separates segments, and comparisons casefold.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from core.cancel import CancelToken
from core.candidates import is_candidate
from core.locations import KNOWN_FOLDER_CODES
from core.ports.filesystem import FileSystemPort, FsEntry
from core.rules.file_types import file_type_code

# How many enumerated entries pass between cancel checks.
CANCEL_CHECK_EVERY = 200

SEP = "\\"


class FolderUnreadable(Exception):
    """A folder that exists but can't be listed: the OS error, and where the folder is
    (`{path, parent, segments}`), so the UI can still go Up or to an ancestor from it."""

    def __init__(self, error: OSError, place: dict[str, Any]) -> None:
        super().__init__(str(error))
        self.error = error
        self.place = place


def list_folder(fs: FileSystemPort, path: str | None, token: CancelToken) -> dict[str, Any]:
    """`{path, parent, segments, entries}` for `path`, or for Documents when it is None. Unsorted.

    `path` is the resolved (normalized, on-disk casing) path. Raises Cancelled when `token` is
    cancelled. A path that doesn't resolve lets the port's FileNotFoundError, NotADirectoryError,
    PermissionError or other OSError through; a resolved folder that can't be listed raises
    FolderUnreadable with that error and the folder's place.
    """
    token.raise_if_cancelled()
    folder = fs.resolve(fs.documents_folder() if path is None else path)
    place = place_of(fs, folder)
    entries: list[dict[str, Any]] = []
    try:
        for count, entry in enumerate(fs.list(folder), start=1):
            if count % CANCEL_CHECK_EVERY == 0:
                token.raise_if_cancelled()
            if is_candidate(entry):
                entries.append(_listed(entry))
    except OSError as exc:
        raise FolderUnreadable(exc, place) from exc
    token.raise_if_cancelled()
    return {**place, "entries": entries}


def place_of(fs: FileSystemPort, folder: str) -> dict[str, Any]:
    """`{path, parent, segments}` for a resolved folder."""
    return {"path": folder, "parent": parent_of(folder), "segments": segments_of(fs, folder)}


def split_path(path: str) -> tuple[str, list[str]]:
    """A resolved path's root (`C:\\`, `\\\\server\\share\\`) and the folder names under it."""
    if path.startswith(SEP * 2):
        server, share, *rest = [*path[2:].split(SEP), ""]
        root = SEP * 2 + server + SEP + share + SEP
    else:
        drive, *rest = path.split(SEP)
        root = drive + SEP
    return root, [name for name in rest if name]


def join_path(root: str, names: list[str]) -> str:
    return root + SEP.join(names)


def parent_of(path: str) -> str | None:
    """The folder that contains `path`; None at a drive or share root."""
    root, names = split_path(path)
    return join_path(root, names[:-1]) if names else None


def segments_of(fs: FileSystemPort, path: str) -> list[dict[str, Any]]:
    """Breadcrumb segments for a resolved path, in path order.

    The first segment is the deepest known folder (Documents, Desktop, Downloads) that contains
    the path, else its drive or share root; each folder below it follows.
    """
    root, names = split_path(path)
    anchor = _deepest_known_folder(fs.known_folders(), root, names)
    if anchor is not None:
        code, depth = anchor
        first: dict[str, Any] = {"kind": "knownFolder", "code": code, "path": join_path(root, names[:depth])}
    elif root.startswith(SEP * 2):
        depth = 0
        first = {"kind": "folder", "name": root.rstrip(SEP), "path": root}
    else:
        depth = 0
        letter = root[0]
        drives = fs.drives(letter)
        label = drives[0].label if drives else None
        first = {"kind": "drive", "letter": letter, "label": label, "path": root}
    rest = [
        {"kind": "folder", "name": names[i], "path": join_path(root, names[: i + 1])}
        for i in range(depth, len(names))
    ]
    return [first, *rest]


def _deepest_known_folder(known: dict[str, str], root: str, names: list[str]) -> tuple[str, int] | None:
    """(code, depth in names) of the deepest known folder containing the path; ties go by code order."""
    best: tuple[str, int] | None = None
    for code in KNOWN_FOLDER_CODES:
        if code not in known:
            continue
        known_root, known_names = split_path(known[code])
        if not known_names or known_root.casefold() != root.casefold() or len(known_names) > len(names):
            continue
        if all(a.casefold() == b.casefold() for a, b in zip(known_names, names)):
            if best is None or len(known_names) > best[1]:
                best = (code, len(known_names))
    return best


def _listed(entry: FsEntry) -> dict[str, Any]:
    modified = _iso_local(entry.mtime_ns)
    if entry.is_dir:
        return {"name": entry.name, "kind": "folder", "modified": modified}
    return {
        "name": entry.name,
        "kind": "file",
        "typeCode": file_type_code(entry.name),
        "size": max(entry.size, 0),
        "modified": modified,
    }


def _iso_local(mtime_ns: int | None) -> str | None:
    """ISO 8601 in local time with its offset, to the second; None when unknown or out of range."""
    if mtime_ns is None:
        return None
    try:
        return datetime.fromtimestamp(mtime_ns / 1e9).astimezone().isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None
