"""rename_file(): give one existing file a new name in its own folder (the renameFile request).

The second write the engine makes to the user's files, kept as narrow as Create File: one file
(never a folder), a new name that is one name (never a path), the same folder (a rename never
moves anything), and never over anything already there. The port renames atomically (MoveFileEx
without replace), so an item that appears between the check and the rename is still never
overwritten. The file's content, timestamps and permissions don't change.

A name that differs only in casing renames the file in place (NTFS sees one file); the very same
name changes nothing and succeeds, without touching the disk.

The core never touches the file system itself: the port finds the file and renames it, and every
failure leaves here as a protocol code (RenameRefused).
"""

from __future__ import annotations

from typing import Any

from core.browse import parent_of, split_path
from core.cancel import CancelToken
from core.create import EXISTS_WINERRORS, FILE_EXISTS, INVALID_NAME, INVALID_NAME_WINERRORS, child_of, name_is_valid
from core.errors import ACCESS_DENIED, FOLDER_NOT_FOUND, folder_error_code
from core.ports.filesystem import FileSystemPort

FILE_NOT_FOUND = "fileNotFound"
FILE_IN_USE = "fileInUse"

# Another program holds the file without sharing delete access (32), or has locked a range (33).
IN_USE_WINERRORS = frozenset({32, 33})


class RenameRefused(Exception):
    """The file wasn't renamed; `code` says why, as protocol/codes.json words it."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def source_error_code(exc: OSError) -> str:
    """Why the file to rename can't be found: its folder's error, where a missing one means the file is gone."""
    code = folder_error_code(exc)
    return FILE_NOT_FOUND if code == FOLDER_NOT_FOUND else code


def rename_error_code(exc: OSError) -> str:
    """The protocol code for why the port couldn't rename a file that was found."""
    winerror = getattr(exc, "winerror", None)
    if isinstance(exc, FileExistsError) or winerror in EXISTS_WINERRORS:
        return FILE_EXISTS
    if winerror in IN_USE_WINERRORS:
        return FILE_IN_USE
    if winerror in INVALID_NAME_WINERRORS:
        return INVALID_NAME
    if isinstance(exc, IsADirectoryError):
        return FILE_NOT_FOUND  # it became a folder since it was found: never rename one
    if isinstance(exc, PermissionError) and winerror is None:
        return ACCESS_DENIED
    return source_error_code(exc)


def rename_file(fs: FileSystemPort, path: str, new_name: str, token: CancelToken) -> dict[str, Any]:
    """`{oldPath, path, name}` once the file at `path` is named `new_name`, in the same folder.

    Raises RenameRefused with invalidName, fileExists, fileNotFound, fileInUse or the folder's
    error code, and Cancelled when `token` is cancelled before the rename.
    """
    token.raise_if_cancelled()
    if not name_is_valid(new_name):
        raise RenameRefused(INVALID_NAME)
    try:
        folder, name = fs.locate(path)
        # Only a file: the listing says what the item is (and fails as the folder would).
        entry = None if name is None else next((e for e in fs.list(folder) if e.name == name), None)
    except OSError as exc:
        raise RenameRefused(source_error_code(exc)) from exc
    if entry is None or entry.is_dir or name is None:
        raise RenameRefused(FILE_NOT_FOUND)
    old_path = child_of(folder, name)
    new_path = child_of(folder, new_name)
    # The new name is one segment, so the file stays in its folder. Checked on the joined string
    # anyway: a rename must never move a file anywhere else.
    if parent_of(new_path) != folder or split_path(new_path)[1][-1:] != [new_name]:
        raise RenameRefused(INVALID_NAME)
    renamed = {"oldPath": old_path, "path": new_path, "name": new_name}
    if new_name == name:
        return renamed  # already its name: nothing to change
    token.raise_if_cancelled()
    try:
        fs.rename_file(old_path, new_path)
    except OSError as exc:
        raise RenameRefused(rename_error_code(exc)) from exc
    return renamed
