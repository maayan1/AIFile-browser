"""name_search(): files and folders whose name contains the search text, below one folder (AD-15).

Walks the folder with the one walker (`core.walk.walk`), so `is_candidate()` and the
RECALL_ON_OPEN rule apply, and never opens a file. The root itself is never a match. A subfolder
that can't be read is skipped (its notice arrives in Story 2.3); a root that can't be resolved or
listed raises the port's OSError before anything is sent.

The replies go out through `emit`, in a fixed order: `searchParsed`, then one or more
`nameMatches` batches (the last may be empty), and the caller sends the terminal `searchDone` this
returns. A batch goes out once it holds BATCH_SIZE matches, or after a folder once FLUSH_AFTER
seconds have passed since the last one went out, so results arrive while a long walk goes on.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from itertools import chain
from typing import Any

from core.browse import listed_entry
from core.cancel import CancelToken
from core.ports.filesystem import FileSystemPort, FsEntry
from core.search.query import Query, matches, normalize
from core.walk import child_path, walk

BATCH_SIZE = 200
FLUSH_AFTER = 0.25  # seconds

Emit = Callable[[dict[str, Any]], None]


def name_search(
    fs: FileSystemPort,
    folder: str,
    query: Query,
    token: CancelToken,
    emit: Emit,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Emit `searchParsed` and the `nameMatches` batches for `query` under `folder`; return the
    `searchDone` fields (without an id).

    Raises Cancelled once `token` is cancelled (or `emit` raises it), and the port's OSError when
    `folder` can't be resolved or listed. Whitespace-only text walks nothing and matches nothing.
    """
    token.raise_if_cancelled()
    needle = normalize(query.residual_text)
    if not needle:
        emit({"type": "searchParsed", **query.parsed()})
        emit(_batch([]))
        return _done()

    root = fs.resolve(folder)
    walker = walk(fs, root, token)
    first = next(walker)  # lists the root: an unreadable root raises before anything is sent
    emit({"type": "searchParsed", **query.parsed()})

    pending: list[dict[str, Any]] = []
    sent = 0
    last_flush = clock()

    def flush() -> None:
        nonlocal pending, sent, last_flush
        emit(_batch(pending))
        pending = []
        sent += 1
        last_flush = clock()

    for walked in chain([first], walker):
        for entry in walked.entries or ():  # an unreadable subfolder has none: it is skipped
            if matches(entry.name, needle):
                pending.append(_match(walked.folder, entry))
                if len(pending) >= BATCH_SIZE:
                    flush()
        # After every folder, readable or not, so a run of unreadable ones doesn't hold matches back.
        if pending and clock() - last_flush >= FLUSH_AFTER:
            flush()

    if pending or sent == 0:
        flush()
    return _done()


def _match(folder: str, entry: FsEntry) -> dict[str, Any]:
    """One match, in the folderListing entry vocabulary, with its full path and its folder."""
    fields = listed_entry(entry)
    fields.pop("size", None)
    return {**fields, "path": child_path(folder, entry.name), "folder": folder}


def _batch(matches: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "nameMatches", "matches": matches}


def _done() -> dict[str, Any]:
    # outcomeCode arrives with Story 2.2, and the notices with Story 2.3.
    return {"type": "searchDone", "notices": [], "indexVersion": None, "indexingActive": False}
