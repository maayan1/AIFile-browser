"""Core path rules with a fake FileSystemPort (spec 1.5, 1.6): parent, breadcrumb segments, locations, show in folder."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.browse import FolderUnreadable, list_folder, parent_of, segments_of, show_in_folder, split_path
from core.cancel import Cancelled, CancelToken
from core.locations import KNOWN_FOLDER_CODES, locations
from core.ports.filesystem import FILE_ATTRIBUTE_HIDDEN, Drive
from tests.test_browse_core import FakeFs, file, folder

DOCS = r"C:\Users\dana\Documents"
DESKTOP = r"C:\Users\dana\Desktop"
DOWNLOADS = r"C:\Users\dana\Downloads"
PROTOCOL_DIR = Path(__file__).resolve().parents[2] / "protocol"


def fs_with(*folders: str, known: dict[str, str] | None = None, drives: list[Drive] | None = None) -> FakeFs:
    return FakeFs({path: [] for path in folders}, documents=DOCS, known=known, drives=drives)


# ----- split / parent -------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "root", "names", "parent"),
    [
        ("C:\\", "C:\\", [], None),
        (r"C:\Users", "C:\\", ["Users"], "C:\\"),
        (r"C:\Users\dana\Documents", "C:\\", ["Users", "dana", "Documents"], r"C:\Users\dana"),
        ("\\\\server\\share\\", "\\\\server\\share\\", [], None),
        (r"\\server\share\Team\2025", "\\\\server\\share\\", ["Team", "2025"], r"\\server\share\Team"),
        (r"\\server\share\Team", "\\\\server\\share\\", ["Team"], "\\\\server\\share\\"),
    ],
)
def test_split_and_parent(path: str, root: str, names: list[str], parent: str | None) -> None:
    assert split_path(path) == (root, names)
    assert parent_of(path) == parent


# ----- segments -------------------------------------------------------------


def test_segments_inside_documents_start_at_documents() -> None:
    path = DOCS + r"\Volunteering\סיכום"
    assert segments_of(fs_with(path), path) == [
        {"kind": "knownFolder", "code": "documents", "path": DOCS},
        {"kind": "folder", "name": "Volunteering", "path": DOCS + r"\Volunteering"},
        {"kind": "folder", "name": "סיכום", "path": path},
    ]


def test_the_known_folder_itself_is_one_segment() -> None:
    assert segments_of(fs_with(DOCS), DOCS) == [{"kind": "knownFolder", "code": "documents", "path": DOCS}]


def test_known_folder_match_ignores_case_and_keeps_the_listed_casing() -> None:
    fs = fs_with(known={"documents": r"c:\users\DANA\documents\\"})
    path = DOCS + r"\Volunteering"
    assert segments_of(fs, path)[0] == {"kind": "knownFolder", "code": "documents", "path": DOCS}


def test_a_name_that_only_starts_like_a_known_folder_is_not_inside_it() -> None:
    path = r"C:\Users\dana\Documents2\x"
    first = segments_of(fs_with(path, drives=[Drive("C", None, "C:\\")]), path)[0]
    assert first == {"kind": "drive", "letter": "C", "label": None, "path": "C:\\"}


def test_a_known_folder_nested_in_another_wins() -> None:
    nested = DOCS + r"\Downloads"
    fs = fs_with(known={"documents": DOCS, "desktop": DESKTOP, "downloads": nested})
    path = nested + r"\Forms"
    assert segments_of(fs, path) == [
        {"kind": "knownFolder", "code": "downloads", "path": nested},
        {"kind": "folder", "name": "Forms", "path": path},
    ]
    # Beside the nested one, Documents still anchors.
    assert segments_of(fs, DOCS + r"\Photos")[0]["code"] == "documents"


def test_two_known_folders_at_one_path_go_by_code_order() -> None:
    fs = fs_with(known={"desktop": DOCS, "documents": DOCS})
    assert segments_of(fs, DOCS)[0]["code"] == "documents"


def test_outside_known_folders_segments_start_at_the_drive_with_its_label() -> None:
    fs = fs_with(drives=[Drive("C", "OS", "C:\\"), Drive("D", "Data", "D:\\")])
    assert segments_of(fs, r"D:\Work\2025") == [
        {"kind": "drive", "letter": "D", "label": "Data", "path": "D:\\"},
        {"kind": "folder", "name": "Work", "path": r"D:\Work"},
        {"kind": "folder", "name": "2025", "path": r"D:\Work\2025"},
    ]
    assert fs.drive_queries == ["D"]  # only the listed drive's label is read


def test_drive_root_segment_and_a_drive_the_port_doesnt_know() -> None:
    assert segments_of(fs_with(), "E:\\") == [{"kind": "drive", "letter": "E", "label": None, "path": "E:\\"}]


def test_unc_paths_start_at_the_share_root() -> None:
    fs = fs_with()
    assert segments_of(fs, "\\\\server\\share\\") == [
        {"kind": "folder", "name": r"\\server\share", "path": "\\\\server\\share\\"},
    ]
    assert segments_of(fs, r"\\server\share\Team") == [
        {"kind": "folder", "name": r"\\server\share", "path": "\\\\server\\share\\"},
        {"kind": "folder", "name": "Team", "path": r"\\server\share\Team"},
    ]
    assert fs.drive_queries == []


# ----- list_folder ----------------------------------------------------------


def test_list_folder_resolves_the_path_first_and_reports_parent_and_segments() -> None:
    path = DOCS + r"\Volunteering"
    fs = FakeFs({path: [folder("Photos")]}, documents=DOCS)
    listing = list_folder(fs, path.lower(), CancelToken())
    assert fs.listed == [path]
    assert listing["path"] == path
    assert listing["parent"] == DOCS
    assert [s.get("code") or s.get("name") for s in listing["segments"]] == ["documents", "Volunteering"]


def test_list_folder_without_path_resolves_documents() -> None:
    fs = FakeFs({DOCS: []}, documents=DOCS.upper())
    listing = list_folder(fs, None, CancelToken())
    assert listing["path"] == DOCS
    assert listing["segments"] == [{"kind": "knownFolder", "code": "documents", "path": DOCS}]


def test_a_path_that_does_not_resolve_is_never_listed() -> None:
    fs = fs_with(DOCS)
    with pytest.raises(FileNotFoundError):
        list_folder(fs, r"C:\nope", CancelToken())
    assert fs.listed == []


# ----- locations ------------------------------------------------------------


def test_locations_lists_existing_known_folders_in_order_and_drives_by_letter() -> None:
    fs = FakeFs(
        {DOCS: [], DOWNLOADS: []},
        documents=DOCS,
        known={"downloads": DOWNLOADS.lower(), "desktop": DESKTOP, "documents": DOCS},
        drives=[Drive("E", None, "E:\\"), Drive("C", "OS", "C:\\")],
    )
    assert locations(fs) == {
        "knownFolders": [
            {"code": "documents", "path": DOCS},
            {"code": "downloads", "path": DOWNLOADS},  # resolved casing; Desktop doesn't exist
        ],
        "drives": [
            {"letter": "C", "label": "OS", "path": "C:\\"},
            {"letter": "E", "label": None, "path": "E:\\"},
        ],
    }


def test_known_folder_codes_match_the_protocol_schemas() -> None:
    listing = json.loads((PROTOCOL_DIR / "schemas" / "folderListing.schema.json").read_text(encoding="utf-8"))
    places = json.loads((PROTOCOL_DIR / "schemas" / "locations.schema.json").read_text(encoding="utf-8"))
    assert list(KNOWN_FOLDER_CODES) == listing["definitions"]["knownFolderCode"]["enum"]
    assert list(KNOWN_FOLDER_CODES) == places["definitions"]["knownFolderLocation"]["properties"]["code"]["enum"]


def test_a_folder_that_resolves_but_cannot_be_listed_carries_its_place() -> None:
    path = DOCS + r"\Private"

    class DeniedFs(FakeFs):
        def list(self, path: str):  # type: ignore[no-untyped-def]
            raise PermissionError(13, "Access is denied")
            yield  # a generator, like the real port

    with pytest.raises(FolderUnreadable) as caught:
        list_folder(DeniedFs({path: []}, documents=DOCS), path.lower(), CancelToken())
    assert isinstance(caught.value.error, PermissionError)
    assert caught.value.place == {
        "path": path,
        "parent": DOCS,
        "segments": [
            {"kind": "knownFolder", "code": "documents", "path": DOCS},
            {"kind": "folder", "name": "Private", "path": path},
        ],
    }


# ----- show_in_folder (spec 1.6) --------------------------------------------


def test_show_in_folder_lists_the_containing_folder_and_selects_the_item() -> None:
    work = r"D:\Work"
    fs = FakeFs({work: [folder("2025"), file("Report.pdf")]}, documents=DOCS)
    listing = show_in_folder(fs, r"d:\work\REPORT.PDF", CancelToken())
    assert fs.listed == [work]
    assert listing["path"] == work
    assert listing["parent"] == "D:\\"
    assert listing["selected"] == "Report.pdf"  # the on-disk name, as listed
    assert [e["name"] for e in listing["entries"]] == ["2025", "Report.pdf"]
    # A folder is an item too.
    assert show_in_folder(fs, r"D:\Work\2025", CancelToken())["selected"] == "2025"


def test_show_in_folder_selects_nothing_for_a_gone_or_hidden_item() -> None:
    work = r"D:\Work"
    fs = FakeFs({work: [file("a.txt"), file("hidden.txt", FILE_ATTRIBUTE_HIDDEN)]}, documents=DOCS)
    gone = show_in_folder(fs, r"D:\Work\gone.txt", CancelToken())
    assert gone["path"] == work and "selected" not in gone
    hidden = show_in_folder(fs, r"D:\Work\hidden.txt", CancelToken())
    assert [e["name"] for e in hidden["entries"]] == ["a.txt"] and "selected" not in hidden


def test_show_in_folder_lets_folder_errors_through() -> None:
    fs = fs_with(DOCS)
    with pytest.raises(FileNotFoundError):
        show_in_folder(fs, r"C:\nope\a.txt", CancelToken())
    with pytest.raises(FileNotFoundError):
        show_in_folder(fs, "C:\\", CancelToken())
    assert fs.listed == []


def test_show_in_folder_of_an_unreadable_folder_carries_its_place() -> None:
    private = DOCS + r"\Private"

    class DeniedFs(FakeFs):
        def list(self, path: str):  # type: ignore[no-untyped-def]
            raise PermissionError(13, "Access is denied")
            yield

    with pytest.raises(FolderUnreadable) as caught:
        show_in_folder(DeniedFs({private: []}, documents=DOCS), private + r"\a.txt", CancelToken())
    assert caught.value.place["path"] == private
    assert caught.value.place["parent"] == DOCS


def test_show_in_folder_stops_when_cancelled() -> None:
    fs = FakeFs({r"D:\Work": [file("a.txt")]}, documents=DOCS)
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        show_in_folder(fs, r"D:\Work\a.txt", token)
    assert fs.listed == []
