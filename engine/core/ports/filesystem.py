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


class FileSystemPort(Protocol):
    def documents_folder(self) -> str:
        """The user's Documents folder (the Known Folder, wherever it is redirected)."""
        ...

    def list(self, path: str) -> Iterable[FsEntry]:
        """The entries of one folder, in no particular order, read lazily.

        Raises FileNotFoundError or NotADirectoryError when the folder is missing, and
        PermissionError when it can't be read.
        """
        ...
