"""renameFile's core rules with a fake FileSystemPort: name checks, files only, same folder, codes."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from core.cancel import Cancelled, CancelToken
from core.create import FILE_EXISTS, INVALID_NAME
from core.errors import ACCESS_DENIED, FOLDER_UNAVAILABLE
from core.ports.filesystem import FsEntry
from core.rename import FILE_IN_USE, FILE_NOT_FOUND, RenameRefused, rename_error_code, rename_file

DOCS = r"C:\Users\dana\Documents"
NOTES = DOCS + r"\Notes.txt"


class RenameFs:
    """One folder's items by on-disk name (True for a folder), case-insensitive as NTFS."""

    def __init__(self, items: dict[str, bool], fail: OSError | None = None, list_fail: OSError | None = None) -> None:
        self.items = items
        self.fail = fail
        self.list_fail = list_fail
        self.renamed: list[tuple[str, str]] = []

    def _find(self, name: str) -> str | None:
        return next((n for n in self.items if n.casefold() == name.casefold()), None)

    def locate(self, path: str) -> tuple[str, str | None]:
        folder, _, name = path.rpartition("\\")
        if folder.casefold() != DOCS.casefold():
            raise FileNotFoundError(path)
        return DOCS, self._find(name)

    def list(self, path: str) -> Iterator[FsEntry]:
        if self.list_fail is not None:
            raise self.list_fail
        for name, is_dir in self.items.items():
            yield FsEntry(name=name, is_dir=is_dir, size=0, mtime_ns=None, attributes=0, reparse_tag=0)

    def rename_file(self, path: str, new_path: str) -> None:
        if self.fail is not None:
            raise self.fail
        old, new = path.rpartition("\\")[2], new_path.rpartition("\\")[2]
        other = self._find(new)
        if other is not None and other != old:
            raise FileExistsError(new_path)
        self.items[new] = self.items.pop(old)
        self.renamed.append((path, new_path))


def make(fail: OSError | None = None, list_fail: OSError | None = None) -> RenameFs:
    return RenameFs({"Notes.txt": False, "Other.txt": False, "Photos": True}, fail, list_fail)


def refused(fs: RenameFs, path: str, new_name: str) -> str:
    with pytest.raises(RenameRefused) as info:
        rename_file(fs, path, new_name, CancelToken())
    return info.value.code


def test_renames_the_file_in_its_own_folder_by_its_on_disk_name() -> None:
    fs = make()
    renamed = rename_file(fs, NOTES.upper(), "סיכום ישיבה.txt", CancelToken())
    assert renamed == {"oldPath": NOTES, "path": DOCS + r"\סיכום ישיבה.txt", "name": "סיכום ישיבה.txt"}
    assert fs.renamed == [(NOTES, DOCS + r"\סיכום ישיבה.txt")]
    assert set(fs.items) == {"סיכום ישיבה.txt", "Other.txt", "Photos"}


def test_a_casing_only_rename_renames_the_same_file() -> None:
    fs = make()
    assert rename_file(fs, NOTES, "notes.TXT", CancelToken())["path"] == DOCS + r"\notes.TXT"
    assert set(fs.items) == {"notes.TXT", "Other.txt", "Photos"}


def test_the_same_name_succeeds_without_touching_the_disk() -> None:
    fs = make()
    assert rename_file(fs, NOTES, "Notes.txt", CancelToken()) == {"oldPath": NOTES, "path": NOTES, "name": "Notes.txt"}
    assert fs.renamed == []


@pytest.mark.parametrize("taken", ["Other.txt", "OTHER.TXT", "Photos", "photos"])
def test_another_items_name_in_any_casing_is_file_exists_and_nothing_changes(taken: str) -> None:
    fs = make()
    assert refused(fs, NOTES, taken) == FILE_EXISTS
    assert set(fs.items) == {"Notes.txt", "Other.txt", "Photos"}


@pytest.mark.parametrize(
    "name",
    ["", ".", "..", r"..\Notes.txt", "../x.txt", r"sub\x.txt", r"C:\x.txt", r"\\server\share\x.txt", "a:b", "a*b",
     "trailing.", "trailing ", "CON", "con.txt", "x" * 256],
)
def test_invalid_names_and_path_traversal_are_rejected_before_anything_is_looked_up(name: str) -> None:
    fs = make(list_fail=AssertionError("looked up"))  # type: ignore[arg-type]
    assert refused(fs, NOTES, name) == INVALID_NAME
    assert fs.renamed == []


def test_a_folder_is_never_renamed() -> None:
    fs = make()
    assert refused(fs, DOCS + r"\Photos", "Albums") == FILE_NOT_FOUND
    assert fs.renamed == []


@pytest.mark.parametrize("path", [DOCS + r"\gone.txt", DOCS + r"\gone\Notes.txt"])
def test_a_missing_file_or_folder_is_file_not_found(path: str) -> None:
    fs = make()
    assert refused(fs, path, "x.txt") == FILE_NOT_FOUND
    assert fs.renamed == []


def test_a_folder_that_cant_be_listed_is_access_denied() -> None:
    assert refused(make(list_fail=PermissionError("denied")), NOTES, "x.txt") == ACCESS_DENIED


def test_cancelled_before_the_rename_changes_nothing() -> None:
    fs = make()
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        rename_file(fs, NOTES, "x.txt", token)
    assert fs.renamed == []


def winerror(code: int, cls: type[OSError] = OSError) -> OSError:
    exc = cls()
    exc.winerror = code  # type: ignore[attr-defined]
    return exc


@pytest.mark.parametrize(
    ("exc", "code"),
    [
        (FileExistsError(), FILE_EXISTS),
        (winerror(183), FILE_EXISTS),
        (winerror(80), FILE_EXISTS),
        (winerror(32, PermissionError), FILE_IN_USE),  # sharing violation
        (winerror(33, PermissionError), FILE_IN_USE),  # lock violation
        (winerror(123), INVALID_NAME),
        (winerror(206), INVALID_NAME),
        (IsADirectoryError(), FILE_NOT_FOUND),
        (FileNotFoundError(), FILE_NOT_FOUND),
        (winerror(2, FileNotFoundError), FILE_NOT_FOUND),  # gone since it was found
        (PermissionError(), ACCESS_DENIED),
        (winerror(5, PermissionError), ACCESS_DENIED),
        (winerror(21, PermissionError), FOLDER_UNAVAILABLE),  # drive not ready
        (winerror(53), FOLDER_UNAVAILABLE),  # network path not found
    ],
)
def test_rename_errors_map_to_protocol_codes(exc: OSError, code: str) -> None:
    assert rename_error_code(exc) == code


def test_a_port_failure_is_refused_with_its_code_and_nothing_changes() -> None:
    fs = make(fail=winerror(32, PermissionError))
    assert refused(fs, NOTES, "x.txt") == FILE_IN_USE
    assert set(fs.items) == {"Notes.txt", "Other.txt", "Photos"}
