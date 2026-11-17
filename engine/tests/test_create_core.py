"""createFile's core rules with a fake FileSystemPort: name checks, containment, error codes."""

from __future__ import annotations

import pytest

from core.cancel import Cancelled, CancelToken
from core.create import (
    FILE_EXISTS,
    INVALID_NAME,
    MAX_NAME_LENGTH,
    CreateRefused,
    create_error_code,
    create_file,
    name_is_valid,
)
from core.errors import ACCESS_DENIED, FOLDER_NOT_FOUND, FOLDER_UNAVAILABLE

DOCS = r"C:\Users\dana\Documents"


class CreateFs:
    """Folders keyed by resolved path, each with the names in it (case-insensitive, as NTFS)."""

    def __init__(self, folders: dict[str, set[str]], fail: OSError | None = None) -> None:
        self.folders = folders
        self.fail = fail
        self.created: list[str] = []

    def resolve(self, path: str) -> str:
        for key in self.folders:
            if key.casefold() == path.casefold():
                return key
        raise FileNotFoundError(path)

    def create_file(self, path: str) -> None:
        if self.fail is not None:
            raise self.fail
        folder, _, name = path.rpartition("\\")
        folder = folder + "\\" if folder.endswith(":") else folder
        names = self.folders[folder]
        if name.casefold() in {n.casefold() for n in names}:
            raise FileExistsError(path)
        names.add(name)
        self.created.append(path)


def make(*names: str, fail: OSError | None = None) -> CreateFs:
    return CreateFs({DOCS: set(names), "C:\\": set()}, fail)


def refused(fs: CreateFs, folder: str, name: str) -> str:
    with pytest.raises(CreateRefused) as info:
        create_file(fs, folder, name, CancelToken())
    return info.value.code


def test_creates_the_file_in_the_resolved_folder() -> None:
    fs = make()
    created = create_file(fs, DOCS.upper(), "notes.txt", CancelToken())
    assert created == {"path": DOCS + r"\notes.txt", "name": "notes.txt"}
    assert fs.created == [DOCS + r"\notes.txt"]


def test_creates_at_a_drive_root_without_a_doubled_separator() -> None:
    fs = make()
    assert create_file(fs, "C:\\", "a.txt", CancelToken())["path"] == r"C:\a.txt"


@pytest.mark.parametrize("name", ["סיכום ישיבה.docx", "no extension", ".gitignore", "a..b", "x" * MAX_NAME_LENGTH, " lead.txt"])
def test_accepts_ordinary_names(name: str) -> None:
    assert name_is_valid(name)
    fs = make()
    assert create_file(fs, DOCS, name, CancelToken())["name"] == name


def test_an_existing_name_in_any_casing_is_file_exists_and_nothing_is_created() -> None:
    fs = make("Notes.txt")
    assert refused(fs, DOCS, "notes.TXT") == FILE_EXISTS
    assert fs.created == []


def test_a_second_create_of_the_same_name_is_file_exists() -> None:
    fs = make()
    create_file(fs, DOCS, "notes.txt", CancelToken())
    assert refused(fs, DOCS, "notes.txt") == FILE_EXISTS
    assert fs.created == [DOCS + r"\notes.txt"]


@pytest.mark.parametrize(
    "name",
    [
        "", ".", "..",
        "../bad.txt", r"..\bad.txt", "a/b.txt", r"a\b.txt", r"\abs.txt", r"C:\Windows\x.txt", "C:x.txt",
        r"\\server\share\x.txt", "file.txt:stream", "a*b", "a?b", "a<b", "a>b", 'a"b', "a|b", "a\x00b", "tab\there",
        "trailing.", "trailing ", "...",
        "CON", "con", "con.txt", "NUL.tar.gz", "Aux", "prn .txt", "COM1", "lpt9.log", "COM\u00b9",
        "x" * (MAX_NAME_LENGTH + 1),
    ],
)
def test_invalid_names_and_path_traversal_are_rejected_before_any_write(name: str) -> None:
    assert not name_is_valid(name)
    fs = make()
    assert refused(fs, DOCS, name) == INVALID_NAME
    assert fs.created == []


@pytest.mark.parametrize("name", ["COM0", "CONSOLE.txt", "nul-file.txt", "LPT10"])
def test_names_that_only_look_like_devices_are_fine(name: str) -> None:
    assert name_is_valid(name)


def test_a_missing_folder_is_folder_not_found_and_no_folder_is_created() -> None:
    fs = make()
    assert refused(fs, DOCS + r"\gone", "notes.txt") == FOLDER_NOT_FOUND
    assert fs.created == []
    assert set(fs.folders) == {DOCS, "C:\\"}


def test_a_folder_that_cant_be_written_is_access_denied() -> None:
    assert refused(make(fail=PermissionError("denied")), DOCS, "notes.txt") == ACCESS_DENIED


def test_cancelled_before_the_write_creates_nothing() -> None:
    fs = make()
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        create_file(fs, DOCS, "notes.txt", token)
    assert fs.created == []


def winerror(code: int, cls: type[OSError] = OSError) -> OSError:
    exc = cls()
    exc.winerror = code  # type: ignore[attr-defined]
    return exc


@pytest.mark.parametrize(
    ("exc", "code"),
    [
        (FileExistsError(), FILE_EXISTS),
        (winerror(80), FILE_EXISTS),
        (winerror(183), FILE_EXISTS),
        (winerror(123), INVALID_NAME),
        (winerror(206), INVALID_NAME),
        (PermissionError(), ACCESS_DENIED),
        (winerror(5, PermissionError), ACCESS_DENIED),
        (winerror(21, PermissionError), FOLDER_UNAVAILABLE),  # drive not ready, mapped by Python as denied
        (winerror(3), FOLDER_NOT_FOUND),
        (winerror(53), FOLDER_UNAVAILABLE),  # network path not found
    ],
)
def test_create_errors_map_to_protocol_codes(exc: OSError, code: str) -> None:
    assert create_error_code(exc) == code
