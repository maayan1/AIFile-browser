"""WindowsFileSystem: FileSystemPort over os.scandir and the Windows Known Folder API.

Attributes come from directory enumeration only: on Windows, `DirEntry.stat(follow_symlinks=False)`
returns what FindFirstFile/FindNextFile already reported, so no file is opened and no OneDrive
placeholder is recalled (AD-8).
"""

from __future__ import annotations

import ctypes
import logging
import os
import uuid
from collections.abc import Iterator
from ctypes import wintypes

from core.ports.filesystem import FILE_ATTRIBUTE_DIRECTORY, FsEntry

log = logging.getLogger("fb2.fs")

FOLDERID_DOCUMENTS = uuid.UUID("{FDD39AD0-238F-46AF-ADB4-6C85480369C7}")


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


class WindowsFileSystem:
    def documents_folder(self) -> str:
        return known_folder_path(FOLDERID_DOCUMENTS)

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
