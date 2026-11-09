"""list_folder(): one folder's candidate entries as protocol data (codes, never words)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from core.cancel import CancelToken
from core.candidates import is_candidate
from core.ports.filesystem import FileSystemPort, FsEntry
from core.rules.file_types import file_type_code

# How many enumerated entries pass between cancel checks.
CANCEL_CHECK_EVERY = 200


def list_folder(fs: FileSystemPort, path: str | None, token: CancelToken) -> dict[str, Any]:
    """`{path, entries}` for `path`, or for Documents when it is None. Unsorted.

    Raises Cancelled when `token` is cancelled, and lets the port's FileNotFoundError,
    NotADirectoryError and PermissionError through.
    """
    token.raise_if_cancelled()
    folder = fs.documents_folder() if path is None else path
    entries: list[dict[str, Any]] = []
    for count, entry in enumerate(fs.list(folder), start=1):
        if count % CANCEL_CHECK_EVERY == 0:
            token.raise_if_cancelled()
        if is_candidate(entry):
            entries.append(_listed(entry))
    token.raise_if_cancelled()
    return {"path": folder, "entries": entries}


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
