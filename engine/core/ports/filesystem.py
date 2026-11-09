"""FileSystemPort: the core's only way to see files (AD-1, AD-8).

Entries come from directory enumeration alone; an adapter never opens a file to fill them in.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

# Windows file attribute bits (FILE_ATTRIBUTE_*), as enumeration reports them.
FILE_ATTRIBUTE_HIDDEN = 0x2
FILE_ATTRIBUTE_SYSTEM = 0x4
FILE_ATTRIBUTE_DIRECTORY = 0x10
FILE_ATTRIBUTE_ARCHIVE = 0x20
FILE_ATTRIBUTE_NORMAL = 0x80
FILE_ATTRIBUTE_REPARSE_POINT = 0x400
FILE_ATTRIBUTE_OFFLINE = 0x1000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000

# Reparse tags (IO_REPARSE_TAG_*). Bit 29 marks a name surrogate: the entry stands for another
# name in the namespace (junctions, symlinks), so following it can loop.
REPARSE_TAG_NAME_SURROGATE_BIT = 0x20000000
IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003  # directory junction
IO_REPARSE_TAG_SYMLINK = 0xA000000C
IO_REPARSE_TAG_CLOUD_6 = 0x9000601A  # OneDrive placeholder: not a name surrogate


@dataclass(frozen=True)
class FsEntry:
    """One directory entry as enumeration reports it."""

    name: str
    is_dir: bool
    size: int
    """Bytes; 0 for folders."""
    mtime_ns: int | None
    """Last-write time in nanoseconds since the Unix epoch; None when unknown."""
    attributes: int
    """FILE_ATTRIBUTE_* bits."""
    reparse_tag: int
    """IO_REPARSE_TAG_* when the entry is a reparse point, else 0."""


@dataclass(frozen=True)
class Drive:
    """One drive under This PC."""

    letter: str
    """The upper-case drive letter, without the colon ("C")."""
    label: str | None
    """The volume label; None when it has none or the drive isn't ready."""
    path: str
    """The drive's root, with its backslash."""


class FileSystemPort(Protocol):
    def documents_folder(self) -> str:
        """The user's Documents folder (the Known Folder, wherever it is redirected)."""
        ...

    def known_folders(self) -> dict[str, str]:
        """Known-folder code ("documents", "desktop", "downloads") -> its current path, as the OS
        reports it. A folder the OS can't name is left out; one that doesn't exist may be listed."""
        ...

    def drives(self, letter: str | None = None) -> list[Drive]:
        """The fixed and removable drives, in letter order. With `letter`, only that drive,
        whatever its type, or [] when there is none. Reading a label can block on a removable drive."""
        ...

    def resolve(self, path: str) -> str:
        """The normalized absolute path of an existing folder (AD-9): trimmed, surrounding quotes
        stripped, `.`/`..` and doubled separators collapsed, the drive letter upper-case, each
        segment in its on-disk casing, and a trailing backslash only on a root. A segment whose
        parent can't be listed (traverse rights only) keeps its typed casing.

        Raises FileNotFoundError for an empty, relative or invalid path or a missing folder,
        NotADirectoryError for a file, PermissionError, or another OSError (drive not ready, share
        unreachable).
        """
        ...

    def list(self, path: str) -> Iterable[FsEntry]:
        """The entries of one folder, in no particular order, read lazily.

        Raises FileNotFoundError or NotADirectoryError when the folder is missing, and
        PermissionError when it can't be read.
        """
        ...
