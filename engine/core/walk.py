"""walk(): the one folder walker (AD-4, AD-8), built only on the port's `list()`.

Depth-first. It descends only into candidate folders (`is_candidate`, so never through a junction
or symlink, which can loop) that are not online-only (`FILE_ATTRIBUTE_RECALL_ON_OPEN`: listing one
would make OneDrive fetch it). Every candidate entry is still yielded, online-only files and
folders included, so they stay findable by name; the walker never opens a file.

`root` is taken as given: it must already be resolved (as `list_folder` resolves its path). A
folder below the root that can't be read is reported with its error and skipped, and the walk goes
on. A root that can't be listed raises the port's own OSError (not `FolderUnreadable`). The cancel
token is checked before each directory and every `CANCEL_CHECK_EVERY` entries within one (AD-10).
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from core.browse import CANCEL_CHECK_EVERY, join_path, split_path
from core.cancel import CancelToken
from core.candidates import is_candidate
from core.ports.filesystem import FILE_ATTRIBUTE_RECALL_ON_OPEN, FileSystemPort, FsEntry


@dataclass(frozen=True)
class Walked:
    """One folder of a walk: its candidate entries, or the error that kept it from being read."""

    folder: str
    """The folder's path: the root as given, then each child joined below it."""
    entries: list[FsEntry] | None
    """The folder's candidate entries, in enumeration order; None when it couldn't be read."""
    error: OSError | None
    """Why the folder couldn't be read; None when it was."""


def walk(fs: FileSystemPort, root: str, token: CancelToken) -> Iterator[Walked]:
    """Each folder under `root` (a resolved folder path), root first, depth-first in entry order.

    Raises Cancelled once `token` is cancelled (before the next directory, or within a large one),
    and the port's OSError when `root` itself can't be listed.
    """
    token.raise_if_cancelled()
    entries = _candidates(fs, root, token)
    yield Walked(root, entries, None)
    # A stack of folders still to read, the next one last.
    pending = _subfolders(root, entries)
    while pending:
        token.raise_if_cancelled()
        folder = pending.pop()
        try:
            entries = _candidates(fs, folder, token)
        except OSError as exc:
            yield Walked(folder, None, exc)
            continue
        yield Walked(folder, entries, None)
        pending.extend(_subfolders(folder, entries))


def child_path(folder: str, name: str) -> str:
    """`name` inside the resolved `folder` (a root keeps its single separator)."""
    root, names = split_path(folder)
    return join_path(root, [*names, name])


def _candidates(fs: FileSystemPort, folder: str, token: CancelToken) -> list[FsEntry]:
    """The folder's candidate entries, read in full: a folder failing midway counts as unreadable.
    Checks `token` every CANCEL_CHECK_EVERY entries, so one huge folder doesn't hold up a cancel."""
    entries: list[FsEntry] = []
    for count, entry in enumerate(fs.list(folder), start=1):
        if count % CANCEL_CHECK_EVERY == 0:
            token.raise_if_cancelled()
        if is_candidate(entry):
            entries.append(entry)
    return entries


def _subfolders(folder: str, entries: list[FsEntry]) -> list[str]:
    """The paths to descend into, in reverse entry order (so popping them goes in entry order)."""
    return [
        child_path(folder, entry.name)
        for entry in reversed(entries)
        if entry.is_dir and not entry.attributes & FILE_ATTRIBUTE_RECALL_ON_OPEN
    ]
