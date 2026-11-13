"""Name search rules (Story 2.1 I/O matrix) with a fake FileSystemPort: parse_query, matching,
the walk, batching and the reply order."""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from core.cancel import Cancelled, CancelToken
from core.ports.filesystem import FILE_ATTRIBUTE_HIDDEN
from core.search import BATCH_SIZE, FLUSH_AFTER, name_search, parse_query
from core.search.query import normalize
from tests.test_browse_core import ISO_LOCAL, file, folder
from tests.test_walk import CLOUD_FOLDER, WalkFs
import main

DOCS = r"C:\Users\dana\Documents"
PROTOCOL_DIR = Path(__file__).resolve().parents[2] / "protocol"


def schema(message_type: str) -> jsonschema.Draft7Validator:
    path = PROTOCOL_DIR / "schemas" / f"{message_type}.schema.json"
    return jsonschema.Draft7Validator(json.loads(path.read_text(encoding="utf-8")))


def run(fs: WalkFs, text: str, root: str = DOCS, token: CancelToken | None = None, **kwargs: Any) -> list[dict[str, Any]]:
    """Every message the search sends, its searchDone last."""
    sent: list[dict[str, Any]] = []
    done = name_search(fs, root, parse_query(text), token or CancelToken(), sent.append, **kwargs)
    return [*sent, done]


def matched(messages: list[dict[str, Any]]) -> list[str]:
    return [m["name"] for message in messages if message["type"] == "nameMatches" for m in message["matches"]]


def assert_reply_order(messages: list[dict[str, Any]]) -> None:
    types = [m["type"] for m in messages]
    assert types[0] == "searchParsed"
    assert types[-1] == "searchDone"
    assert len(types) >= 3 and set(types[1:-1]) == {"nameMatches"}
    for message in messages:
        schema(message["type"]).validate({"id": "q1", **message})


# ----- parse_query -----------------------------------------------------------


def test_parse_query_trims_and_is_always_normal() -> None:
    query = parse_query("  report final \t", ["report final"])
    assert query.parsed() == {"mode": "normal", "dateRange": None, "residualText": "report final"}
    assert query.literal_phrases == ("report final",)
    assert parse_query("   ").residual_text == ""


def test_normalize_composes_and_casefolds() -> None:
    assert normalize("Straße") == "strasse"
    assert normalize(unicodedata.normalize("NFD", "Café")) == "café"


# ----- the I/O matrix ----------------------------------------------------------


def test_ears_01_returns_the_two_report_files_only() -> None:
    fs = WalkFs({DOCS: [file("report.pdf"), file("photo.jpg"), file("report-final.docx")]})
    messages = run(fs, "report")
    assert_reply_order(messages)
    assert sorted(matched(messages)) == ["report-final.docx", "report.pdf"]


def test_matching_ignores_case_matches_folders_and_hebrew() -> None:
    fs = WalkFs({DOCS: [file("Report.PDF"), folder("reports"), file("דוח שנתי.docx"), file("notes.txt")], DOCS + r"\reports": []})
    assert sorted(matched(run(fs, "REPORT"))) == ["Report.PDF", "reports"]
    assert matched(run(fs, "דוח")) == ["דוח שנתי.docx"]


def test_a_decomposed_name_matches_composed_text() -> None:
    fs = WalkFs({DOCS: [file(unicodedata.normalize("NFD", "Café menu.docx")), file("Cafe.txt")]})
    assert matched(run(fs, "café")) == [unicodedata.normalize("NFD", "Café menu.docx")]


def test_an_extension_is_ordinary_text() -> None:
    fs = WalkFs({DOCS: [file("a.pdf"), file("b.pdf.txt"), file("c.docx"), file("pdf notes.txt")]})
    assert matched(run(fs, ".pdf")) == ["a.pdf", "b.pdf.txt"]


def test_a_deep_match_is_found_and_an_online_only_folder_is_named_but_not_entered() -> None:
    a, b, c = DOCS + r"\a", DOCS + r"\a\b", DOCS + r"\a\b\c"
    cloud = DOCS + r"\Cloud folder"
    fs = WalkFs(
        {
            DOCS: [folder("a"), CLOUD_FOLDER],
            a: [folder("b")],
            b: [folder("c")],
            c: [file("deep report.txt")],
            cloud: [file("report in the cloud.txt")],
        }
    )
    assert matched(run(fs, "report")) == ["deep report.txt"]
    assert cloud not in fs.listed
    messages = run(fs, "folder")
    assert matched(messages) == ["Cloud folder"]
    (match,) = messages[1]["matches"]
    assert match == {"name": "Cloud folder", "kind": "folder", "modified": match["modified"], "path": cloud, "folder": DOCS}


def test_each_match_carries_its_path_folder_type_and_date() -> None:
    sub = DOCS + r"\Volunteering"
    fs = WalkFs({DOCS: [folder("Volunteering")], sub: [file("סיכום ישיבה.docx", size=38912)]})
    messages = run(fs, "ישיבה")
    assert_reply_order(messages)
    (match,) = messages[1]["matches"]
    assert set(match) == {"name", "kind", "typeCode", "path", "folder", "modified"}
    assert match["path"] == sub + r"\סיכום ישיבה.docx"
    assert match["folder"] == sub
    assert match["typeCode"] == "word"
    assert ISO_LOCAL.match(match["modified"])


def test_no_match_still_sends_one_empty_batch() -> None:
    fs = WalkFs({DOCS: [file("report.pdf")]})
    messages = run(fs, "xyz123")
    assert_reply_order(messages)
    assert [m["type"] for m in messages] == ["searchParsed", "nameMatches", "searchDone"]
    assert messages[1]["matches"] == []
    assert messages[-1] == {"type": "searchDone", "notices": [], "indexVersion": None, "indexingActive": False}


def test_many_matches_arrive_in_batches_of_at_most_200_before_done() -> None:
    fs = WalkFs({DOCS: [folder("x"), *(file(f"match {i}.txt") for i in range(300))], DOCS + r"\x": [file(f"match x{i}.txt") for i in range(150)]})
    messages = run(fs, "match")
    assert_reply_order(messages)
    batches = [m["matches"] for m in messages if m["type"] == "nameMatches"]
    assert len(batches) >= 3
    assert all(len(batch) <= BATCH_SIZE for batch in batches)
    assert sum(len(batch) for batch in batches) == 450
    assert len(set(matched(messages))) == 450


def test_exactly_200_matches_send_no_trailing_empty_batch() -> None:
    fs = WalkFs({DOCS: [file(f"match {i}.txt") for i in range(BATCH_SIZE)]})
    batches = [m["matches"] for m in run(fs, "match") if m["type"] == "nameMatches"]
    assert [len(b) for b in batches] == [BATCH_SIZE]


def test_a_batch_goes_out_after_a_folder_once_the_flush_interval_passed() -> None:
    now = [0.0]
    fs = WalkFs(
        {
            DOCS: [folder("a"), folder("b"), folder("c"), file("m0")],
            DOCS + r"\a": [file("m1")],
            DOCS + r"\b": [file("m2")],
            DOCS + r"\c": [file("m3")],
        }
    )

    def listing(path: str):  # type: ignore[no-untyped-def]
        now[0] += FLUSH_AFTER / 2  # each folder takes half the flush interval to list
        return WalkFs.list(fs, path)

    fs.list = listing  # type: ignore[method-assign]
    sent: list[dict[str, Any]] = []
    name_search(fs, DOCS, parse_query("m"), CancelToken(), sent.append, clock=lambda: now[0])
    batches = [[m["name"] for m in s["matches"]] for s in sent if s["type"] == "nameMatches"]
    # The interval runs from the root's listing: it has passed once b is done, not yet after c.
    assert batches == [["m0", "m1", "m2"], ["m3"]]


def test_the_flush_interval_is_checked_after_unreadable_folders_too() -> None:
    now = [0.0]
    fs = WalkFs(
        {DOCS: [folder("p1"), folder("p2"), folder("z"), file("m0")], DOCS + r"\z": [file("m9")]},
        denied={DOCS + r"\p1", DOCS + r"\p2"},
    )

    def listing(path: str):  # type: ignore[no-untyped-def]
        now[0] += FLUSH_AFTER / 2  # each folder takes half the flush interval to list, or to fail
        return WalkFs.list(fs, path)

    fs.list = listing  # type: ignore[method-assign]
    sent: list[dict[str, Any]] = []
    name_search(fs, DOCS, parse_query("m"), CancelToken(), sent.append, clock=lambda: now[0])
    batches = [[m["name"] for m in s["matches"]] for s in sent if s["type"] == "nameMatches"]
    # The interval has passed once p2 fails: m0 goes out then, before z is read.
    assert batches == [["m0"], ["m9"]]


def test_a_cancel_stops_the_search_and_nothing_follows() -> None:
    fs = WalkFs({DOCS: [folder("a"), *(file(f"m{i}") for i in range(BATCH_SIZE))], DOCS + r"\a": [file("m-late")]})
    token = CancelToken()
    sent: list[dict[str, Any]] = []

    def emit(message: dict[str, Any]) -> None:
        sent.append(message)
        if message["type"] == "nameMatches":
            token.cancel()  # a newer search arrives as the first batch goes out

    with pytest.raises(Cancelled):
        name_search(fs, DOCS, parse_query("m"), token, emit)
    assert [m["type"] for m in sent] == ["searchParsed", "nameMatches"]
    assert DOCS + r"\a" not in fs.listed


def test_a_cancelled_token_sends_nothing() -> None:
    token = CancelToken()
    token.cancel()
    sent: list[dict[str, Any]] = []
    with pytest.raises(Cancelled):
        name_search(WalkFs({DOCS: []}), DOCS, parse_query("m"), token, sent.append)
    assert sent == []


@pytest.mark.parametrize(
    ("fs", "exc"),
    [(WalkFs({}), FileNotFoundError), (WalkFs({DOCS: []}, denied={DOCS}), PermissionError)],
    ids=["missing", "denied"],
)
def test_a_root_that_cannot_be_resolved_or_listed_raises_before_anything_is_sent(fs: WalkFs, exc: type) -> None:
    sent: list[dict[str, Any]] = []
    with pytest.raises(exc):
        name_search(fs, DOCS, parse_query("report"), CancelToken(), sent.append)
    assert sent == []


def test_whitespace_only_text_walks_nothing() -> None:
    fs = WalkFs({DOCS: [file("a b.txt")]})
    messages = run(fs, "   ")
    assert [m["type"] for m in messages] == ["searchParsed", "nameMatches", "searchDone"]
    assert messages[1]["matches"] == []
    assert fs.listed == []


# ----- walk rules ----------------------------------------------------------------


def test_the_root_is_never_a_match_and_its_path_is_resolved() -> None:
    root = r"D:\Reports"
    fs = WalkFs({root: [file("report.pdf")]})
    messages = run(fs, "report", root=r"d:\reports")
    assert matched(messages) == ["report.pdf"]
    assert messages[1]["matches"][0]["folder"] == root


def test_hidden_items_and_lock_files_never_match() -> None:
    fs = WalkFs({DOCS: [file("report.pdf", FILE_ATTRIBUTE_HIDDEN), file("~$report.docx"), file("report.txt")]})
    assert matched(run(fs, "report")) == ["report.txt"]


def test_an_unreadable_subfolder_is_skipped_and_the_search_goes_on() -> None:
    fs = WalkFs(
        {DOCS: [folder("Private"), folder("Open")], DOCS + r"\Open": [file("report.txt")]},
        denied={DOCS + r"\Private"},
    )
    messages = run(fs, "report")
    assert_reply_order(messages)
    assert matched(messages) == ["report.txt"]
    assert messages[-1]["notices"] == []  # the permission notice is Story 2.3


# ----- the search handler ----------------------------------------------------------


def handle(fs: WalkFs, request: dict[str, Any]) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []
    reply = main.search_handler(fs)(request, CancelToken(), sent.append)
    return [*sent, reply]


def test_the_handler_puts_the_request_id_on_every_reply() -> None:
    fs = WalkFs({DOCS: [file("report.pdf")]})
    messages = handle(fs, {"id": "q1", "type": "search", "text": " report ", "folder": DOCS, "literalPhrases": []})
    assert [(m["id"], m["type"]) for m in messages] == [("q1", "searchParsed"), ("q1", "nameMatches"), ("q1", "searchDone")]
    assert messages[0]["residualText"] == "report"
    for message in messages:
        schema(message["type"]).validate(message)


@pytest.mark.parametrize(
    ("fs", "code"),
    [(WalkFs({}), "folderNotFound"), (WalkFs({DOCS: []}, denied={DOCS}), "accessDenied")],
    ids=["missing", "denied"],
)
def test_the_handler_maps_a_bad_root_to_the_folder_codes(fs: WalkFs, code: str) -> None:
    messages = handle(fs, {"id": "q2", "type": "search", "text": "report", "folder": DOCS})
    assert messages == [{"id": "q2", "type": "error", "code": code, "data": {}}]
