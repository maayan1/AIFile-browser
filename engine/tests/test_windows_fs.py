"""WindowsFileSystem on a real temp folder: attributes from enumeration, junctions, Hebrew names."""

from __future__ import annotations

import ctypes
import os
import subprocess
from pathlib import Path

import pytest

from adapters import windows_fs
from adapters.windows_fs import WindowsFileSystem
from core.browse import list_folder
from core.cancel import CancelToken
from core.ports.filesystem import (
    FILE_ATTRIBUTE_ARCHIVE,
    FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_HIDDEN,
    FILE_ATTRIBUTE_NORMAL,
    FILE_ATTRIBUTE_OFFLINE,
    FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_ATTRIBUTE_RECALL_ON_OPEN,
    FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_SYSTEM,
    IO_REPARSE_TAG_MOUNT_POINT,
    StoredOnline,
)
from core.rules.preview import READ_CHUNK_BYTES

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


class _StrictEntry:
    """A DirEntry whose stat/is_* calls fail unless they read only the cached find data."""

    def __init__(self, entry: os.DirEntry[str]) -> None:
        self._entry = entry
        self.name = entry.name
        self.path = entry.path

    def stat(self, *, follow_symlinks: bool = True) -> os.stat_result:
        assert follow_symlinks is False, f"stat() followed {self.name!r}"
        return self._entry.stat(follow_symlinks=False)

    def is_dir(self, *, follow_symlinks: bool = True) -> bool:
        assert follow_symlinks is False, f"is_dir() followed {self.name!r}"
        return self._entry.is_dir(follow_symlinks=False)

    def is_file(self, *, follow_symlinks: bool = True) -> bool:
        assert follow_symlinks is False, f"is_file() followed {self.name!r}"
        return self._entry.is_file(follow_symlinks=False)

    def is_symlink(self) -> bool:
        raise AssertionError(f"is_symlink() on {self.name!r}")

    def is_junction(self) -> bool:
        raise AssertionError(f"is_junction() on {self.name!r}")

    def inode(self) -> int:
        raise AssertionError(f"inode() on {self.name!r}: it opens the entry on Windows")


class _StrictScandir:
    def __init__(self, inner) -> None:  # type: ignore[no-untyped-def]
        self._inner = inner

    def __enter__(self) -> _StrictScandir:
        return self

    def __exit__(self, *exc: object) -> None:
        self._inner.close()

    def __iter__(self) -> _StrictScandir:
        return self

    def __next__(self) -> _StrictEntry:
        return _StrictEntry(next(self._inner))

    def close(self) -> None:
        self._inner.close()


def test_listing_opens_and_stats_no_entry(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Attributes come from the enumeration's find data: no per-entry stat, lstat, open or path
    # check, so no OneDrive placeholder is recalled and no junction is followed. This catches
    # Python-level calls only: a CreateFileW made from C code (or through ctypes) can't be
    # intercepted this way.
    import builtins
    import io
    import nt
    import ntpath

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError(f"list() made a per-entry call: {args!r}")

    real_scandir = os.scandir
    monkeypatch.setattr(os, "scandir", lambda path: _StrictScandir(real_scandir(path)))
    for module, name in [(os, "stat"), (os, "lstat"), (os, "open"), (builtins, "open"), (io, "open")]:
        monkeypatch.setattr(module, name, forbidden)
    # os.path binds the nt helpers at import, so patch both the helpers and the os.path names.
    for name in ["_path_isdir", "_path_isfile", "_path_exists", "_path_lexists", "_path_islink", "_path_isjunction"]:
        if hasattr(nt, name):
            monkeypatch.setattr(nt, name, forbidden)
    for name in ["isdir", "isfile", "exists", "lexists", "islink", "isjunction"]:
        if hasattr(ntpath, name):
            monkeypatch.setattr(ntpath, name, forbidden)
    try:
        entries = list(WindowsFileSystem().list(str(folder)))
    finally:
        monkeypatch.undo()  # before pytest itself needs os.stat to report a failure
    assert {e.name for e in entries} == {
        "normal.txt", HEBREW_DOC, MIXED_PDF, "Photos", "hidden.txt", "system.dat", "~$x.docx", "junction",
    }


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


# ----- create_file: the port's only write (createFile) -----------------------------------------


def deny_adding_files(path: Path) -> None:
    # WD on a folder is "create files / write data": the folder can still be listed.
    subprocess.run(["icacls", str(path), "/deny", "*S-1-1-0:(WD)"], check=True, capture_output=True)


def test_create_file_creates_one_empty_file_with_a_hebrew_name(tmp_path: Path) -> None:
    target = tmp_path / HEBREW_DOC
    WindowsFileSystem().create_file(str(target))
    assert target.is_file()
    assert target.stat().st_size == 0
    assert [p.name for p in tmp_path.iterdir()] == [HEBREW_DOC]


def test_create_file_never_overwrites_a_file_in_any_casing(tmp_path: Path) -> None:
    existing = tmp_path / "Notes.txt"
    existing.write_bytes(b"keep me")
    for typed in ("Notes.txt", "NOTES.TXT"):
        with pytest.raises(FileExistsError):
            WindowsFileSystem().create_file(str(tmp_path / typed))
    assert existing.read_bytes() == b"keep me"
    assert [p.name for p in tmp_path.iterdir()] == ["Notes.txt"]


def test_create_file_over_a_read_only_file_or_a_folder_is_file_exists(tmp_path: Path) -> None:
    read_only = tmp_path / "locked.txt"
    read_only.write_bytes(b"keep me")
    read_only.chmod(0o444)
    (tmp_path / "Photos").mkdir()
    try:
        for name in ("locked.txt", "Photos"):
            with pytest.raises(FileExistsError):
                WindowsFileSystem().create_file(str(tmp_path / name))
        assert read_only.read_bytes() == b"keep me"
        assert (tmp_path / "Photos").is_dir()
    finally:
        read_only.chmod(0o666)


def test_create_file_never_creates_a_missing_folder(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().create_file(str(tmp_path / "gone" / "notes.txt"))
    assert list(tmp_path.iterdir()) == []


def test_create_file_rejects_a_relative_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().create_file("notes.txt")
    assert list(tmp_path.iterdir()) == []


def test_create_file_in_a_folder_that_denies_adding_files_raises_permission_error(tmp_path: Path) -> None:
    locked = tmp_path / "locked"
    locked.mkdir()
    deny_adding_files(locked)
    try:
        with pytest.raises(PermissionError) as info:
            WindowsFileSystem().create_file(str(locked / "notes.txt"))
        assert not isinstance(info.value, FileExistsError)
    finally:
        allow_listing(locked)
    assert list(locked.iterdir()) == []


# ----- rename_file: a file's new name, in its own folder (renameFile) -------------------------


def deny_deleting(path: Path) -> None:
    # D on a file is "delete": a rename needs it, reading the file doesn't.
    subprocess.run(["icacls", str(path), "/deny", "*S-1-1-0:(D)"], check=True, capture_output=True)


def test_rename_file_gives_a_file_a_hebrew_name_and_keeps_its_content(tmp_path: Path) -> None:
    source = tmp_path / "notes.txt"
    source.write_bytes(b"keep me")
    WindowsFileSystem().rename_file(str(source), str(tmp_path / HEBREW_DOC))
    assert [p.name for p in tmp_path.iterdir()] == [HEBREW_DOC]
    assert (tmp_path / HEBREW_DOC).read_bytes() == b"keep me"


def test_rename_file_renames_in_place_when_only_the_casing_changes(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_bytes(b"keep me")
    WindowsFileSystem().rename_file(str(tmp_path / "notes.txt"), str(tmp_path / "Notes.TXT"))
    assert [p.name for p in tmp_path.iterdir()] == ["Notes.TXT"]


@pytest.mark.parametrize("taken", ["Other.txt", "OTHER.TXT", "Photos", "PHOTOS"])
def test_rename_file_never_overwrites_another_item_in_any_casing(tmp_path: Path, taken: str) -> None:
    (tmp_path / "notes.txt").write_bytes(b"mine")
    (tmp_path / "Other.txt").write_bytes(b"theirs")
    (tmp_path / "Photos").mkdir()
    with pytest.raises(FileExistsError):
        WindowsFileSystem().rename_file(str(tmp_path / "notes.txt"), str(tmp_path / taken))
    assert sorted(p.name for p in tmp_path.iterdir()) == ["Other.txt", "Photos", "notes.txt"]
    assert (tmp_path / "notes.txt").read_bytes() == b"mine"
    assert (tmp_path / "Other.txt").read_bytes() == b"theirs"


def test_rename_file_never_renames_a_folder(tmp_path: Path) -> None:
    (tmp_path / "Photos").mkdir()
    with pytest.raises(IsADirectoryError):
        WindowsFileSystem().rename_file(str(tmp_path / "Photos"), str(tmp_path / "Albums"))
    assert [p.name for p in tmp_path.iterdir()] == ["Photos"]


def test_rename_file_of_a_missing_file_or_a_relative_path_is_file_not_found(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().rename_file(str(tmp_path / "gone.txt"), str(tmp_path / "x.txt"))
    (tmp_path / "notes.txt").write_bytes(b"")
    monkeypatch.chdir(tmp_path)
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().rename_file("notes.txt", "x.txt")
    assert [p.name for p in tmp_path.iterdir()] == ["notes.txt"]


def test_rename_file_of_a_file_another_program_has_open_fails_as_in_use(tmp_path: Path) -> None:
    source = tmp_path / "notes.txt"
    source.write_bytes(b"keep me")
    # Python opens files without FILE_SHARE_DELETE, as most programs that edit a file do.
    with open(source, "rb"), pytest.raises(PermissionError) as info:
        WindowsFileSystem().rename_file(str(source), str(tmp_path / "x.txt"))
    assert getattr(info.value, "winerror", None) == 32
    assert [p.name for p in tmp_path.iterdir()] == ["notes.txt"]


def test_rename_file_that_may_not_be_deleted_raises_permission_error(tmp_path: Path) -> None:
    source = tmp_path / "notes.txt"
    source.write_bytes(b"keep me")
    deny_deleting(source)
    try:
        with pytest.raises(PermissionError) as info:
            WindowsFileSystem().rename_file(str(source), str(tmp_path / "x.txt"))
        assert not isinstance(info.value, FileExistsError)
    finally:
        allow_listing(source)
    assert [p.name for p in tmp_path.iterdir()] == ["notes.txt"]


# ----- stat and read_head: one item's entry, and a preview's capped read ----------------------


def test_stat_reports_the_entry_in_on_disk_casing_as_enumeration_does(folder: Path) -> None:
    fs = WindowsFileSystem()
    entry = fs.stat(str(folder / "NORMAL.TXT"))
    listed = next(e for e in fs.list(str(folder)) if e.name == "normal.txt")
    assert entry == listed
    assert (entry.name, entry.is_dir, entry.size) == ("normal.txt", False, 1234)
    assert entry.mtime_ns == (folder / "normal.txt").stat().st_mtime_ns
    assert entry.attributes & FILE_ATTRIBUTE_ARCHIVE
    hebrew = fs.stat(str(folder / HEBREW_DOC))
    assert (hebrew.name, hebrew.size) == (HEBREW_DOC, 3)


def test_stat_of_a_folder_has_no_size(folder: Path) -> None:
    entry = WindowsFileSystem().stat(str(folder / "photos"))
    assert (entry.name, entry.is_dir, entry.size) == ("Photos", True, 0)
    assert entry.attributes & FILE_ATTRIBUTE_DIRECTORY


@pytest.mark.parametrize("typed", ["", "notes.txt", "C:\\", "\\\\?\\C:\\x.txt", "C:\\*.txt"])
def test_stat_rejects_roots_and_empty_relative_device_and_wildcard_paths(typed: str) -> None:
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().stat(typed)


def test_stat_of_a_missing_item_is_file_not_found(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().stat(str(tmp_path / "gone.txt"))
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().stat(str(tmp_path / "gone" / "x.txt"))


def test_read_head_reads_at_most_the_limit_in_chunks_checking_before_each(tmp_path: Path) -> None:
    content = bytes(range(256)) * 800  # 204,800 bytes: three full chunks and part of a fourth
    (tmp_path / "photo.png").write_bytes(content)
    checks = 0

    def check() -> None:
        nonlocal checks
        checks += 1

    assert WindowsFileSystem().read_head(str(tmp_path / "photo.png"), 10 * 1024 * 1024, check) == content
    assert checks == 5  # four chunks, then the read that finds the end
    checks = 0
    assert WindowsFileSystem().read_head(str(tmp_path / "photo.png"), 2048, check) == content[:2048]
    assert checks == 1


def test_read_head_reads_a_hebrew_named_file_and_changes_nothing(tmp_path: Path) -> None:
    path = tmp_path / "סיכום ישיבה.md"
    path.write_bytes("# שלום\n".encode())
    before = path.stat()
    assert WindowsFileSystem().read_head(str(path), 2048, lambda: None) == "# שלום\n".encode()
    after = path.stat()
    assert (after.st_size, after.st_mtime_ns) == (before.st_size, before.st_mtime_ns)


def test_read_head_stops_when_check_raises_and_closes_the_file(tmp_path: Path) -> None:
    path = tmp_path / "photo.png"
    path.write_bytes(b"p" * (READ_CHUNK_BYTES * 4))
    calls = 0

    def check() -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise TimeoutError("deadline")

    with pytest.raises(TimeoutError):
        WindowsFileSystem().read_head(str(path), 10 * 1024 * 1024, check)
    # Python opens without FILE_SHARE_DELETE: a handle left open would block the delete.
    path.unlink()


def test_read_head_never_opens_an_offline_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "notes.txt"
    path.write_bytes(b"content")
    set_attributes(path, FILE_ATTRIBUTE_OFFLINE)
    monkeypatch.setattr(windows_fs, "open", _never_open, raising=False)
    try:
        with pytest.raises(StoredOnline):
            WindowsFileSystem().read_head(str(path), 2048, lambda: None)
    finally:
        set_attributes(path, FILE_ATTRIBUTE_NORMAL)


@pytest.mark.parametrize("attribute", [FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN])
def test_read_head_checks_the_recall_attribute_again_and_never_opens_such_a_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, attribute: int
) -> None:
    # Only a cloud filter driver sets the recall attributes, so the look-up reports one here: the
    # file was an ordinary one when it was listed, and is online only by the time it is read.
    path = tmp_path / "photo.png"
    path.write_bytes(b"content")
    real_find = windows_fs._find

    def find_online(kernel32, item):  # type: ignore[no-untyped-def]
        data = real_find(kernel32, item)
        data.dwFileAttributes |= attribute
        return data

    monkeypatch.setattr(windows_fs, "_find", find_online)
    monkeypatch.setattr(windows_fs, "open", _never_open, raising=False)
    with pytest.raises(StoredOnline):
        WindowsFileSystem().read_head(str(path), 2048, lambda: None)


def _never_open(*args: object, **kwargs: object) -> None:
    raise AssertionError("an online-only file was opened")


def test_read_head_of_a_folder_or_a_missing_file_raises(tmp_path: Path) -> None:
    (tmp_path / "Photos").mkdir()
    with pytest.raises(IsADirectoryError):
        WindowsFileSystem().read_head(str(tmp_path / "Photos"), 2048, lambda: None)
    with pytest.raises(FileNotFoundError):
        WindowsFileSystem().read_head(str(tmp_path / "gone.txt"), 2048, lambda: None)


def test_read_head_of_a_file_that_can_not_be_read_raises_permission_error(tmp_path: Path) -> None:
    path = tmp_path / "secret.txt"
    path.write_bytes(b"content")
    subprocess.run(["icacls", str(path), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)
    try:
        with pytest.raises(PermissionError):
            WindowsFileSystem().read_head(str(path), 2048, lambda: None)
    finally:
        subprocess.run(["icacls", str(path), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)
