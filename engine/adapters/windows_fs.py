"""WindowsFileSystem: FileSystemPort over os.scandir, FindFirstFileW and the Windows shell APIs.

Attributes come from directory enumeration only: on Windows, `DirEntry.stat(follow_symlinks=False)`
returns what FindFirstFile/FindNextFile already reported, so no file is opened and no OneDrive
placeholder is recalled (AD-8). `resolve` reads each segment's on-disk casing the same way.
"""

from __future__ import annotations

import ctypes
import logging
import ntpath
import os
import uuid
from collections.abc import Iterator
from ctypes import wintypes

from core.ports.filesystem import FILE_ATTRIBUTE_DIRECTORY, Drive, FsEntry

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


def _invalid_name(name: str) -> bool:
    return any(ch in INVALID_NAME_CHARS for ch in name)


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
        root = drive + "\\"
        names = [name for name in tail.split("\\") if name]
        if any(_invalid_name(name) for name in names):
            raise FileNotFoundError(path)

        # One FindFirstFileW per segment: the parent's enumeration names it in its on-disk casing.
        # A file midway fails the next lookup (ERROR_DIRECTORY or ERROR_PATH_NOT_FOUND). A root is
        # not looked up; listing it reports a missing or not-ready drive.
        # A parent the user may pass through but not list (traverse rights only) can't name its
        # child: keep the typed segment and its unknown attributes, and let list() decide.
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
        if not attributes & FILE_ATTRIBUTE_DIRECTORY:
            raise NotADirectoryError(path)
        return resolved

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
