"""WindowsFileSystem: FileSystemPort over os.scandir, FindFirstFileW and the Windows shell APIs.

Attributes come from directory enumeration only: on Windows, `DirEntry.stat(follow_symlinks=False)`
returns what FindFirstFile/FindNextFile already reported, so no file is opened and no OneDrive
placeholder is recalled (AD-8). `resolve` and `locate` read each segment's on-disk casing the same way,
and `stat` one item's entry. `read_head` is the only read of file content, for a preview thumbnail:
it checks the online-only attributes again first and never opens such a file.
"""

from __future__ import annotations

import ctypes
import logging
import ntpath
import os
import uuid
from collections.abc import Callable, Iterator
from ctypes import wintypes

from core.ports.filesystem import (
    FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT,
    ONLINE_ONLY_ATTRIBUTES,
    Drive,
    FsEntry,
    StoredOnline,
)
from core.rules.preview import READ_CHUNK_BYTES

log = logging.getLogger("fb2.fs")

FOLDERID_DOCUMENTS = uuid.UUID("{FDD39AD0-238F-46AF-ADB4-6C85480369C7}")
FOLDERID_DESKTOP = uuid.UUID("{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}")
FOLDERID_DOWNLOADS = uuid.UUID("{374DE290-123F-4565-9164-39C4925E467B}")

# Known-folder code (core.locations.KNOWN_FOLDER_CODES) -> its Known Folder ID.
KNOWN_FOLDER_IDS = {
    "documents": FOLDERID_DOCUMENTS,
    "desktop": FOLDERID_DESKTOP,
    "downloads": FOLDERID_DOWNLOADS,
}

DRIVE_REMOVABLE = 2
DRIVE_FIXED = 3

ERROR_FILE_NOT_FOUND = 2
ERROR_ACCESS_DENIED = 5

# Characters no Windows file name may hold; `*` and `?` would also turn FindFirstFileW into a search.
INVALID_NAME_CHARS = frozenset('<>:"/\\|?*') | frozenset(chr(c) for c in range(32))

_INVALID_HANDLE = wintypes.HANDLE(-1).value


class _GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]


def known_folder_path(folder_id: uuid.UUID) -> str:
    """SHGetKnownFolderPath: the folder's current path, following any redirection (e.g. OneDrive)."""
    shell32 = ctypes.WinDLL("shell32")
    ole32 = ctypes.WinDLL("ole32")
    get_path = shell32.SHGetKnownFolderPath
    get_path.argtypes = [ctypes.POINTER(_GUID), wintypes.DWORD, wintypes.HANDLE, ctypes.POINTER(ctypes.c_void_p)]
    get_path.restype = ctypes.HRESULT  # raises OSError on a failing HRESULT
    free = ole32.CoTaskMemFree
    free.argtypes = [ctypes.c_void_p]
    free.restype = None

    guid = _GUID.from_buffer_copy(folder_id.bytes_le)
    buffer = ctypes.c_void_p()
    try:
        get_path(ctypes.byref(guid), 0, None, ctypes.byref(buffer))
        return ctypes.wstring_at(buffer.value) if buffer.value else ""
    finally:
        free(buffer)


def _kernel32() -> ctypes.WinDLL:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.FindFirstFileW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.WIN32_FIND_DATAW)]
    kernel32.FindFirstFileW.restype = wintypes.HANDLE
    kernel32.FindClose.argtypes = [wintypes.HANDLE]
    kernel32.FindClose.restype = wintypes.BOOL
    kernel32.GetLogicalDrives.argtypes = []
    kernel32.GetLogicalDrives.restype = wintypes.DWORD
    kernel32.GetDriveTypeW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetDriveTypeW.restype = wintypes.UINT
    kernel32.GetVolumeInformationW.argtypes = [
        wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD), wintypes.LPWSTR, wintypes.DWORD,
    ]
    kernel32.GetVolumeInformationW.restype = wintypes.BOOL
    return kernel32


def _find(kernel32: ctypes.WinDLL, path: str) -> wintypes.WIN32_FIND_DATAW:
    """The directory entry for `path` as its parent's enumeration reports it (name, attributes)."""
    data = wintypes.WIN32_FIND_DATAW()
    handle = kernel32.FindFirstFileW(path, ctypes.byref(data))
    if handle is None or handle == _INVALID_HANDLE:
        raise ctypes.WinError(ctypes.get_last_error())
    kernel32.FindClose(handle)
    return data


# FILETIME counts 100 ns intervals since 1601-01-01; this many of them lie before the Unix epoch.
_FILETIME_UNIX_EPOCH = 116_444_736_000_000_000


def _entry(data: wintypes.WIN32_FIND_DATAW) -> FsEntry:
    """An FsEntry from FindFirstFileW's data, as enumeration would report it."""
    attributes = data.dwFileAttributes
    is_dir = bool(attributes & FILE_ATTRIBUTE_DIRECTORY)
    write_time = (data.ftLastWriteTime.dwHighDateTime << 32) | data.ftLastWriteTime.dwLowDateTime
    return FsEntry(
        name=data.cFileName,
        is_dir=is_dir,
        size=0 if is_dir else (data.nFileSizeHigh << 32) | data.nFileSizeLow,
        mtime_ns=(write_time - _FILETIME_UNIX_EPOCH) * 100 if write_time else None,
        attributes=attributes,
        # dwReserved0 holds the reparse tag, only when the entry is a reparse point.
        reparse_tag=data.dwReserved0 if attributes & FILE_ATTRIBUTE_REPARSE_POINT else 0,
    )


def _invalid_name(name: str) -> bool:
    return any(ch in INVALID_NAME_CHARS for ch in name)


def _split(path: str) -> tuple[str, list[str]]:
    """A typed path's root (`C:\\`, `\\\\server\\share\\`) and the names under it (AD-9): trimmed,
    surrounding quotes stripped, `.`/`..` and doubled separators collapsed, the drive letter
    upper-case. Raises FileNotFoundError for an empty, relative, device or invalid path."""
    text = path.strip()
    if len(text) >= 2 and text[0] == text[-1] == '"':
        text = text[1:-1].strip()
    # Relative paths would resolve against the engine's working folder, which means nothing
    # to the user. Device paths (\\?\, \\.\) are not something a user types either; they are
    # checked after normpath, which turns mixed separators (/\?\C:\) into one.
    if not text or not ntpath.isabs(text):
        raise FileNotFoundError(path)
    normalized = ntpath.normpath(text)
    if normalized.startswith(("\\\\?\\", "\\\\.\\")):
        raise FileNotFoundError(path)
    drive, _, tail = ntpath.splitroot(normalized)
    if len(drive) == 2 and drive[1] == ":":
        drive = drive.upper()
    names = [name for name in tail.split("\\") if name]
    if any(_invalid_name(name) for name in names):
        raise FileNotFoundError(path)
    return drive + "\\", names


class WindowsFileSystem:
    def __init__(self) -> None:
        self._kernel32 = _kernel32()

    def documents_folder(self) -> str:
        return known_folder_path(FOLDERID_DOCUMENTS)

    def known_folders(self) -> dict[str, str]:
        found: dict[str, str] = {}
        for code, folder_id in KNOWN_FOLDER_IDS.items():
            try:
                path = known_folder_path(folder_id)
            except OSError:
                log.info("known folder %s has no path", code)
                continue
            if path:
                found[code] = path
        return found

    def drives(self, letter: str | None = None) -> list[Drive]:
        mask = self._kernel32.GetLogicalDrives()
        found = []
        for i in range(26):
            drive_letter = chr(ord("A") + i)
            if not mask & (1 << i) or (letter is not None and drive_letter != letter.upper()):
                continue
            root = f"{drive_letter}:\\"
            if letter is None and self._kernel32.GetDriveTypeW(root) not in (DRIVE_FIXED, DRIVE_REMOVABLE):
                continue
            found.append(Drive(letter=drive_letter, label=self._volume_label(root), path=root))
        return found

    def _volume_label(self, root: str) -> str | None:
        """The volume label, or None when it has none or the drive isn't ready (an empty card reader)."""
        name = ctypes.create_unicode_buffer(261)
        if not self._kernel32.GetVolumeInformationW(root, name, len(name), None, None, None, None, 0):
            return None
        return name.value or None

    def resolve(self, path: str) -> str:
        resolved, attributes = self._walk(*_split(path))
        if not attributes & FILE_ATTRIBUTE_DIRECTORY:
            raise NotADirectoryError(path)
        return resolved

    def locate(self, path: str) -> tuple[str, str | None]:
        root, names = _split(path)
        if not names:
            raise FileNotFoundError(path)  # a drive or share root has no containing folder
        folder, attributes = self._walk(root, names[:-1])
        if not attributes & FILE_ATTRIBUTE_DIRECTORY:
            raise NotADirectoryError(path)
        try:
            data = _find(self._kernel32, ntpath.join(folder, names[-1]))
        except OSError as exc:
            winerror = getattr(exc, "winerror", None)
            if winerror == ERROR_FILE_NOT_FOUND:
                return folder, None
            if winerror == ERROR_ACCESS_DENIED:
                # Traverse rights only: the folder can't name its items, and listing it will say so.
                return folder, names[-1]
            raise
        return folder, data.cFileName

    def _walk(self, root: str, names: list[str]) -> tuple[str, int]:
        """The path below `root` in on-disk casing, and the attributes of its last segment.

        One FindFirstFileW per segment: the parent's enumeration names it in its on-disk casing.
        A file midway fails the next lookup (ERROR_DIRECTORY or ERROR_PATH_NOT_FOUND). A root is
        not looked up; listing it reports a missing or not-ready drive.
        A parent the user may pass through but not list (traverse rights only) can't name its
        child: keep the typed segment and its unknown attributes, and let list() decide.
        """
        resolved = root
        attributes = FILE_ATTRIBUTE_DIRECTORY
        for name in names:
            try:
                data = _find(self._kernel32, ntpath.join(resolved, name))
            except OSError as exc:
                if getattr(exc, "winerror", None) != ERROR_ACCESS_DENIED:
                    raise
                resolved = ntpath.join(resolved, name)
                attributes = FILE_ATTRIBUTE_DIRECTORY
                continue
            resolved = ntpath.join(resolved, data.cFileName)
            attributes = data.dwFileAttributes
        return resolved, attributes

    def list(self, path: str) -> Iterator[FsEntry]:
        # A relative path would resolve against the engine's working folder, which means nothing
        # to the user; treat it as a folder that doesn't exist.
        if not os.path.isabs(path):
            raise FileNotFoundError(path)
        with os.scandir(path) as entries:
            for entry in entries:
                try:
                    st = entry.stat(follow_symlinks=False)
                except OSError:
                    log.info("skipped an entry that vanished during listing")
                    continue
                attributes = getattr(st, "st_file_attributes", 0)
                yield FsEntry(
                    name=entry.name,
                    is_dir=bool(attributes & FILE_ATTRIBUTE_DIRECTORY),
                    size=st.st_size,
                    mtime_ns=st.st_mtime_ns,
                    attributes=attributes,
                    reparse_tag=getattr(st, "st_reparse_tag", 0),
                )

    def stat(self, path: str) -> FsEntry:
        return _entry(_find(self._kernel32, self._item_path(path)))

    def read_head(self, path: str, limit: int, check: Callable[[], None]) -> bytes:
        item = self._item_path(path)
        # Looked up again right before opening: a file can turn online-only after it was listed,
        # and opening one would make OneDrive download it.
        entry = _entry(_find(self._kernel32, item))
        if entry.attributes & ONLINE_ONLY_ATTRIBUTES:
            raise StoredOnline(path)
        if entry.is_dir:
            raise IsADirectoryError(path)
        chunks: list[bytes] = []
        remaining = limit
        with open(item, "rb", buffering=0) as file:  # read-only; closed on any exception
            while remaining > 0:
                check()
                chunk = file.read(min(READ_CHUNK_BYTES, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
        return b"".join(chunks)

    @staticmethod
    def _item_path(path: str) -> str:
        """`path` normalized as `resolve` normalizes it, naming an item below a root."""
        root, names = _split(path)
        if not names:
            raise FileNotFoundError(path)
        return ntpath.join(root, *names)

    def create_file(self, path: str) -> None:
        if not os.path.isabs(path):
            raise FileNotFoundError(path)
        # O_EXCL is CreateFileW's CREATE_NEW: the OS creates the file only if nothing has that name,
        # in one step, so nothing is ever overwritten. No mode bits: the folder's ACL decides.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOINHERIT", 0)
        try:
            fd = os.open(path, flags)
        except PermissionError:
            # CREATE_NEW over an existing folder (or a read-only file) fails as access denied.
            if os.path.lexists(path):
                raise FileExistsError(path) from None
            raise
        os.close(fd)

    def rename_file(self, path: str, new_path: str) -> None:
        if not (os.path.isabs(path) and os.path.isabs(new_path)):
            raise FileNotFoundError(path)
        if os.path.isdir(path):
            raise IsADirectoryError(path)
        # os.rename is MoveFileExW without MOVEFILE_REPLACE_EXISTING: the OS refuses, in one step,
        # when anything already has the new name, so nothing is ever overwritten. A new name that
        # differs only in casing names this same file, which the OS renames in place.
        same_file = path.casefold() == new_path.casefold()
        try:
            os.rename(path, new_path)
        except PermissionError:
            # A file renamed onto an existing folder's name fails as access denied.
            if not same_file and os.path.lexists(new_path):
                raise FileExistsError(new_path) from None
            raise
