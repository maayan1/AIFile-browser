"""Core browse rules with a fake FileSystemPort: is_candidate, the type map, list_folder, cancel."""

from __future__ import annotations

import re
from collections.abc import Iterator

import pytest

from core.browse import CANCEL_CHECK_EVERY, join_path, list_folder, split_path
from core.cancel import Cancelled, CancelToken
from core.candidates import is_candidate
from core.ports.filesystem import (
    FILE_ATTRIBUTE_ARCHIVE,
    FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_HIDDEN,
    FILE_ATTRIBUTE_OFFLINE,
    FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_ATTRIBUTE_RECALL_ON_OPEN,
    FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_SYSTEM,
    IO_REPARSE_TAG_CLOUD_6,
    IO_REPARSE_TAG_MOUNT_POINT,
    IO_REPARSE_TAG_SYMLINK,
    Drive,
    FsEntry,
)
from core.rules.file_types import TYPE_CODES, extension, file_type_code

ISO_LOCAL = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")
OCT_14_2025_NS = 1_760_434_200 * 1_000_000_000  # 2025-10-14T09:30:00Z


def file(name: str, attributes: int = FILE_ATTRIBUTE_ARCHIVE, reparse_tag: int = 0, size: int = 10) -> FsEntry:
    return FsEntry(name, False, size, OCT_14_2025_NS, attributes, reparse_tag)


def folder(name: str, attributes: int = 0, reparse_tag: int = 0) -> FsEntry:
    return FsEntry(name, True, 0, OCT_14_2025_NS, FILE_ATTRIBUTE_DIRECTORY | attributes, reparse_tag)


class FakeFs:
    """Folders keyed by their resolved path; `resolve` accepts any casing of a key."""

    def __init__(
        self,
        folders: dict[str, list[FsEntry]],
        documents: str = r"C:\Users\dana\Documents",
        known: dict[str, str] | None = None,
        drives: list[Drive] | None = None,
    ) -> None:
        self.folders = folders
        self.documents = documents
        self.known = {"documents": documents} if known is None else known
        self.drive_list = drives or []
        self.listed: list[str] = []
        self.drive_queries: list[str | None] = []

    def documents_folder(self) -> str:
        return self.documents

    def known_folders(self) -> dict[str, str]:
        return dict(self.known)

    def drives(self, letter: str | None = None) -> list[Drive]:
        self.drive_queries.append(letter)
        return [d for d in self.drive_list if letter is None or d.letter == letter]

    def resolve(self, path: str) -> str:
        for key in self.folders:
            if key.casefold() == path.casefold():
                return key
        raise FileNotFoundError(path)

    def locate(self, path: str) -> tuple[str, str | None]:
        root, names = split_path(path)
        if not names:
            raise FileNotFoundError(path)
        folder = self.resolve(join_path(root, names[:-1]))
        found = (e.name for e in self.folders[folder] if e.name.casefold() == names[-1].casefold())
        return folder, next(found, None)

    def list(self, path: str) -> Iterator[FsEntry]:
        self.listed.append(path)
        if path not in self.folders:
            raise FileNotFoundError(path)
        yield from self.folders[path]


# ----- is_candidate ---------------------------------------------------------


@pytest.mark.parametrize(
    "entry",
    [
        file("desktop.ini", FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM),
        file("hidden.txt", FILE_ATTRIBUTE_HIDDEN),
        file("system.dat", FILE_ATTRIBUTE_SYSTEM),
        folder("Hidden folder", FILE_ATTRIBUTE_HIDDEN),
        file("~$x.docx"),
        file("~$סיכום.docx"),
        folder("My Music", FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_MOUNT_POINT),
        folder("linked folder", FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_SYMLINK),
        file("linked.txt", FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_SYMLINK),
    ],
    ids=lambda e: e.name,
)
def test_skipped_entries(entry: FsEntry) -> None:
    assert not is_candidate(entry)


@pytest.mark.parametrize(
    "entry",
    [
        file("report.docx"),
        file("סיכום ישיבה 3.docx"),
        file("a~$b.txt"),
        file("~notes.txt"),
        folder("Photos"),
        # OneDrive placeholders: cloud reparse tag and recall bits, still listed.
        file(
            "cloud.pdf",
            FILE_ATTRIBUTE_ARCHIVE | FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_OFFLINE
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
            IO_REPARSE_TAG_CLOUD_6,
        ),
        folder("Cloud folder", FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_RECALL_ON_OPEN, IO_REPARSE_TAG_CLOUD_6),
    ],
    ids=lambda e: e.name,
)
def test_listed_entries(entry: FsEntry) -> None:
    assert is_candidate(entry)


# ----- type map -------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "code"),
    [
        ("a.pdf", "pdf"),
        ("A.PDF", "pdf"),
        ("סיכום ישיבה 3.docx", "word"),
        ("old.doc", "word"),
        ("budget.xlsx", "excel"),
        ("talk.pptx", "powerpoint"),
        ("phone list.txt", "text"),
        ("README.md", "markdown"),
        ("photo.JPG", "image"),
        ("song.mp3", "audio"),
        ("clip.mp4", "video"),
        ("backup.zip", "archive"),
        ("archive.tar.gz", "archive"),
        ("notes.rtf", "other"),
        ("README", "other"),
        (".gitignore", "other"),
    ],
)
def test_file_type_code(name: str, code: str) -> None:
    assert file_type_code(name) == code
    assert code in TYPE_CODES


def test_extension() -> None:
    assert extension("Budget תקציב.PDF") == "pdf"
    assert extension("README") == ""
    assert extension("a.") == ""


# ----- list_folder ----------------------------------------------------------


def test_lists_documents_when_no_path_is_given() -> None:
    fs = FakeFs({r"C:\Users\dana\Documents": [folder("Photos"), file("סיכום ישיבה 3.docx", size=38912)]})
    listing = list_folder(fs, None, CancelToken())
    assert fs.listed == [r"C:\Users\dana\Documents"]
    assert listing["path"] == r"C:\Users\dana\Documents"
    photos, minutes = listing["entries"]
    assert photos == {"name": "Photos", "kind": "folder", "modified": photos["modified"]}
    assert minutes == {
        "name": "סיכום ישיבה 3.docx",
        "kind": "file",
        "typeCode": "word",
        "size": 38912,
        "modified": minutes["modified"],
    }
    assert ISO_LOCAL.match(minutes["modified"]), minutes["modified"]


def test_lists_the_given_path_and_keeps_only_candidates() -> None:
    path = r"D:\Volunteering"
    fs = FakeFs(
        {
            path: [
                file("hidden.txt", FILE_ATTRIBUTE_HIDDEN),
                file("system.dat", FILE_ATTRIBUTE_SYSTEM),
                file("~$x.docx"),
                folder("junction", FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_MOUNT_POINT),
                file("normal.txt"),
            ]
        }
    )
    listing = list_folder(fs, path, CancelToken())
    assert listing["path"] == path
    assert [e["name"] for e in listing["entries"]] == ["normal.txt"]


def test_modified_is_the_same_instant_in_local_time() -> None:
    from datetime import datetime, timezone

    fs = FakeFs({"X:\\": [file("a.txt")]})
    modified = list_folder(fs, "X:\\", CancelToken())["entries"][0]["modified"]
    assert datetime.fromisoformat(modified) == datetime(2025, 10, 14, 9, 30, tzinfo=timezone.utc)


def test_unknown_or_out_of_range_modified_is_null() -> None:
    fs = FakeFs(
        {
            "X:\\": [
                FsEntry("unknown.txt", False, 1, None, FILE_ATTRIBUTE_ARCHIVE, 0),
                FsEntry("far.txt", False, 1, 10**30, FILE_ATTRIBUTE_ARCHIVE, 0),
            ]
        }
    )
    entries = list_folder(fs, "X:\\", CancelToken())["entries"]
    assert [e["modified"] for e in entries] == [None, None]


def test_name_with_unpaired_surrogate_is_skipped_and_siblings_are_listed() -> None:
    fs = FakeFs({"X:\\": [file("bad\ud800.txt"), file("good.txt"), folder("Photos")]})
    assert not is_candidate(file("bad\ud800.txt"))
    entries = list_folder(fs, "X:\\", CancelToken())["entries"]
    assert [e["name"] for e in entries] == ["good.txt", "Photos"]


def test_type_codes_match_the_protocol_schema() -> None:
    import json
    from pathlib import Path

    schema_path = Path(__file__).resolve().parents[2] / "protocol" / "schemas" / "folderListing.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    file_codes = schema["definitions"]["fileEntry"]["properties"]["typeCode"]["enum"]
    assert list(TYPE_CODES) == ["folder", *file_codes]


def test_empty_folder_lists_no_entries() -> None:
    fs = FakeFs({"X:\\": [file("~$lock.docx"), file("desktop.ini", FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)]})
    assert list_folder(fs, "X:\\", CancelToken()) == {
        "path": "X:\\",
        "parent": None,
        "segments": [{"kind": "drive", "letter": "X", "label": None, "path": "X:\\"}],
        "entries": [],
    }


def test_port_errors_pass_through() -> None:
    with pytest.raises(FileNotFoundError):
        list_folder(FakeFs({}), r"C:\gone", CancelToken())


def test_a_cancelled_token_stops_before_listing() -> None:
    fs = FakeFs({"X:\\": [file("a.txt")]})
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        list_folder(fs, "X:\\", token)
    assert fs.listed == []


def test_cancel_is_checked_every_200_entries() -> None:
    token = CancelToken()
    pulled = 0

    class CancellingFs(FakeFs):
        def list(self, path: str) -> Iterator[FsEntry]:
            nonlocal pulled
            for i in range(10 * CANCEL_CHECK_EVERY):
                pulled += 1
                if i == 250:
                    token.cancel()  # a newer request arrives mid-listing
                yield file(f"f{i}.txt")

    with pytest.raises(Cancelled):
        list_folder(CancellingFs({"X:\\": []}), "X:\\", token)
    assert pulled == 2 * CANCEL_CHECK_EVERY


def test_cancel_after_the_last_entry_still_cancels() -> None:
    token = CancelToken()

    class CancellingFs(FakeFs):
        def list(self, path: str) -> Iterator[FsEntry]:
            yield file("a.txt")
            token.cancel()

    with pytest.raises(Cancelled):
        list_folder(CancellingFs({"X:\\": []}), "X:\\", token)
