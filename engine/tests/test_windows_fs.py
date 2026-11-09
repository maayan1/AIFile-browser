"""WindowsFileSystem on a real temp folder: attributes from enumeration, junctions, Hebrew names."""

from __future__ import annotations

import ctypes
import os
import subprocess
from pathlib import Path

import pytest

from adapters.windows_fs import WindowsFileSystem
from core.browse import list_folder
from core.cancel import CancelToken
from core.ports.filesystem import (
    FILE_ATTRIBUTE_HIDDEN,
    FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_SYSTEM,
    IO_REPARSE_TAG_MOUNT_POINT,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows file system")

HEBREW_DOC = "סיכום ישיבה 3.docx"
MIXED_PDF = "Budget תקציב.pdf"


def set_attributes(path: Path, attributes: int) -> None:
    set_file_attributes = ctypes.WinDLL("kernel32", use_last_error=True).SetFileAttributesW
    set_file_attributes.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32]
    set_file_attributes.restype = ctypes.c_int
    if not set_file_attributes(str(path), attributes):
        raise ctypes.WinError(ctypes.get_last_error())


def make_junction(link: Path, target: Path) -> None:
    subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    root = tmp_path / "Volunteering"
    root.mkdir()
    (root / "normal.txt").write_bytes(b"x" * 1234)
    (root / HEBREW_DOC).write_bytes(b"doc")
    (root / MIXED_PDF).write_bytes(b"")
    (root / "Photos").mkdir()
    (root / "hidden.txt").write_bytes(b"")
    set_attributes(root / "hidden.txt", FILE_ATTRIBUTE_HIDDEN)
    (root / "system.dat").write_bytes(b"")
    set_attributes(root / "system.dat", FILE_ATTRIBUTE_SYSTEM)
    (root / "~$x.docx").write_bytes(b"")
    target = tmp_path / "elsewhere"
    target.mkdir()
    make_junction(root / "junction", target)
    return root


def test_enumeration_reports_attributes_and_reparse_tags(folder: Path) -> None:
    entries = {e.name: e for e in WindowsFileSystem().list(str(folder))}
    assert set(entries) == {
        "normal.txt", HEBREW_DOC, MIXED_PDF, "Photos", "hidden.txt", "system.dat", "~$x.docx", "junction",
    }
    assert entries["normal.txt"].size == 1234 and not entries["normal.txt"].is_dir
    assert entries["Photos"].is_dir
    assert entries["hidden.txt"].attributes & FILE_ATTRIBUTE_HIDDEN
    assert entries["system.dat"].attributes & FILE_ATTRIBUTE_SYSTEM
    junction = entries["junction"]
    assert junction.attributes & FILE_ATTRIBUTE_REPARSE_POINT
    assert junction.reparse_tag == IO_REPARSE_TAG_MOUNT_POINT
    assert entries["normal.txt"].mtime_ns == (folder / "normal.txt").stat().st_mtime_ns


def test_list_folder_keeps_only_candidates_with_hebrew_names_intact(folder: Path) -> None:
    listing = list_folder(WindowsFileSystem(), str(folder), CancelToken())
    assert listing["path"] == str(folder)
    by_name = {e["name"]: e for e in listing["entries"]}
    assert set(by_name) == {"normal.txt", HEBREW_DOC, MIXED_PDF, "Photos"}
    assert by_name[HEBREW_DOC]["typeCode"] == "word"
    assert by_name[MIXED_PDF] | {"modified": None} == {
        "name": MIXED_PDF, "kind": "file", "typeCode": "pdf", "size": 0, "modified": None,
    }
    assert by_name["Photos"]["kind"] == "folder"


def test_missing_folder_and_file_path_raise(tmp_path: Path) -> None:
    fs = WindowsFileSystem()
    with pytest.raises(FileNotFoundError):
        list(fs.list(str(tmp_path / "gone")))
    (tmp_path / "a.txt").write_bytes(b"")
    with pytest.raises(NotADirectoryError):
        list(fs.list(str(tmp_path / "a.txt")))
    with pytest.raises(FileNotFoundError):
        list(fs.list("relative\\folder"))


def test_denied_folder_raises_permission_error(tmp_path: Path) -> None:
    denied = tmp_path / "denied"
    denied.mkdir()
    deny_listing(denied)
    try:
        with pytest.raises(PermissionError):
            list(WindowsFileSystem().list(str(denied)))
    finally:
        allow_listing(denied)


def deny_listing(path: Path) -> None:
    # Everyone (S-1-1-0) may not list the folder; the owner can still undo it.
    subprocess.run(["icacls", str(path), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)


def allow_listing(path: Path) -> None:
    subprocess.run(["icacls", str(path), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)


def test_documents_folder_is_an_existing_absolute_folder() -> None:
    documents = WindowsFileSystem().documents_folder()
    assert os.path.isabs(documents)
    assert os.path.isdir(documents)
