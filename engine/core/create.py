"""create_file(): one new, empty file directly in a listed folder (the createFile request).

The only place the engine writes to the user's files, kept as narrow as a write can be: one empty
file, in a folder that already exists, under a name that is one name (never a path), and never over
anything already there. The port creates it atomically (create-new), so a file that appears between
the check and the write is still never overwritten. No folder is ever created, and the new file gets
whatever permissions its folder gives new files.

The core never touches the file system itself: the port resolves the folder and creates the file,
and every failure leaves here as a protocol code (CreateRefused).
"""

from __future__ import annotations

from typing import Any

from core.browse import SEP, parent_of, split_path
from core.cancel import CancelToken
from core.errors import ACCESS_DENIED, folder_error_code
from core.ports.filesystem import FileSystemPort

INVALID_NAME = "invalidName"
FILE_EXISTS = "fileExists"

# NTFS allows 255 UTF-16 code units per name.
MAX_NAME_LENGTH = 255

# Characters no Windows file name may hold: the path separators, the drive and stream colon, the
# wildcards, the redirection characters, and the control characters.
INVALID_NAME_CHARS = frozenset('<>:"/\\|?*') | frozenset(chr(c) for c in range(32))

# Device names Windows reserves, with or without an extension ("CON", "con.txt"). Recent Windows
# builds will create some of them as plain files, but other programs still treat them as devices.
RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"{device}{n}" for device in ("COM", "LPT") for n in [*"123456789", "¹", "²", "³"]}
)

# Windows error codes for a name the OS itself refuses: a bad name (123) or one too long (206).
INVALID_NAME_WINERRORS = frozenset({123, 206})
# The file exists (80) or already exists (183).
EXISTS_WINERRORS = frozenset({80, 183})


class CreateRefused(Exception):
    """The file wasn't created; `code` says why, as protocol/codes.json words it."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def name_is_valid(name: str) -> bool:
    """Whether `name` is one Windows file name the app may create (see createFile.schema.json)."""
    if not name or name in (".", "..") or len(name) > MAX_NAME_LENGTH:
        return False
    if any(ch in INVALID_NAME_CHARS for ch in name):
        return False
    # Windows silently drops a trailing dot or space, so the file would get another name.
    if name[-1] in ". ":
        return False
    stem = name.split(".", 1)[0].rstrip(" ")
    return stem.upper() not in RESERVED_NAMES


def create_error_code(exc: OSError) -> str:
    """The protocol code for why the port couldn't create the file in a folder that resolved."""
    winerror = getattr(exc, "winerror", None)
    if isinstance(exc, FileExistsError) or winerror in EXISTS_WINERRORS:
        return FILE_EXISTS
    if winerror in INVALID_NAME_WINERRORS:
        return INVALID_NAME
    if isinstance(exc, PermissionError) and winerror is None:
        return ACCESS_DENIED
    return folder_error_code(exc)


def child_of(folder: str, name: str) -> str:
    """`name` in the resolved `folder`."""
    return folder + name if folder.endswith(SEP) else folder + SEP + name


def create_file(fs: FileSystemPort, folder: str, name: str, token: CancelToken) -> dict[str, Any]:
    """`{path, name}` of the new, empty file `name` in `folder`.

    Raises CreateRefused with invalidName, fileExists or the folder's error code, and Cancelled
    when `token` is cancelled before the file is created.
    """
    token.raise_if_cancelled()
    if not name_is_valid(name):
        raise CreateRefused(INVALID_NAME)
    try:
        resolved = fs.resolve(folder)
    except OSError as exc:
        raise CreateRefused(folder_error_code(exc)) from exc
    path = child_of(resolved, name)
    # The name is one segment, so the file lands directly in the resolved folder. Checked on the
    # joined string anyway: nothing may ever be created outside the folder the user is in.
    if parent_of(path) != resolved or split_path(path)[1][-1:] != [name]:
        raise CreateRefused(INVALID_NAME)
    token.raise_if_cancelled()
    try:
        fs.create_file(path)
    except OSError as exc:
        raise CreateRefused(create_error_code(exc)) from exc
    return {"path": path, "name": name}
