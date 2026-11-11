"""The one folder walker (AD-4, AD-8): fake-port tests for each rule, then one real-disk walk."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterator, Set
from pathlib import Path

import pytest

from core.browse import CANCEL_CHECK_EVERY
from core.cancel import Cancelled, CancelToken
from core.ports.filesystem import (
    FILE_ATTRIBUTE_ARCHIVE,
    FILE_ATTRIBUTE_HIDDEN,
    FILE_ATTRIBUTE_OFFLINE,
    FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_ATTRIBUTE_RECALL_ON_OPEN,
    FILE_ATTRIBUTE_REPARSE_POINT,
    IO_REPARSE_TAG_CLOUD_6,
    IO_REPARSE_TAG_MOUNT_POINT,
    IO_REPARSE_TAG_SYMLINK,
    FsEntry,
)
from core.walk import Walked, child_path, walk
from tests.test_browse_core import FakeFs, file, folder

WORK = r"D:\Work"
DOCS = r"C:\Users\dana\Documents"

CLOUD_FILE = file(
    "cloud.pdf",
    FILE_ATTRIBUTE_ARCHIVE | FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    IO_REPARSE_TAG_CLOUD_6,
)
CLOUD_FOLDER = folder("Cloud folder", FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_RECALL_ON_OPEN, IO_REPARSE_TAG_CLOUD_6)


class WalkFs(FakeFs):
    """FakeFs where some folders can't be listed: `denied` raise PermissionError at once, and
    `failing` yield their entries and then fail midway."""

    def __init__(
        self, folders: dict[str, list[FsEntry]], denied: Set[str] = frozenset(), failing: Set[str] = frozenset()
    ) -> None:
        super().__init__(folders)
        self.denied = denied
        self.failing = failing

    def list(self, path: str) -> Iterator[FsEntry]:
        if path in self.denied:
            self.listed.append(path)
            raise PermissionError(13, "Access is denied", path)
        yield from super().list(path)
        if path in self.failing:
            raise OSError(1117, "The request could not be performed because of an I/O device error")


def names(walked: Walked) -> list[str]:
    assert walked.entries is not None
    return [entry.name for entry in walked.entries]


def test_walks_depth_first_in_entry_order_with_candidate_entries() -> None:
    fs = WalkFs(
        {
            WORK: [folder("Alpha"), file("notes.txt"), file("hidden.txt", FILE_ATTRIBUTE_HIDDEN), folder("Beta")],
            WORK + r"\Alpha": [folder("Deep"), file("a.txt"), file("~$a.docx")],
            WORK + r"\Alpha\Deep": [file("b.txt")],
            WORK + r"\Beta": [],
        }
    )
    walked = list(walk(fs, WORK, CancelToken()))
    assert [w.folder for w in walked] == [WORK, WORK + r"\Alpha", WORK + r"\Alpha\Deep", WORK + r"\Beta"]
    assert [names(w) for w in walked] == [["Alpha", "notes.txt", "Beta"], ["Deep", "a.txt"], ["b.txt"], []]
    assert all(w.error is None for w in walked)


def test_hidden_folders_are_neither_yielded_nor_descended() -> None:
    fs = WalkFs({WORK: [folder("Secret", FILE_ATTRIBUTE_HIDDEN)], WORK + r"\Secret": [file("x.txt")]})
    assert [w.folder for w in walk(fs, WORK, CancelToken())] == [WORK]
    assert fs.listed == [WORK]


def test_a_denied_subfolder_is_reported_and_its_siblings_are_walked() -> None:
    fs = WalkFs(
        {
            WORK: [folder("Alpha"), folder("Private"), folder("Zeta")],
            WORK + r"\Alpha": [folder("Deep")],
            WORK + r"\Alpha\Deep": [file("b.txt")],
            WORK + r"\Zeta": [folder("Inner")],
            WORK + r"\Zeta\Inner": [file("z.txt")],
        },
        denied={WORK + r"\Private"},
    )
    walked = list(walk(fs, WORK, CancelToken()))
    assert [w.folder for w in walked] == [
        WORK, WORK + r"\Alpha", WORK + r"\Alpha\Deep", WORK + r"\Private", WORK + r"\Zeta", WORK + r"\Zeta\Inner",
    ]
    private = walked[3]
    assert private.entries is None
    assert isinstance(private.error, PermissionError)
    assert names(walked[-1]) == ["z.txt"]


def test_a_folder_failing_midway_is_reported_without_its_partial_entries() -> None:
    fs = WalkFs({WORK: [folder("Flaky"), folder("Next")], WORK + r"\Flaky": [file("a.txt")], WORK + r"\Next": []},
                failing={WORK + r"\Flaky"})
    walked = list(walk(fs, WORK, CancelToken()))
    assert [(w.folder, w.entries is None, type(w.error)) for w in walked] == [
        (WORK, False, type(None)), (WORK + r"\Flaky", True, OSError), (WORK + r"\Next", False, type(None)),
    ]


def test_junctions_and_symlinks_are_never_followed() -> None:
    loop = [
        folder("My Music", FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_MOUNT_POINT),  # junction -> Documents
        folder("Up", FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_SYMLINK),  # symlink -> an ancestor
        file("linked.txt", FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_SYMLINK),
        folder("Projects"),
    ]
    # Were the links followed, these keys would make the walk loop.
    fs = WalkFs({DOCS: loop, DOCS + r"\My Music": loop, DOCS + r"\Up": loop, DOCS + r"\Projects": []})
    walked = list(walk(fs, DOCS, CancelToken()))
    assert [w.folder for w in walked] == [DOCS, DOCS + r"\Projects"]
    assert names(walked[0]) == ["Projects"]
    assert fs.listed == [DOCS, DOCS + r"\Projects"]


def test_an_online_only_folder_is_yielded_but_never_descended() -> None:
    fs = WalkFs({WORK: [CLOUD_FOLDER, folder("Local")], WORK + r"\Cloud folder": [file("x.txt")], WORK + r"\Local": []})
    walked = list(walk(fs, WORK, CancelToken()))
    assert names(walked[0]) == ["Cloud folder", "Local"]
    assert [w.folder for w in walked] == [WORK, WORK + r"\Local"]
    assert WORK + r"\Cloud folder" not in fs.listed


def test_an_online_only_file_is_yielded_as_an_entry() -> None:
    fs = WalkFs({WORK: [CLOUD_FILE, folder("Sub")], WORK + r"\Sub": [CLOUD_FILE]})
    walked = list(walk(fs, WORK, CancelToken()))
    assert [w.entries for w in walked] == [[CLOUD_FILE, folder("Sub")], [CLOUD_FILE]]
    # Only folders were listed; the port offers no way to open a file, and the walker asks for none.
    assert fs.listed == [WORK, WORK + r"\Sub"]


def test_cancel_stops_before_the_next_directory() -> None:
    fs = WalkFs({WORK: [folder("A"), folder("B")], WORK + r"\A": [], WORK + r"\B": []})
    token = CancelToken()
    walker = walk(fs, WORK, token)
    assert next(walker).folder == WORK
    assert next(walker).folder == WORK + r"\A"
    token.cancel()
    with pytest.raises(Cancelled):
        next(walker)
    assert fs.listed == [WORK, WORK + r"\A"]


def test_cancel_stops_within_a_huge_folder() -> None:
    token = CancelToken()
    pulled = 0
    huge = WORK + r"\Huge"

    class HugeFs(WalkFs):
        def list(self, path: str) -> Iterator[FsEntry]:
            nonlocal pulled
            if path != huge:
                yield from super().list(path)
                return
            for i in range(10 * CANCEL_CHECK_EVERY):
                pulled += 1
                if i == 250:
                    token.cancel()  # a newer request arrives mid-folder
                yield file(f"f{i}.txt")

    walker = walk(HugeFs({WORK: [folder("Huge")]}), WORK, token)
    assert next(walker).folder == WORK
    # Cancelled, not reported as an unreadable folder.
    with pytest.raises(Cancelled):
        next(walker)
    assert pulled == 2 * CANCEL_CHECK_EVERY


def test_a_cancelled_token_stops_before_the_root() -> None:
    fs = WalkFs({WORK: []})
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        next(walk(fs, WORK, token))
    assert fs.listed == []


def test_an_unreadable_or_missing_root_raises() -> None:
    fs = WalkFs({WORK: []}, denied={WORK})
    with pytest.raises(PermissionError):
        list(walk(fs, WORK, CancelToken()))
    with pytest.raises(FileNotFoundError):
        list(walk(fs, r"D:\Gone", CancelToken()))


def test_an_unreadable_root_raises_even_when_it_fails_midway() -> None:
    fs = WalkFs({WORK: [folder("A")], WORK + r"\A": []}, failing={WORK})
    with pytest.raises(OSError):
        list(walk(fs, WORK, CancelToken()))


@pytest.mark.parametrize(
    ("parent", "child"),
    [
        ("C:\\", r"C:\Users"),
        (r"C:\Users", r"C:\Users\Users"),
        ("\\\\server\\share\\", r"\\server\share\Users"),
        (r"\\server\share\Team", r"\\server\share\Team\Users"),
    ],
)
def test_child_paths_join_with_one_separator(parent: str, child: str) -> None:
    assert child_path(parent, "Users") == child


def test_walk_from_a_drive_root() -> None:
    fs = WalkFs({"C:\\": [folder("Users")], r"C:\Users": [file("a.txt")]})
    assert [w.folder for w in walk(fs, "C:\\", CancelToken())] == ["C:\\", r"C:\Users"]


# ----- on a real disk -------------------------------------------------------


@pytest.mark.skipif(os.name != "nt", reason="Windows file system")
def test_real_walk_skips_a_junction_loop_and_reports_a_denied_folder(tmp_path: Path) -> None:
    from adapters.windows_fs import WindowsFileSystem

    root = tmp_path / "Work"
    (root / "Alpha" / "Deep").mkdir(parents=True)
    (root / "Alpha" / "Deep" / "b.txt").write_bytes(b"b")
    (root / "Private").mkdir()
    (root / "Private" / "secret.txt").write_bytes(b"s")
    (root / "Zeta").mkdir()
    (root / "Zeta" / "z.txt").write_bytes(b"z")
    subprocess.run(["cmd", "/c", "mklink", "/J", str(root / "Alpha" / "Loop"), str(root)], check=True, capture_output=True)
    subprocess.run(["icacls", str(root / "Private"), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)
    try:
        walked = {w.folder: w for w in walk(WindowsFileSystem(), str(root), CancelToken())}
    finally:
        subprocess.run(["icacls", str(root / "Private"), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)

    assert set(walked) == {str(root / name) for name in ["", "Alpha", r"Alpha\Deep", "Private", "Zeta"]}
    assert isinstance(walked[str(root / "Private")].error, PermissionError)
    assert walked[str(root / "Private")].entries is None
    assert names(walked[str(root / "Alpha")]) == ["Deep"]  # the Loop junction is not even an entry
    assert names(walked[str(root / "Alpha" / "Deep")]) == ["b.txt"]
    assert names(walked[str(root / "Zeta")]) == ["z.txt"]
