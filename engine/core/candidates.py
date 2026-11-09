"""is_candidate(): the one rule for which entries the app shows and reads (AD-8).

Skips hidden and system items, Office lock files (`~$name`) and name-surrogate reparse points
(directory junctions and symlinks, which can loop), and names the protocol can't carry as UTF-8.
OneDrive placeholders are ordinary
candidates: their reparse tag is not a name surrogate.
"""

from __future__ import annotations

from core.ports.filesystem import (
    FILE_ATTRIBUTE_HIDDEN,
    FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_SYSTEM,
    REPARSE_TAG_NAME_SURROGATE_BIT,
    FsEntry,
)

LOCK_FILE_PREFIX = "~$"


def is_candidate(entry: FsEntry) -> bool:
    if not _encodable(entry.name):
        return False
    if entry.attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM):
        return False
    if entry.name.startswith(LOCK_FILE_PREFIX):
        return False
    if entry.attributes & FILE_ATTRIBUTE_REPARSE_POINT and entry.reparse_tag & REPARSE_TAG_NAME_SURROGATE_BIT:
        return False
    return True


def _encodable(name: str) -> bool:
    """False for a name with an unpaired UTF-16 surrogate (NTFS allows it; UTF-8 can't carry it)."""
    try:
        name.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True
