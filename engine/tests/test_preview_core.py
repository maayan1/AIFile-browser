"""Core preview rules with a fake FileSystemPort: which file gets which thumbnail, the caps, the
deadline, the online-only guard, the outcomes and the cancel token (spec 2.5 I/O matrix)."""

from __future__ import annotations

import base64
import codecs
import json
from collections.abc import Callable
from pathlib import Path

import jsonschema
import pytest

from core.cancel import Cancelled, CancelToken
from core.outcomes import PREVIEW_OUTCOMES, ReadOutcome
from core.ports.filesystem import (
    FILE_ATTRIBUTE_ARCHIVE,
    FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_OFFLINE,
    FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_ATTRIBUTE_RECALL_ON_OPEN,
    ONLINE_ONLY_ATTRIBUTES,
    FsEntry,
    StoredOnline,
)
from core.preview import decode_head, preview
from core.rules import preview as rules

FOLDER = "C:\\Users\\dana\\Documents\\Volunteering"
OCT_14_2025_NS = 1_760_434_200 * 1_000_000_000
PROTOCOL_DIR = Path(__file__).resolve().parents[2] / "protocol"
SCHEMA = json.loads((PROTOCOL_DIR / "schemas" / "previewReady.schema.json").read_text(encoding="utf-8"))
PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 8


def at(name: str) -> str:
    return f"{FOLDER}\\{name}"


class FakeFs:
    """Files in FOLDER by name; `locate` and `stat` accept any casing, as the port does. Reads go
    chunk by chunk like the adapter's, calling `check` before each, and are recorded."""

    def __init__(self) -> None:
        self.files: dict[str, tuple[FsEntry, bytes]] = {}
        self.read: list[tuple[str, int]] = []
        self.fail_read: OSError | None = None
        self.read_attributes: int | None = None  # attributes the read's own look-up sees
        self.grow_to: int | None = None

    def add(self, name: str, content: bytes = b"", attributes: int = FILE_ATTRIBUTE_ARCHIVE, size: int | None = None) -> str:
        entry = FsEntry(name, False, len(content) if size is None else size, OCT_14_2025_NS, attributes, 0)
        self.files[name.casefold()] = (entry, content)
        return at(name)

    def add_folder(self, name: str) -> str:
        entry = FsEntry(name, True, 0, OCT_14_2025_NS, FILE_ATTRIBUTE_DIRECTORY, 0)
        self.files[name.casefold()] = (entry, b"")
        return at(name)

    def _lookup(self, path: str) -> tuple[FsEntry, bytes]:
        folder, _, name = path.rpartition("\\")
        if folder.casefold() != FOLDER.casefold() or name.casefold() not in self.files:
            raise FileNotFoundError(path)
        return self.files[name.casefold()]

    def locate(self, path: str) -> tuple[str, str | None]:
        folder, _, name = path.rpartition("\\")
        if folder.casefold() != FOLDER.casefold():
            raise FileNotFoundError(path)
        found = self.files.get(name.casefold())
        return FOLDER, found[0].name if found else None

    def stat(self, path: str) -> FsEntry:
        return self._lookup(path)[0]

    def read_head(self, path: str, limit: int, check: Callable[[], None]) -> bytes:
        entry, content = self._lookup(path)
        attributes = entry.attributes if self.read_attributes is None else self.read_attributes
        if attributes & ONLINE_ONLY_ATTRIBUTES:
            raise StoredOnline(path)
        self.read.append((path, limit))
        if self.fail_read is not None:
            raise self.fail_read
        if self.grow_to is not None:
            content = b"x" * self.grow_to
        out = b""
        while len(out) < limit:
            check()
            chunk = content[len(out) : len(out) + min(rules.READ_CHUNK_BYTES, limit - len(out))]
            if not chunk:
                break
            out += chunk
        return out


class Clock:
    """A clock that moves `step` seconds on every reading."""

    def __init__(self, step: float = 0.0) -> None:
        self.now = 100.0
        self.step = step

    def __call__(self) -> float:
        self.now += self.step
        return self.now


def run(fs: FakeFs, path: str, token: CancelToken | None = None, clock: Clock | None = None) -> dict:
    reply = preview(fs, path, token or CancelToken(), clock or Clock())  # type: ignore[arg-type]
    jsonschema.Draft7Validator(SCHEMA).validate({"id": "p1", "type": "previewReady", **reply})
    return reply


@pytest.fixture
def fs() -> FakeFs:
    return FakeFs()


# ----- images ----------------------------------------------------------------


def test_an_image_is_sent_whole_as_base64_with_its_mime_type(fs: FakeFs) -> None:
    path = fs.add("photo.png", PNG)
    reply = run(fs, path)
    assert reply["thumbnail"] == {"kind": "image", "mime": "image/png", "data": base64.b64encode(PNG).decode("ascii")}
    assert "outcomeCode" not in reply
    # Read up to one byte past the cap, so an image that grew is still caught.
    assert fs.read == [(path, rules.IMAGE_MAX_BYTES + 1)]


@pytest.mark.parametrize(
    ("name", "mime"),
    [
        ("a.png", "image/png"), ("a.JPG", "image/jpeg"), ("a.jpeg", "image/jpeg"),
        ("a.gif", "image/gif"), ("a.webp", "image/webp"), ("a.bmp", "image/bmp"),
    ],
)
def test_each_image_extension_has_its_mime_type(fs: FakeFs, name: str, mime: str) -> None:
    assert run(fs, fs.add(name, b"img"))["thumbnail"]["mime"] == mime


def test_a_two_megabyte_image_is_sent(fs: FakeFs) -> None:
    content = b"\xff\xd8" + b"j" * (2 * 1024 * 1024)
    reply = run(fs, fs.add("photo.jpg", content))
    assert base64.b64decode(reply["thumbnail"]["data"]) == content


def test_an_image_over_ten_megabytes_is_too_large_and_never_read(fs: FakeFs) -> None:
    reply = run(fs, fs.add("big.jpg", size=12 * 1024 * 1024))
    assert reply["thumbnail"] == {"kind": "page"}
    assert reply["outcomeCode"] == "tooLarge"
    assert fs.read == []


def test_an_image_of_exactly_ten_megabytes_is_sent(fs: FakeFs) -> None:
    content = b"b" * rules.IMAGE_MAX_BYTES
    reply = run(fs, fs.add("edge.bmp", content))
    assert reply["thumbnail"]["kind"] == "image"
    assert len(base64.b64decode(reply["thumbnail"]["data"])) == rules.IMAGE_MAX_BYTES


def test_an_image_that_grew_past_the_cap_since_it_was_looked_up_is_too_large(fs: FakeFs) -> None:
    path = fs.add("growing.png", b"small")
    fs.grow_to = rules.IMAGE_MAX_BYTES + 100
    reply = run(fs, path)
    assert (reply["thumbnail"], reply["outcomeCode"]) == ({"kind": "page"}, "tooLarge")


@pytest.mark.parametrize("name", ["drawing.svg", "photo.heic", "scan.tif", "icon.ico"])
def test_an_image_type_the_webview_cannot_draw_gets_a_page_and_is_never_read(fs: FakeFs, name: str) -> None:
    reply = run(fs, fs.add(name, b"img"))
    assert reply["thumbnail"] == {"kind": "page"} and "outcomeCode" not in reply
    assert reply["details"]["typeCode"] == "image"
    assert fs.read == []


# ----- text --------------------------------------------------------------------


@pytest.mark.parametrize("name", ["notes.txt", "סיכום ישיבה.md", "README.markdown", "run.log"])
def test_text_and_markdown_files_send_their_first_bytes_as_text(fs: FakeFs, name: str) -> None:
    path = fs.add(name, "# כותרת\nline two\n".encode())
    reply = run(fs, path)
    assert reply["thumbnail"] == {"kind": "text", "text": "# כותרת\nline two\n"}
    assert fs.read == [(path, rules.TEXT_HEAD_BYTES)]


def test_only_the_first_2048_bytes_of_a_long_text_file_are_read(fs: FakeFs) -> None:
    reply = run(fs, fs.add("long.txt", b"a" * 10_000))
    assert reply["thumbnail"]["text"] == "a" * 2048


def test_a_utf8_bom_is_dropped(fs: FakeFs) -> None:
    reply = run(fs, fs.add("bom.txt", codecs.BOM_UTF8 + "שלום".encode()))
    assert reply["thumbnail"]["text"] == "שלום"


@pytest.mark.parametrize(("bom", "encoding"), [(codecs.BOM_UTF16_LE, "utf-16-le"), (codecs.BOM_UTF16_BE, "utf-16-be")])
def test_utf16_is_decoded_by_its_bom(fs: FakeFs, bom: bytes, encoding: str) -> None:
    reply = run(fs, fs.add("wide.txt", bom + "Budget תקציב".encode(encoding)))
    assert reply["thumbnail"]["text"] == "Budget תקציב"


def test_invalid_bytes_are_replaced(fs: FakeFs) -> None:
    reply = run(fs, fs.add("bad.txt", b"ok\xff\xfeok"))
    assert reply["thumbnail"]["text"] == "ok\ufffd\ufffdok"


def test_a_character_cut_off_at_the_limit_is_dropped(fs: FakeFs) -> None:
    # 2,047 ASCII bytes, then a two-byte Hebrew letter: the limit cuts it in half.
    reply = run(fs, fs.add("cut.txt", b"a" * 2047 + "ש".encode() + b"rest"))
    assert reply["thumbnail"]["text"] == "a" * 2047


def test_a_utf16_surrogate_pair_cut_off_at_the_limit_is_dropped(fs: FakeFs) -> None:
    # The BOM and 1,022 letters fill 2,046 bytes: the limit keeps only the pair's high surrogate.
    content = codecs.BOM_UTF16_LE + "a".encode("utf-16-le") * 1022 + "😀".encode("utf-16-le")
    reply = run(fs, fs.add("emoji.txt", content))
    assert reply["thumbnail"]["text"] == "a" * 1022


def test_a_partial_character_at_the_end_of_a_short_file_is_replaced() -> None:
    assert decode_head("שלום".encode()[:-1], cut=False) == "שלו\ufffd"
    assert decode_head("שלום".encode()[:-1], cut=True) == "שלו"


def test_an_empty_text_file_sends_empty_text(fs: FakeFs) -> None:
    assert run(fs, fs.add("empty.txt"))["thumbnail"] == {"kind": "text", "text": ""}


# ----- other types -------------------------------------------------------------


@pytest.mark.parametrize(("name", "type_code"), [("report.pdf", "pdf"), ("a.docx", "word"), ("x.zip", "archive"), ("README", "other")])
def test_other_types_get_a_page_and_are_never_read(fs: FakeFs, name: str, type_code: str) -> None:
    reply = run(fs, fs.add(name, b"content"))
    assert reply["thumbnail"] == {"kind": "page"}
    assert "outcomeCode" not in reply
    assert reply["details"]["typeCode"] == type_code
    assert fs.read == []


# ----- details -----------------------------------------------------------------


def test_details_come_from_the_entry_in_on_disk_casing(fs: FakeFs) -> None:
    fs.add("Budget תקציב.TXT", b"x" * 1234)
    reply = run(fs, at("budget תקציב.txt"))
    details = reply["details"]
    assert details["name"] == "Budget תקציב.TXT"
    assert details["path"] == at("Budget תקציב.TXT")
    assert details["typeCode"] == "text"
    assert details["size"] == 1234
    assert details["modified"] is not None and details["modified"].startswith("2025-10-14T")


# ----- online only ---------------------------------------------------------------


@pytest.mark.parametrize("attribute", [FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN, FILE_ATTRIBUTE_OFFLINE])
@pytest.mark.parametrize("name", ["photo.png", "notes.txt", "report.pdf"])
def test_an_online_only_file_is_stored_only_in_onedrive_and_never_opened(fs: FakeFs, attribute: int, name: str) -> None:
    reply = run(fs, fs.add(name, b"content", attributes=FILE_ATTRIBUTE_ARCHIVE | attribute))
    assert (reply["thumbnail"], reply["outcomeCode"]) == ({"kind": "page"}, "storedOnlyInOneDrive")
    assert fs.read == []


def test_a_file_that_went_online_only_after_it_was_looked_up_is_never_opened(fs: FakeFs) -> None:
    path = fs.add("notes.txt", b"content")
    fs.read_attributes = FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
    reply = run(fs, path)
    assert reply["outcomeCode"] == "storedOnlyInOneDrive"
    assert fs.read == []


# ----- unreadable ----------------------------------------------------------------


def test_a_missing_file_cannot_be_read_and_keeps_its_name_from_the_path(fs: FakeFs) -> None:
    reply = run(fs, at("gone.md"))
    assert reply == {
        "details": {"name": "gone.md", "path": at("gone.md"), "typeCode": "markdown", "size": None, "modified": None},
        "thumbnail": {"kind": "page"},
        "outcomeCode": "cannotRead",
    }


def test_a_file_in_a_missing_folder_cannot_be_read(fs: FakeFs) -> None:
    reply = run(fs, "D:\\gone\\photo.png")
    assert (reply["details"]["name"], reply["outcomeCode"]) == ("photo.png", "cannotRead")


def test_a_folder_cannot_be_read(fs: FakeFs) -> None:
    assert run(fs, fs.add_folder("Photos.png"))["outcomeCode"] == "cannotRead"
    assert fs.read == []


@pytest.mark.parametrize(
    "error",
    [PermissionError(13, "denied"), OSError(None, "in use", None, 32), FileNotFoundError(2, "gone")],
    ids=["access denied", "locked", "vanished"],
)
def test_a_failed_read_cannot_be_read(fs: FakeFs, error: OSError) -> None:
    path = fs.add("notes.txt", b"content")
    fs.fail_read = error
    reply = run(fs, path)
    assert (reply["thumbnail"], reply["outcomeCode"]) == ({"kind": "page"}, "cannotRead")
    assert reply["details"]["size"] == 7  # looked up before the read failed


def test_a_read_past_its_deadline_cannot_be_read(fs: FakeFs) -> None:
    # Each clock reading moves 0.5 s: the deadline (2 s) passes after a few 64 KB chunks.
    path = fs.add("slow.png", b"p" * (rules.READ_CHUNK_BYTES * 20))
    reply = run(fs, path, clock=Clock(step=0.5))
    assert (reply["thumbnail"], reply["outcomeCode"]) == ({"kind": "page"}, "cannotRead")


def test_a_read_whose_only_chunk_ends_past_the_deadline_cannot_be_read(fs: FakeFs) -> None:
    # Readings: the deadline is set at 0 s (so 2 s), the one chunk's check sees 1 s, and the
    # read ends at 5 s: past the deadline, though no check before a chunk saw it.
    readings = iter([0.0, 1.0, 5.0])
    path = fs.add("notes.txt", b"a" * 3000)
    reply = preview(fs, path, CancelToken(), lambda: next(readings))  # type: ignore[arg-type]
    assert (reply["thumbnail"], reply["outcomeCode"]) == ({"kind": "page"}, "cannotRead")
    assert fs.read == [(path, rules.TEXT_HEAD_BYTES)]


def test_a_read_within_its_deadline_is_sent(fs: FakeFs) -> None:
    path = fs.add("quick.png", b"p" * (rules.READ_CHUNK_BYTES * 3))
    assert run(fs, path, clock=Clock(step=0.1))["thumbnail"]["kind"] == "image"


# ----- cancel ----------------------------------------------------------------------


def test_a_cancelled_token_stops_the_preview_before_anything_is_read(fs: FakeFs) -> None:
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        preview(fs, fs.add("photo.png", PNG), token, Clock())  # type: ignore[arg-type]
    assert fs.read == []


def test_a_cancel_during_the_read_stops_it_between_chunks(fs: FakeFs) -> None:
    token = CancelToken()
    path = fs.add("photo.png", b"p" * (rules.READ_CHUNK_BYTES * 10))
    checks = 0

    def clock() -> float:
        nonlocal checks
        checks += 1
        if checks == 4:  # the first reading sets the deadline; the third chunk's check cancels
            token.cancel()
        return 0.0

    with pytest.raises(Cancelled):
        preview(fs, path, token, clock)  # type: ignore[arg-type]


# ----- outcomes ------------------------------------------------------------------------


def test_read_outcome_has_every_spine_value_and_preview_uses_three() -> None:
    assert {o.value for o in ReadOutcome} == {
        "storedOnlyInOneDrive", "passwordProtected", "noTextLayer", "tooLarge", "cannotRead", "unsupportedType",
    }
    codes = json.loads((PROTOCOL_DIR / "codes.json").read_text(encoding="utf-8"))["readOutcomeCodes"]
    assert [o.value for o in PREVIEW_OUTCOMES] == codes
    assert SCHEMA["properties"]["outcomeCode"]["enum"] == codes
