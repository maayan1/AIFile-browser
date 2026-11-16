"""folder_error_code(): why a folder can't be read, as a protocol code (protocol/codes.json).

Browsing replies with the code as its error; name search uses it to tell a subfolder skipped for
permission (`permissionSkipped`) from one skipped for any other reason.
"""

from __future__ import annotations

FOLDER_NOT_FOUND = "folderNotFound"
ACCESS_DENIED = "accessDenied"
FOLDER_UNAVAILABLE = "folderUnavailable"

# Windows error codes that mean the folder isn't there: file or path not found, no such drive,
# a bad name (123: the filename syntax is incorrect), a bad path name, or not a folder (267).
# Python maps some other codes misleadingly (ERROR_NOT_READY to PermissionError, an unreachable
# share to FileNotFoundError), so the winerror decides when there is one.
NOT_FOUND_WINERRORS = frozenset({2, 3, 15, 123, 161, 267})
DENIED_WINERRORS = frozenset({5, 65})  # access denied, network access denied


def folder_error_code(exc: OSError) -> str:
    """The protocol code for why a folder can't be listed."""
    winerror = getattr(exc, "winerror", None)
    if winerror is not None:
        if winerror in NOT_FOUND_WINERRORS:
            return FOLDER_NOT_FOUND
        return ACCESS_DENIED if winerror in DENIED_WINERRORS else FOLDER_UNAVAILABLE
    if isinstance(exc, PermissionError):
        return ACCESS_DENIED
    if isinstance(exc, (FileNotFoundError, NotADirectoryError)):
        return FOLDER_NOT_FOUND
    return FOLDER_UNAVAILABLE
