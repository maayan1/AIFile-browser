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


# ----- resolve, known folders, drives (spec 1.5) ----------------------------


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    root = tmp_path / "Volunteering"
    (root / "Meeting Notes").mkdir(parents=True)
    (root / "סיכום").mkdir()
    (root / "a.txt").write_bytes(b"")
    return root


def test_resolve_restores_on_disk_casing_and_drops_quotes_and_trailing_separators(tree: Path) -> None:
    fs = WindowsFileSystem()
    expected = str(tree / "Meeting Notes")
    for typed in [
        expected,
        expected.lower(),
        expected.upper(),
        f'"{expected.lower()}"',
        f'  "{expected}{os.sep}"  ',
        expected.replace(os.sep, "/") + "/",
        str(tree / "Meeting Notes" / ".." / "Meeting Notes" / "."),
    ]:
        assert fs.resolve(typed) == expected, typed
    assert fs.resolve(str(tree / "סיכום")) == str(tree / "סיכום")


def test_resolve_upper_cases_the_drive_and_keeps_the_root_separator() -> None:
    fs = WindowsFileSystem()
    drive = os.environ.get("SystemDrive", "C:")
    assert fs.resolve(drive.lower() + "\\") == drive.upper() + "\\"
    assert fs.resolve(drive.lower() + r"\Windows\..") == drive.upper() + "\\"
    assert fs.resolve(drive.lower() + r"\windows") == drive.upper() + r"\Windows"


@pytest.mark.parametrize(
    "typed",
    # The last three are device paths only once normpath unifies the separators.
    ["", "   ", '""', r"relative\folder", "C:", "C:Windows", r"\Windows", "\\\\?\\C:\\", "/\\?\\C:\\", "\\/./C:", "//?/C:/"],
)
def test_resolve_rejects_empty_relative_and_device_paths(typed: str) -> None:
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().resolve(typed)


def test_resolve_rejects_missing_folders_invalid_names_and_files(tree: Path) -> None:
    fs = WindowsFileSystem()
    with pytest.raises(FileNotFoundError):
        fs.resolve(str(tree / "gone"))
    with pytest.raises(FileNotFoundError):
        fs.resolve(str(tree / "gone" / "deeper"))
    for bad in ["a<b", "a|b", "Meeting*", "Meeting?Notes", "a:b"]:
        with pytest.raises(FileNotFoundError):
            fs.resolve(str(tree) + os.sep + bad)
    with pytest.raises(NotADirectoryError):
        fs.resolve(str(tree / "a.txt"))
    with pytest.raises(NotADirectoryError):
        fs.resolve(str(tree / "a.txt" / "x"))


def test_resolve_passes_through_a_parent_that_can_be_traversed_but_not_listed(tmp_path: Path) -> None:
    locked = tmp_path / "Locked"
    (locked / "Inner").mkdir(parents=True)
    # Everyone may not list Locked, but may still pass through it to Inner.
    subprocess.run(["icacls", str(locked), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)
    try:
        fs = WindowsFileSystem()
        typed = str(locked).lower() + r"\INNER"
        # Locked's own casing comes from tmp_path's enumeration; Inner keeps the typed casing.
        assert fs.resolve(typed) == str(locked) + r"\INNER"
        assert list(fs.list(fs.resolve(typed))) == []
    finally:
        subprocess.run(["icacls", str(locked), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)


# ----- locate (spec 1.6) ----------------------------------------------------


def test_locate_restores_the_on_disk_casing_of_the_folder_and_the_item(tree: Path) -> None:
    fs = WindowsFileSystem()
    assert fs.locate(str(tree / "a.txt").upper()) == (str(tree), "a.txt")
    typed = str(tree / "Meeting Notes" / ".." / "A.TXT").lower()
    assert fs.locate(f'  "{typed}"  ') == (str(tree), "a.txt")
    assert fs.locate(str(tree / "סיכום")) == (str(tree), "סיכום")


def test_locate_names_a_folder_item_without_its_trailing_separator(tree: Path) -> None:
    assert WindowsFileSystem().locate(str(tree / "meeting notes") + os.sep) == (str(tree), "Meeting Notes")


def test_locate_reports_a_missing_item_in_an_existing_folder_as_none(tree: Path) -> None:
    assert WindowsFileSystem().locate(str(tree / "gone.txt")) == (str(tree), None)


def test_locate_raises_for_a_missing_folder_a_file_midway_and_a_root(tree: Path) -> None:
    fs = WindowsFileSystem()
    with pytest.raises(FileNotFoundError):
        fs.locate(str(tree / "gone" / "a.txt"))
    with pytest.raises(NotADirectoryError):
        fs.locate(str(tree / "a.txt" / "b.txt"))
    drive = os.environ.get("SystemDrive", "C:")
    for root in [drive + "\\", drive.lower() + "\\", drive + r"\Windows\.."]:
        with pytest.raises(FileNotFoundError):
            fs.locate(root)


@pytest.mark.parametrize(
    "typed", ["", "   ", r"relative\a.txt", "C:a.txt", "\\\\?\\C:\\a.txt", r"C:\a<b.txt", r"C:\Users\a*"]
)
def test_locate_rejects_empty_relative_device_and_invalid_paths(typed: str) -> None:
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().locate(typed)


class FakeKernel32:
    """GetLogicalDrives / GetDriveTypeW / GetVolumeInformationW over a table of drives."""

    def __init__(self, drives: dict[str, tuple[int, str | None]]) -> None:
        self.drives = drives  # letter -> (drive type, label or None when not ready)

    def GetLogicalDrives(self) -> int:  # noqa: N802 - the Win32 name
        return sum(1 << (ord(letter) - ord("A")) for letter in self.drives)

    def GetDriveTypeW(self, root: str) -> int:  # noqa: N802
        return self.drives[root[0]][0]

    def GetVolumeInformationW(self, root, name, size, *rest) -> int:  # type: ignore[no-untyped-def]  # noqa: N802
        label = self.drives[root[0]][1]
        if label is None:
            return 0
        name.value = label
        return 1


def test_drives_keep_fixed_and_removable_and_a_named_letter_of_any_type() -> None:
    fixed, removable, remote, cdrom = 3, 2, 4, 5
    fs = WindowsFileSystem()
    fs._kernel32 = FakeKernel32(  # type: ignore[assignment]
        {"C": (fixed, "OS"), "D": (cdrom, "DVD"), "E": (removable, None), "Z": (remote, "Team")}
    )
    assert [(d.letter, d.label, d.path) for d in fs.drives()] == [("C", "OS", "C:\\"), ("E", None, "E:\\")]
    # A listing on a mapped drive still gets its label for the breadcrumb.
    assert [(d.letter, d.label) for d in fs.drives("z")] == [("Z", "Team")]
    assert fs.drives("Q") == []


def test_known_folders_are_the_three_codes_and_documents_exists() -> None:
    from core.locations import KNOWN_FOLDER_CODES

    known = WindowsFileSystem().known_folders()
    assert set(known) <= set(KNOWN_FOLDER_CODES)
    assert set(known) == set(KNOWN_FOLDER_CODES)  # every Windows 11 profile names all three
    assert os.path.isdir(known["documents"])
    for path in known.values():
        assert os.path.isabs(path)


def test_drives_are_in_letter_order_and_include_the_system_drive() -> None:
    fs = WindowsFileSystem()
    drives = fs.drives()
    letters = [d.letter for d in drives]
    assert letters == sorted(letters)
    system = os.environ.get("SystemDrive", "C:")[0].upper()
    assert system in letters
    for drive in drives:
        assert drive.path == f"{drive.letter}:\\"
        assert drive.label is None or drive.label
    assert [d.letter for d in fs.drives(system.lower())] == [system]
    assert fs.drives("?") == []
