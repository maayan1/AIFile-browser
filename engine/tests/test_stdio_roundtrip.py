"""Subprocess tests of the stdin/stdout JSON-lines transport (spec 1.1 I/O matrix)."""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

ENGINE_DIR = Path(__file__).resolve().parents[1]
CORRECT_DISPLAY = Path(__file__).resolve().parents[2] / "fixtures" / "correct-display-names.json"
READY = {"id": None, "type": "ready", "protocolVersion": 1}
HEBREW = "סיכום ישיבה"

# Runs the real engine, but with a ping handler that writes stray output both
# through print() and straight to fd 1, the way buggy engine code or a native library would.
STRAY_PRINT_SCRIPT = """
import os, sys
sys.path.insert(0, os.getcwd())
from adapters import stdio_transport
import main

original = stdio_transport.HANDLERS["ping"]

def noisy_ping(request):
    print("stray print from engine code")
    os.write(1, b"stray fd1 write\\n")
    return original(request)

stdio_transport.HANDLERS["ping"] = noisy_ping
sys.exit(main.main())
"""


class Engine:
    def __init__(self, log_dir: Path, args: list[str] | None = None, env: dict[str, str] | None = None) -> None:
        env = dict(os.environ, FB2_LOG_DIR=str(log_dir), FB2_VALIDATE_PROTOCOL="1", **(env or {}))
        # stderr goes to a file, never an undrained pipe a large traceback could fill.
        self.stderr = open(log_dir / "engine-stderr.txt", "wb")
        self.started = time.monotonic()
        self.proc = subprocess.Popen(
            [sys.executable, *(args or ["main.py"])],
            cwd=ENGINE_DIR,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr,
        )
        self.lines: queue.Queue[bytes] = queue.Queue()
        self.pump = threading.Thread(target=self._pump, daemon=True)
        self.pump.start()

    def _pump(self) -> None:
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            self.lines.put(raw)

    def read_raw(self, timeout: float = 5.0) -> bytes:
        return self.lines.get(timeout=timeout)

    def read(self, timeout: float = 5.0) -> dict:
        raw = self.read_raw(timeout)
        assert raw.endswith(b"\n"), raw
        return json.loads(raw.decode("utf-8"))

    def send_raw(self, raw: bytes) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(raw)
        self.proc.stdin.flush()

    def send(self, message: dict) -> None:
        self.send_raw(json.dumps(message, ensure_ascii=False).encode("utf-8") + b"\n")

    def close(self) -> int:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        try:
            return self.proc.wait(timeout=10)
        finally:
            if self.proc.poll() is None:
                self.proc.kill()
            self.stderr.close()


@pytest.fixture
def engine(tmp_path: Path):
    eng = Engine(tmp_path)
    assert eng.read() == READY
    yield eng
    eng.close()


def test_ready_is_first_line_within_one_second(tmp_path: Path) -> None:
    eng = Engine(tmp_path)
    try:
        first = eng.read(timeout=5.0)
        elapsed = time.monotonic() - eng.started
        assert first == READY
        assert elapsed <= 1.0, f"ready took {elapsed:.3f}s"
    finally:
        eng.close()


def test_ping_gets_pong(engine: Engine) -> None:
    engine.send({"id": "a1", "type": "ping"})
    assert engine.read() == {"id": "a1", "type": "pong"}


def test_hebrew_text_is_echoed_identically_as_utf8(engine: Engine) -> None:
    engine.send({"id": "a2", "type": "ping", "text": HEBREW})
    raw = engine.read_raw()
    assert HEBREW.encode("utf-8") in raw  # raw UTF-8 on the wire, not \\u escapes
    assert json.loads(raw.decode("utf-8")) == {"id": "a2", "type": "pong", "text": HEBREW}


def test_status_gets_status_report(engine: Engine) -> None:
    engine.send({"id": "s1", "type": "status"})
    assert engine.read() == {"id": "s1", "type": "statusReport", "phase": "idle", "documentCount": 0}


def test_unknown_type_is_rejected_and_engine_keeps_running(engine: Engine) -> None:
    engine.send({"id": "a3", "type": "nope"})
    assert engine.read() == {"id": "a3", "type": "error", "code": "unknownRequest", "data": {}}
    engine.send({"id": "a4", "type": "ping"})
    assert engine.read() == {"id": "a4", "type": "pong"}


@pytest.mark.parametrize(
    "line",
    [
        b"not json\n",
        b"{\"type\":\"ping\"}\n",
        b"{\"id\":\"x1\"}\n",
        b"{\"id\":5,\"type\":\"ping\"}\n",
        b"[1,2]\n",
        b"\xff\xfe broken utf-8\n",
        b"\n",
        b'{"id":"s1","type":"ping","text":"\\ud800"}\n',
    ],
    ids=["not-json", "no-id", "no-type", "non-string-id", "not-object", "bad-utf8", "blank", "lone-surrogate"],
)
def test_bad_line_is_rejected_and_engine_keeps_running(engine: Engine, tmp_path: Path, line: bytes) -> None:
    engine.send_raw(line)
    assert engine.read() == {"id": None, "type": "error", "code": "invalidRequest", "data": {}}
    engine.send({"id": "b1", "type": "ping"})
    assert engine.read() == {"id": "b1", "type": "pong"}
    assert engine.close() == 0
    assert "invalid request line" in (tmp_path / "engine.log").read_text(encoding="utf-8")


def test_request_violating_its_schema_is_rejected_with_its_id(engine: Engine) -> None:
    engine.send({"id": "c1", "type": "ping", "text": 5})
    assert engine.read() == {"id": "c1", "type": "error", "code": "invalidRequest", "data": {}}


def test_stray_print_goes_to_log_not_protocol(tmp_path: Path) -> None:
    eng = Engine(tmp_path, ["-c", STRAY_PRINT_SCRIPT])
    try:
        assert eng.read() == READY
        eng.send({"id": "d1", "type": "ping"})
        assert eng.read() == {"id": "d1", "type": "pong"}
    finally:
        assert eng.close() == 0

    eng.pump.join(timeout=5)
    leftover = []
    while not eng.lines.empty():
        leftover.append(eng.lines.get())
    assert leftover == []  # nothing but protocol lines ever reached stdout

    log_text = (tmp_path / "engine.log").read_text(encoding="utf-8")
    assert "stray print from engine code" in log_text
    assert "stray fd1 write" in log_text


def test_engine_exits_cleanly_when_stdin_closes(engine: Engine) -> None:
    assert engine.close() == 0


# ----- listFolder (spec 1.4 I/O matrix) ------------------------------------

# The real engine with a file system whose Documents folder is a test folder, whose "SLOW"
# folder takes minutes to enumerate (1 ms per entry), so a listing is still running when the
# test sends its next request, whose "HANG" folder blocks for a minute without checking its
# cancel token, whose "NOTREADY" folder is on a drive that isn't ready, and in which every real
# folder under a "SLOWTREE" folder takes 20 ms to list.
TEST_FS_SCRIPT = """
import os, sys, time
sys.path.insert(0, os.getcwd())
import main
from adapters.windows_fs import WindowsFileSystem
from core.ports.filesystem import FsEntry

ERROR_NOT_READY = 21

class TestFileSystem(WindowsFileSystem):
    def documents_folder(self):
        return os.environ["FB2_TEST_DOCUMENTS"]

    def known_folders(self):
        return {"documents": os.environ["FB2_TEST_DOCUMENTS"]}

    def resolve(self, path):
        if path == "NOTREADY":
            raise OSError(None, "The device is not ready", None, ERROR_NOT_READY)
        return path if path in ("SLOW", "HANG") else super().resolve(path)

    def list(self, path):
        if path == "HANG":
            return self._hang()
        if os.sep + "SLOWTREE" in path:
            time.sleep(0.02)  # a real folder that is slow to list, so its walk is still running
        return self._slow() if path == "SLOW" else super().list(path)

    def _hang(self):
        # Blocked as if inside scandir on a dead share: never checks its cancel token.
        time.sleep(60)
        yield from ()

    def _slow(self):
        for i in range(10**6):
            time.sleep(0.001)
            yield FsEntry(f"f{i}.txt", False, 1, None, 0x20, 0)

    def read_head(self, path, limit, check):
        if "SLOWREAD" not in path:
            return super().read_head(path, limit, check)
        # A file on a share that crawls: one tiny chunk every 10 ms, checking between them.
        for _ in range(6000):
            check()
            time.sleep(0.01)
        return b""

main.WindowsFileSystem = TestFileSystem
sys.exit(main.main())
"""

PROTOCOL_DIR = ENGINE_DIR.parent / "protocol"


def assert_valid(message: dict) -> None:
    import jsonschema

    schema = json.loads((PROTOCOL_DIR / "schemas" / f"{message['type']}.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft7Validator(schema).validate(message)


def make_documents(tmp_path: Path) -> Path:
    docs = tmp_path / "Documents"
    docs.mkdir()
    (docs / "Photos").mkdir()
    (docs / "סיכום ישיבה 3.docx").write_bytes(b"x" * 38912)
    (docs / "Budget תקציב.pdf").write_bytes(b"")
    (docs / "~$סיכום ישיבה 3.docx").write_bytes(b"")
    return docs


@pytest.fixture
def test_fs_engine(tmp_path: Path):
    docs = make_documents(tmp_path)
    eng = Engine(tmp_path, ["-c", TEST_FS_SCRIPT], env={"FB2_TEST_DOCUMENTS": str(docs)})
    assert eng.read() == READY
    eng.documents = docs  # type: ignore[attr-defined]
    yield eng
    eng.close()


def no_schema_violations(log_dir: Path) -> bool:
    return "violates its schema" not in (log_dir / "engine.log").read_text(encoding="utf-8")


def test_list_folder_without_path_lists_documents(test_fs_engine: Engine, tmp_path: Path) -> None:
    test_fs_engine.send({"id": "l1", "type": "listFolder"})
    reply = test_fs_engine.read()
    assert_valid(reply)
    assert reply["id"] == "l1" and reply["type"] == "folderListing"
    assert reply["path"] == str(test_fs_engine.documents)  # type: ignore[attr-defined]
    assert sorted(e["name"] for e in reply["entries"]) == ["Budget תקציב.pdf", "Photos", "סיכום ישיבה 3.docx"]
    assert test_fs_engine.close() == 0
    assert no_schema_violations(tmp_path)


def test_list_folder_with_path_sends_hebrew_names_as_utf8(engine: Engine, tmp_path: Path) -> None:
    docs = make_documents(tmp_path)
    engine.send({"id": "l2", "type": "listFolder", "path": str(docs)})
    raw = engine.read_raw()
    assert "סיכום ישיבה 3.docx".encode("utf-8") in raw
    reply = json.loads(raw.decode("utf-8"))
    assert_valid(reply)
    by_name = {e["name"]: e for e in reply["entries"]}
    assert by_name["סיכום ישיבה 3.docx"]["typeCode"] == "word"
    assert by_name["סיכום ישיבה 3.docx"]["size"] == 38912
    assert by_name["Photos"]["kind"] == "folder"
    assert "~$סיכום ישיבה 3.docx" not in by_name


def test_missing_folder_is_folder_not_found(engine: Engine, tmp_path: Path) -> None:
    engine.send({"id": "l3", "type": "listFolder", "path": str(tmp_path / "gone")})
    assert engine.read() == {"id": "l3", "type": "error", "code": "folderNotFound", "data": {}}
    engine.send({"id": "l4", "type": "ping"})
    assert engine.read() == {"id": "l4", "type": "pong"}


def test_denied_folder_is_access_denied(engine: Engine, tmp_path: Path) -> None:
    denied = tmp_path / "denied"
    denied.mkdir()
    subprocess.run(["icacls", str(denied), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)
    try:
        engine.send({"id": "l5", "type": "listFolder", "path": str(denied).upper()})
        reply = engine.read()
        assert_valid(reply)
        assert (reply["id"], reply["type"], reply["code"]) == ("l5", "error", "accessDenied")
        # The folder exists, so its normalized place rides along for Up and the breadcrumb.
        assert reply["data"]["path"] == str(denied)
        assert reply["data"]["parent"] == str(tmp_path)
        assert reply["data"]["segments"][-1] == {"kind": "folder", "name": "denied", "path": str(denied)}
        # A code and the folder's place only: no OS message, error number or traceback.
        assert set(reply) == {"id", "type", "code", "data"}
        assert set(reply["data"]) == {"path", "parent", "segments"}
        text = json.dumps(reply, ensure_ascii=False)
        for leak in ["Traceback", "Error", "Access is denied", "WinError", "errno", "[Errno"]:
            assert leak not in text, leak
        engine.send({"id": "l5b", "type": "ping"})
        assert engine.read() == {"id": "l5b", "type": "pong"}
    finally:
        subprocess.run(["icacls", str(denied), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)


def test_list_folder_with_bad_path_type_is_invalid(engine: Engine) -> None:
    engine.send({"id": "l6", "type": "listFolder", "path": 5})
    assert engine.read() == {"id": "l6", "type": "error", "code": "invalidRequest", "data": {}}


def test_newer_list_folder_cancels_the_running_one(test_fs_engine: Engine, tmp_path: Path) -> None:
    test_fs_engine.send({"id": "s1", "type": "listFolder", "path": "SLOW"})
    test_fs_engine.send({"id": "s2", "type": "listFolder", "path": "SLOW"})
    test_fs_engine.send({"id": "s3", "type": "listFolder"})
    assert test_fs_engine.read() == {"id": "s1", "type": "cancelled"}
    assert test_fs_engine.read() == {"id": "s2", "type": "cancelled"}
    latest = test_fs_engine.read()
    assert latest["id"] == "s3" and latest["type"] == "folderListing"
    assert test_fs_engine.close() == 0
    assert no_schema_violations(tmp_path)


def test_a_listing_stuck_in_the_os_does_not_hold_up_the_next_one(test_fs_engine: Engine, tmp_path: Path) -> None:
    test_fs_engine.send({"id": "h1", "type": "listFolder", "path": "HANG"})
    time.sleep(0.2)  # the stuck listing is under way
    sent = time.monotonic()
    test_fs_engine.send({"id": "h2", "type": "listFolder"})
    assert test_fs_engine.read(timeout=3.0) == {"id": "h1", "type": "cancelled"}
    latest = test_fs_engine.read(timeout=3.0)
    assert latest["id"] == "h2" and latest["type"] == "folderListing"
    assert time.monotonic() - sent < 2.0
    # The engine still exits cleanly with the abandoned thread blocked, and h1 got one reply only.
    assert test_fs_engine.close() == 0
    assert test_fs_engine.lines.empty()
    assert no_schema_violations(tmp_path)
    # h1 really was stuck and abandoned, not cancelled while still queued.
    assert "abandoned a listFolder" in (tmp_path / "engine.log").read_text(encoding="utf-8")


def test_ping_is_answered_while_a_listing_runs(test_fs_engine: Engine) -> None:
    test_fs_engine.send({"id": "s1", "type": "listFolder", "path": "SLOW"})
    time.sleep(0.3)  # the listing is well under way
    sent = time.monotonic()
    test_fs_engine.send({"id": "p1", "type": "ping"})
    assert test_fs_engine.read(timeout=2.0) == {"id": "p1", "type": "pong"}
    assert time.monotonic() - sent < 1.0
    # Closing stdin cancels the listing: it still ends with exactly one terminal reply.
    assert test_fs_engine.close() == 0
    assert test_fs_engine.read() == {"id": "s1", "type": "cancelled"}
    assert test_fs_engine.lines.empty()


# ----- navigation (spec 1.5 I/O matrix) ------------------------------------


def test_a_typed_path_is_normalized(test_fs_engine: Engine, tmp_path: Path) -> None:
    docs: Path = test_fs_engine.documents  # type: ignore[attr-defined]
    typed = f'  "{str(docs / "Photos").lower()}\\"  '
    test_fs_engine.send({"id": "t1", "type": "listFolder", "path": typed})
    reply = test_fs_engine.read()
    assert_valid(reply)
    assert reply["path"] == str(docs / "Photos")  # on-disk casing, no quotes or trailing backslash
    assert reply["parent"] == str(docs)
    assert reply["segments"] == [
        {"kind": "knownFolder", "code": "documents", "path": str(docs)},
        {"kind": "folder", "name": "Photos", "path": str(docs / "Photos")},
    ]
    assert test_fs_engine.close() == 0
    assert no_schema_violations(tmp_path)


@pytest.mark.parametrize("path", ["relative\\folder", "C:\\a<b", "C:"])
def test_relative_and_invalid_paths_are_folder_not_found(engine: Engine, path: str) -> None:
    engine.send({"id": "t2", "type": "listFolder", "path": path})
    assert engine.read() == {"id": "t2", "type": "error", "code": "folderNotFound", "data": {}}


def test_a_drive_that_is_not_ready_is_folder_unavailable(test_fs_engine: Engine) -> None:
    test_fs_engine.send({"id": "t3", "type": "listFolder", "path": "NOTREADY"})
    assert test_fs_engine.read() == {"id": "t3", "type": "error", "code": "folderUnavailable", "data": {}}


def test_a_drive_root_has_no_parent_and_one_drive_segment(engine: Engine) -> None:
    system_root = os.environ.get("SystemDrive", "C:") + "\\"
    engine.send({"id": "t4", "type": "listFolder", "path": system_root.lower()})
    reply = engine.read(timeout=20.0)
    assert_valid(reply)
    assert reply["path"] == system_root.upper()
    assert reply["parent"] is None
    assert [s["kind"] for s in reply["segments"]] == ["drive"]
    assert reply["segments"][0]["letter"] == system_root[0].upper()


def test_list_locations_replies_with_known_folders_and_drives(test_fs_engine: Engine, tmp_path: Path) -> None:
    test_fs_engine.send({"id": "n1", "type": "listLocations"})
    reply = test_fs_engine.read(timeout=20.0)
    assert_valid(reply)
    assert reply["id"] == "n1" and reply["type"] == "locations"
    assert reply["knownFolders"] == [{"code": "documents", "path": str(test_fs_engine.documents)}]  # type: ignore[attr-defined]
    system_letter = os.environ.get("SystemDrive", "C:")[0].upper()
    assert system_letter in [d["letter"] for d in reply["drives"]]
    assert test_fs_engine.close() == 0
    assert no_schema_violations(tmp_path)


# ----- showInFolder (spec 1.6 I/O matrix) ----------------------------------


def test_show_in_folder_lists_the_folder_with_the_item_selected(test_fs_engine: Engine, tmp_path: Path) -> None:
    docs: Path = test_fs_engine.documents  # type: ignore[attr-defined]
    test_fs_engine.send({"id": "f1", "type": "showInFolder", "path": str(docs / "budget תקציב.PDF").lower()})
    reply = test_fs_engine.read()
    assert_valid(reply)
    assert (reply["id"], reply["type"], reply["path"]) == ("f1", "folderListing", str(docs))
    assert reply["selected"] == "Budget תקציב.pdf"
    # A gone item still lists its folder, with nothing selected; a hidden lock file isn't listed.
    for i, name in enumerate(["gone.txt", "~$סיכום ישיבה 3.docx"]):
        test_fs_engine.send({"id": f"f{i + 2}", "type": "showInFolder", "path": str(docs / name)})
        reply = test_fs_engine.read()
        assert_valid(reply)
        assert reply["path"] == str(docs) and "selected" not in reply
    assert test_fs_engine.close() == 0
    assert no_schema_violations(tmp_path)


def test_show_in_folder_of_a_root_or_a_missing_folder_is_folder_not_found(engine: Engine, tmp_path: Path) -> None:
    system_root = os.environ.get("SystemDrive", "C:") + "\\"
    for i, path in enumerate([system_root, str(tmp_path / "gone" / "a.txt")]):
        engine.send({"id": f"g{i}", "type": "showInFolder", "path": path})
        assert engine.read() == {"id": f"g{i}", "type": "error", "code": "folderNotFound", "data": {}}


def test_show_in_folder_in_a_folder_that_cannot_be_listed_carries_its_place(engine: Engine, tmp_path: Path) -> None:
    denied = tmp_path / "denied"
    denied.mkdir()
    (denied / "a.txt").write_bytes(b"")
    subprocess.run(["icacls", str(denied), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)
    try:
        # The folder can't name its items (traverse rights only), so listing it decides.
        engine.send({"id": "g5", "type": "showInFolder", "path": str(denied / "a.txt").upper()})
        reply = engine.read()
        assert_valid(reply)
        assert (reply["id"], reply["type"], reply["code"]) == ("g5", "error", "accessDenied")
        assert reply["data"]["path"] == str(denied)
        assert reply["data"]["parent"] == str(tmp_path)
    finally:
        subprocess.run(["icacls", str(denied), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)


def test_show_in_folder_without_a_path_is_invalid(engine: Engine) -> None:
    engine.send({"id": "g9", "type": "showInFolder"})
    assert engine.read() == {"id": "g9", "type": "error", "code": "invalidRequest", "data": {}}


def test_show_in_folder_and_list_folder_cancel_each_other(test_fs_engine: Engine, tmp_path: Path) -> None:
    docs: Path = test_fs_engine.documents  # type: ignore[attr-defined]
    test_fs_engine.send({"id": "c1", "type": "listFolder", "path": "SLOW"})
    test_fs_engine.send({"id": "c2", "type": "showInFolder", "path": str(docs / "Photos")})
    assert test_fs_engine.read() == {"id": "c1", "type": "cancelled"}
    reply = test_fs_engine.read()
    assert (reply["id"], reply["type"], reply["selected"]) == ("c2", "folderListing", "Photos")
    # And the other way round: a listing replaces a Show in folder that is still queued.
    test_fs_engine.send({"id": "c3", "type": "listFolder", "path": "SLOW"})
    test_fs_engine.send({"id": "c4", "type": "showInFolder", "path": str(docs / "Photos")})
    test_fs_engine.send({"id": "c5", "type": "listFolder"})
    assert test_fs_engine.read() == {"id": "c3", "type": "cancelled"}
    assert test_fs_engine.read() == {"id": "c4", "type": "cancelled"}
    latest = test_fs_engine.read()
    assert (latest["id"], latest["type"]) == ("c5", "folderListing") and "selected" not in latest
    assert test_fs_engine.close() == 0
    assert no_schema_violations(tmp_path)


# ----- search (spec 2.1 I/O matrix) ------------------------------------------


def read_search(engine: Engine, request_id: str, timeout: float = 10.0) -> list[dict]:
    """Every reply on `request_id` up to and including its terminal one."""
    replies: list[dict] = []
    while True:
        reply = engine.read(timeout=timeout)
        assert reply["id"] == request_id, reply
        replies.append(reply)
        if reply["type"] not in ("searchParsed", "nameMatches"):
            return replies


def test_search_finds_names_in_the_folder_and_its_subfolders(engine: Engine, tmp_path: Path) -> None:
    docs = tmp_path / "Docs"
    deep = docs / "a" / "b" / "c"
    deep.mkdir(parents=True)
    for name in ["report.pdf", "photo.jpg", "report-final.docx", "דוח שנתי.docx", "~$report.docx"]:
        (docs / name).write_bytes(b"")
    (deep / "Old REPORT.txt").write_bytes(b"")
    (docs / "reports").mkdir()

    engine.send({"id": "q1", "type": "search", "text": "  report ", "folder": str(docs).lower()})
    replies = read_search(engine, "q1")
    for reply in replies:
        assert_valid(reply)
    assert [r["type"] for r in replies] == ["searchParsed", "nameMatches", "searchDone"]
    assert replies[0] == {"id": "q1", "type": "searchParsed", "mode": "normal", "dateRange": None, "residualText": "report"}
    by_name = {m["name"]: m for m in replies[1]["matches"]}
    assert sorted(by_name) == ["Old REPORT.txt", "report-final.docx", "report.pdf", "reports"]
    assert by_name["Old REPORT.txt"]["path"] == str(deep / "Old REPORT.txt")
    assert by_name["Old REPORT.txt"]["folder"] == str(deep)
    assert by_name["reports"]["kind"] == "folder"
    assert replies[-1] == {"id": "q1", "type": "searchDone", "notices": [], "indexVersion": None, "indexingActive": False}

    engine.send({"id": "q2", "type": "search", "text": "דוח", "folder": str(docs)})
    replies = read_search(engine, "q2")
    assert [m["name"] for m in replies[1]["matches"]] == ["דוח שנתי.docx"]

    engine.send({"id": "q3", "type": "search", "text": "xyz123", "folder": str(docs)})
    replies = read_search(engine, "q3")
    for reply in replies:
        assert_valid(reply)
    assert [r["type"] for r in replies] == ["searchParsed", "nameMatches", "searchDone"]
    assert replies[1]["matches"] == []
    assert replies[-1]["outcomeCode"] == "noMatches"  # EARS-03: the engine decides

    assert engine.close() == 0
    log_text = (tmp_path / "engine.log").read_text(encoding="utf-8")
    assert "violates its schema" not in log_text
    for text in ["דוח", "xyz123"]:
        assert text not in log_text  # the search text is never logged


def test_correct_display_names_come_back_unchanged(engine: Engine, tmp_path: Path) -> None:
    """Every Correct Display name and folder, built on disk and searched, comes back as written."""
    root = tmp_path / "Correct Display"
    entries = json.loads(CORRECT_DISPLAY.read_text(encoding="utf-8"))["entries"]
    assert len(entries) >= 10
    expected: dict[str, tuple[str, str]] = {}
    for entry in entries:
        folder = root.joinpath(*entry["segments"])
        folder.mkdir(parents=True, exist_ok=True)
        item = folder / entry["name"]
        if entry["kind"] == "folder":
            item.mkdir()
        else:
            item.write_bytes(b"")
        expected[str(item)] = (entry["kind"], str(folder))

    engine.send({"id": "cd1", "type": "search", "text": ".", "folder": str(root)})
    replies = read_search(engine, "cd1")
    for reply in replies:
        assert_valid(reply)
    assert replies[-1]["type"] == "searchDone" and "outcomeCode" not in replies[-1]
    matches = [m for r in replies if r["type"] == "nameMatches" for m in r["matches"]]
    got = {m["path"]: (m["kind"], m["folder"]) for m in matches}
    assert got == expected
    for match in matches:
        assert match["path"] == match["folder"] + "\\" + match["name"]
    assert sorted(m["name"] for m in matches) == sorted(e["name"] for e in entries)


def test_search_in_a_missing_folder_is_folder_not_found(engine: Engine, tmp_path: Path) -> None:
    engine.send({"id": "q4", "type": "search", "text": "secret-words", "folder": str(tmp_path / "gone")})
    assert engine.read() == {"id": "q4", "type": "error", "code": "folderNotFound", "data": {}}
    assert engine.close() == 0
    log_text = (tmp_path / "engine.log").read_text(encoding="utf-8")
    assert "search: folderNotFound" in log_text  # the folder-error path did log
    assert "secret-words" not in log_text  # and the search text is never logged


def test_search_with_blank_text_is_invalid(engine: Engine, tmp_path: Path) -> None:
    engine.send({"id": "q5", "type": "search", "text": "   ", "folder": str(tmp_path)})
    assert engine.read() == {"id": "q5", "type": "error", "code": "invalidRequest", "data": {}}


def test_a_newer_search_replaces_the_running_one(test_fs_engine: Engine, tmp_path: Path) -> None:
    docs: Path = test_fs_engine.documents  # type: ignore[attr-defined]
    test_fs_engine.send({"id": "r1", "type": "search", "text": "f1", "folder": "SLOW"})
    time.sleep(0.2)  # the first search is under way
    test_fs_engine.send({"id": "r2", "type": "search", "text": "budget", "folder": str(docs)})
    assert test_fs_engine.read() == {"id": "r1", "type": "cancelled"}
    replies = read_search(test_fs_engine, "r2")
    assert [r["type"] for r in replies] == ["searchParsed", "nameMatches", "searchDone"]
    assert [m["name"] for m in replies[1]["matches"]] == ["Budget תקציב.pdf"]
    # A search never holds up a listing: they are on different channels.
    test_fs_engine.send({"id": "r3", "type": "search", "text": "f1", "folder": "SLOW"})
    test_fs_engine.send({"id": "r4", "type": "listFolder"})
    assert test_fs_engine.read()["id"] == "r4"
    assert test_fs_engine.close() == 0
    assert test_fs_engine.read() == {"id": "r3", "type": "cancelled"}
    assert test_fs_engine.lines.empty()
    assert no_schema_violations(tmp_path)


# ----- cancel and the permission notice (spec 2.3 I/O matrix) ---------------------


def make_slow_tree(tmp_path: Path, folders: int = 200) -> Path:
    """A real tree whose walk takes seconds under TEST_FS_SCRIPT: a match in every folder."""
    root = tmp_path / "SLOWTREE"
    root.mkdir()
    (root / "report.txt").write_bytes(b"")
    for i in range(folders):
        sub = root / f"sub {i:03}"
        sub.mkdir()
        (sub / f"report {i:03}.txt").write_bytes(b"")
    return root


def test_a_cancel_stops_a_running_search_with_cancelled_and_no_search_done(test_fs_engine: Engine, tmp_path: Path) -> None:
    root = make_slow_tree(tmp_path)
    test_fs_engine.send({"id": "k1", "type": "search", "text": "report", "folder": str(root)})
    assert test_fs_engine.read()["type"] == "searchParsed"
    first = test_fs_engine.read()  # the first batch, a quarter second into the walk
    assert (first["id"], first["type"]) == ("k1", "nameMatches") and first["matches"]
    # The cancel shares the search's id and has no reply of its own: cancelled answers both.
    test_fs_engine.send({"id": "k1", "type": "cancel"})
    rest = read_search(test_fs_engine, "k1")
    assert rest[-1] == {"id": "k1", "type": "cancelled"}
    assert {r["type"] for r in rest[:-1]} <= {"nameMatches"}  # at most a batch already on its way
    found = len(first["matches"]) + sum(len(r["matches"]) for r in rest[:-1])
    assert found < 100  # the walk stopped early: the whole tree holds 201 matches
    # Nothing more arrives for k1: the next reply is the ping's.
    test_fs_engine.send({"id": "k2", "type": "ping"})
    assert test_fs_engine.read() == {"id": "k2", "type": "pong"}
    assert test_fs_engine.close() == 0
    assert test_fs_engine.lines.empty()
    assert no_schema_violations(tmp_path)
    assert "report" not in (tmp_path / "engine.log").read_text(encoding="utf-8")  # the text is never logged


def test_a_cancel_for_a_finished_or_unknown_id_does_nothing(engine: Engine, tmp_path: Path) -> None:
    docs = make_documents(tmp_path)
    engine.send({"id": "k3", "type": "search", "text": "budget", "folder": str(docs)})
    assert read_search(engine, "k3")[-1]["type"] == "searchDone"
    # The race: the search finished before its cancel arrived. The engine ignores the cancel.
    engine.send({"id": "k3", "type": "cancel"})
    engine.send({"id": "nobody", "type": "cancel"})
    engine.send({"id": "k4", "type": "ping"})
    assert engine.read() == {"id": "k4", "type": "pong"}
    assert engine.close() == 0
    assert engine.lines.empty()
    assert no_schema_violations(tmp_path)


def test_a_cancel_violating_its_schema_is_rejected_with_no_id(test_fs_engine: Engine) -> None:
    test_fs_engine.send({"id": "k5", "type": "search", "text": "f1", "folder": "SLOW"})
    test_fs_engine.send({"id": "k5", "type": "cancel", "reason": "esc"})
    # Never on the target's id: the running search with that id must get one terminal reply only.
    assert test_fs_engine.read() == {"id": None, "type": "error", "code": "invalidRequest", "data": {}}
    test_fs_engine.send({"id": "k5b", "type": "ping"})
    assert test_fs_engine.read() == {"id": "k5b", "type": "pong"}  # the search is still running
    assert test_fs_engine.close() == 0
    assert test_fs_engine.read() == {"id": "k5", "type": "cancelled"}  # its one terminal reply
    assert test_fs_engine.lines.empty()


def test_a_cancel_stops_only_the_request_with_its_id_on_any_channel(test_fs_engine: Engine, tmp_path: Path) -> None:
    test_fs_engine.send({"id": "k6", "type": "listFolder", "path": "SLOW"})
    test_fs_engine.send({"id": "k7", "type": "cancel"})  # an id no channel is running
    test_fs_engine.send({"id": "k8", "type": "ping"})
    assert test_fs_engine.read() == {"id": "k8", "type": "pong"}
    # The cancel for the listing's id stops it, as it would a search: the UI only cancels searches.
    test_fs_engine.send({"id": "k6", "type": "cancel"})
    assert test_fs_engine.read() == {"id": "k6", "type": "cancelled"}
    assert test_fs_engine.close() == 0
    assert test_fs_engine.lines.empty()


def deny_listing(folder: Path) -> None:
    subprocess.run(["icacls", str(folder), "/deny", "*S-1-1-0:(RD)"], check=True, capture_output=True)


def allow_listing(folder: Path) -> None:
    subprocess.run(["icacls", str(folder), "/remove:d", "*S-1-1-0"], check=True, capture_output=True)


def test_a_denied_subfolder_is_skipped_with_the_permission_notice(engine: Engine, tmp_path: Path) -> None:
    docs = tmp_path / "Docs"
    private = docs / "Private"
    private.mkdir(parents=True)
    (docs / "report.pdf").write_bytes(b"")
    (private / "report secret.pdf").write_bytes(b"")
    deny_listing(private)
    try:
        engine.send({"id": "p1", "type": "search", "text": "report", "folder": str(docs)})
        replies = read_search(engine, "p1")
        for reply in replies:
            assert_valid(reply)
        assert [m["name"] for r in replies if r["type"] == "nameMatches" for m in r["matches"]] == ["report.pdf"]
        assert replies[-1] == {
            "id": "p1", "type": "searchDone", "notices": ["permissionSkipped"], "indexVersion": None, "indexingActive": False,
        }
        # Denied and nothing found: the empty outcome and the notice together.
        engine.send({"id": "p2", "type": "search", "text": "xyz123", "folder": str(docs)})
        done = read_search(engine, "p2")[-1]
        assert (done["outcomeCode"], done["notices"]) == ("noMatches", ["permissionSkipped"])
    finally:
        allow_listing(private)


# ----- createFile ------------------------------------------------------------------------------


def test_create_file_creates_an_empty_file_then_refuses_to_overwrite_it(engine: Engine, tmp_path: Path) -> None:
    docs = make_documents(tmp_path)
    engine.send({"id": "c1", "type": "createFile", "folder": str(docs).upper(), "name": "notes תקציב.txt"})
    reply = engine.read()
    assert_valid(reply)
    assert reply == {"id": "c1", "type": "fileCreated", "path": str(docs / "notes תקציב.txt"), "name": "notes תקציב.txt"}
    assert (docs / "notes תקציב.txt").read_bytes() == b""

    (docs / "notes תקציב.txt").write_bytes(b"typed later")
    engine.send({"id": "c2", "type": "createFile", "folder": str(docs), "name": "NOTES תקציב.TXT"})
    assert engine.read() == {"id": "c2", "type": "error", "code": "fileExists", "data": {}}
    assert (docs / "notes תקציב.txt").read_bytes() == b"typed later"

    # The new file is in the next listing, so the UI's refresh shows it.
    engine.send({"id": "c3", "type": "listFolder", "path": str(docs)})
    assert "notes תקציב.txt" in {e["name"] for e in engine.read()["entries"]}
    assert no_schema_violations(tmp_path)
    assert "notes תקציב" not in (tmp_path / "engine.log").read_text(encoding="utf-8")  # the name is never logged


@pytest.mark.parametrize("name", ["", "..", r"..\escaped.txt", "../escaped.txt", r"C:\escaped.txt", "a:b", "CON"])
def test_create_file_rejects_invalid_names_and_path_traversal(engine: Engine, tmp_path: Path, name: str) -> None:
    docs = make_documents(tmp_path)
    before = sorted(p.name for p in tmp_path.rglob("*"))
    engine.send({"id": "c4", "type": "createFile", "folder": str(docs), "name": name})
    assert engine.read() == {"id": "c4", "type": "error", "code": "invalidName", "data": {}}
    assert sorted(p.name for p in tmp_path.rglob("*")) == before


def test_create_file_in_a_missing_folder_is_folder_not_found(engine: Engine, tmp_path: Path) -> None:
    engine.send({"id": "c5", "type": "createFile", "folder": str(tmp_path / "gone"), "name": "notes.txt"})
    assert engine.read() == {"id": "c5", "type": "error", "code": "folderNotFound", "data": {}}
    assert not (tmp_path / "gone").exists()


def test_create_file_runs_beside_a_listing_without_cancelling_it(test_fs_engine: Engine) -> None:
    docs = test_fs_engine.documents  # type: ignore[attr-defined]
    test_fs_engine.send({"id": "c6", "type": "listFolder", "path": "SLOW"})  # still running below
    test_fs_engine.send({"id": "c7", "type": "createFile", "folder": str(docs), "name": "new.txt"})
    assert test_fs_engine.read()["id"] == "c7"  # answered while the listing runs
    assert (docs / "new.txt").is_file()
    test_fs_engine.send({"id": "c6", "type": "cancel"})
    assert test_fs_engine.read() == {"id": "c6", "type": "cancelled"}


# ----- renameFile ------------------------------------------------------------------------------


def test_rename_file_renames_in_place_then_refuses_to_overwrite(engine: Engine, tmp_path: Path) -> None:
    docs = make_documents(tmp_path)
    old = docs / "Budget תקציב.pdf"
    old.write_bytes(b"keep me")
    engine.send({"id": "r1", "type": "renameFile", "path": str(old).upper(), "newName": "תקציב 2026.pdf"})
    reply = engine.read()
    assert_valid(reply)
    assert reply == {"id": "r1", "type": "fileRenamed", "oldPath": str(old), "path": str(docs / "תקציב 2026.pdf"), "name": "תקציב 2026.pdf"}
    assert not old.exists()
    assert (docs / "תקציב 2026.pdf").read_bytes() == b"keep me"

    # Onto another file's name (any casing) or a folder's: refused, both left as they were.
    for taken in ["סיכום ישיבה 3.DOCX", "photos"]:
        engine.send({"id": "r2", "type": "renameFile", "path": str(docs / "תקציב 2026.pdf"), "newName": taken})
        assert engine.read() == {"id": "r2", "type": "error", "code": "fileExists", "data": {}}
    assert (docs / "סיכום ישיבה 3.docx").read_bytes() == b"x" * 38912
    assert (docs / "Photos").is_dir()

    # The renamed file is in the next listing, so the UI's refresh shows it.
    engine.send({"id": "r3", "type": "listFolder", "path": str(docs)})
    names = {e["name"] for e in engine.read()["entries"]}
    assert "תקציב 2026.pdf" in names and "Budget תקציב.pdf" not in names
    assert no_schema_violations(tmp_path)
    log_text = (tmp_path / "engine.log").read_text(encoding="utf-8")
    assert "renameFile" in log_text  # the requests were logged, by code only:
    assert "תקציב" not in log_text and "Budget" not in log_text  # neither name ever is


@pytest.mark.parametrize("name", ["", "..", r"..\escaped.pdf", "../escaped.pdf", r"Photos\moved.pdf", r"C:\escaped.pdf", "a:b", "CON"])
def test_rename_file_rejects_invalid_names_and_never_moves_the_file(engine: Engine, tmp_path: Path, name: str) -> None:
    docs = make_documents(tmp_path)
    before = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*"))
    engine.send({"id": "r4", "type": "renameFile", "path": str(docs / "Budget תקציב.pdf"), "newName": name})
    assert engine.read() == {"id": "r4", "type": "error", "code": "invalidName", "data": {}}
    assert sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*")) == before


@pytest.mark.parametrize("target", ["Photos", "gone.pdf", r"gone\Budget תקציב.pdf"])
def test_rename_file_of_a_folder_or_a_missing_file_is_file_not_found(engine: Engine, tmp_path: Path, target: str) -> None:
    docs = make_documents(tmp_path)
    engine.send({"id": "r5", "type": "renameFile", "path": str(docs / target), "newName": "renamed"})
    assert engine.read() == {"id": "r5", "type": "error", "code": "fileNotFound", "data": {}}
    assert (docs / "Photos").is_dir() and not (docs / "renamed").exists()


def test_rename_file_of_a_file_in_use_is_file_in_use(engine: Engine, tmp_path: Path) -> None:
    docs = make_documents(tmp_path)
    with open(docs / "Budget תקציב.pdf", "rb"):
        engine.send({"id": "r6", "type": "renameFile", "path": str(docs / "Budget תקציב.pdf"), "newName": "x.pdf"})
        assert engine.read() == {"id": "r6", "type": "error", "code": "fileInUse", "data": {}}
    assert (docs / "Budget תקציב.pdf").exists()


def test_rename_file_runs_beside_a_listing_without_cancelling_it(test_fs_engine: Engine) -> None:
    docs = test_fs_engine.documents  # type: ignore[attr-defined]
    (docs / "old.txt").write_bytes(b"")
    test_fs_engine.send({"id": "r7", "type": "listFolder", "path": "SLOW"})  # still running below
    test_fs_engine.send({"id": "r8", "type": "renameFile", "path": str(docs / "old.txt"), "newName": "new.txt"})
    assert test_fs_engine.read()["id"] == "r8"  # answered while the listing runs
    assert (docs / "new.txt").is_file()
    test_fs_engine.send({"id": "r7", "type": "cancel"})
    assert test_fs_engine.read() == {"id": "r7", "type": "cancelled"}


# ----- preview (spec 2.5 I/O matrix) -------------------------------------------------------------

def make_png(width: int = 4, height: int = 3) -> bytes:
    """A real PNG: 8-bit RGB, every pixel blue, with valid chunk CRCs."""
    import struct
    import zlib

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = b"".join(b"\x00" + b"\x00\x00\xff" * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


PNG = make_png()


def test_preview_sends_a_real_png_and_the_first_lines_of_a_txt(engine: Engine, tmp_path: Path) -> None:
    import base64

    docs = make_documents(tmp_path)
    (docs / "photo.png").write_bytes(PNG)
    (docs / "סיכום ישיבה.txt").write_bytes("﻿שורה ראשונה\nsecond line\n".encode("utf-8") + b"z" * 5000)

    engine.send({"id": "p1", "type": "preview", "path": str(docs / "PHOTO.PNG")})
    reply = engine.read()
    assert_valid(reply)
    assert reply["id"] == "p1" and reply["type"] == "previewReady"
    assert reply["details"]["name"] == "photo.png" and reply["details"]["path"] == str(docs / "photo.png")
    assert (reply["details"]["typeCode"], reply["details"]["size"]) == ("image", len(PNG))
    assert reply["thumbnail"]["kind"] == "image" and reply["thumbnail"]["mime"] == "image/png"
    assert base64.b64decode(reply["thumbnail"]["data"]) == PNG
    assert "outcomeCode" not in reply

    engine.send({"id": "p2", "type": "preview", "path": str(docs / "סיכום ישיבה.txt")})
    raw = engine.read_raw()
    assert "שורה ראשונה".encode("utf-8") in raw
    reply = json.loads(raw.decode("utf-8"))
    assert_valid(reply)
    text = reply["thumbnail"]["text"]
    assert text.startswith("שורה ראשונה\nsecond line\n")  # the BOM dropped
    assert len(text.encode("utf-8")) == 2048 - 3  # the first 2,048 bytes, less the BOM
    # Reading changed nothing, and nothing read is in the log: only the path and the outcome.
    assert (docs / "photo.png").read_bytes() == PNG
    assert engine.close() == 0
    log = (tmp_path / "engine.log").read_text(encoding="utf-8")
    assert "שורה ראשונה" not in log and "second line" not in log
    assert no_schema_violations(tmp_path)


def test_preview_of_other_types_and_unreadable_files_is_a_page(engine: Engine, tmp_path: Path) -> None:
    docs = make_documents(tmp_path)
    engine.send({"id": "p3", "type": "preview", "path": str(docs / "Budget תקציב.pdf")})
    reply = engine.read()
    assert_valid(reply)
    assert (reply["thumbnail"], "outcomeCode" in reply) == ({"kind": "page"}, False)
    assert reply["details"]["typeCode"] == "pdf"

    engine.send({"id": "p4", "type": "preview", "path": str(docs / "gone.txt")})
    reply = engine.read()
    assert_valid(reply)
    assert reply == {
        "id": "p4",
        "type": "previewReady",
        "details": {"name": "gone.txt", "path": str(docs / "gone.txt"), "typeCode": "text", "size": None, "modified": None},
        "thumbnail": {"kind": "page"},
        "outcomeCode": "cannotRead",
    }


def test_preview_of_an_image_over_ten_megabytes_is_too_large(engine: Engine, tmp_path: Path) -> None:
    big = tmp_path / "big.jpg"
    with open(big, "wb") as file:
        file.truncate(12 * 1024 * 1024)  # sparse-sized: only the size matters
    engine.send({"id": "p5", "type": "preview", "path": str(big)})
    reply = engine.read()
    assert_valid(reply)
    assert (reply["thumbnail"], reply["outcomeCode"]) == ({"kind": "page"}, "tooLarge")


def test_a_preview_past_its_deadline_cannot_be_read(test_fs_engine: Engine) -> None:
    docs = test_fs_engine.documents  # type: ignore[attr-defined]
    (docs / "SLOWREAD.png").write_bytes(b"")
    started = time.monotonic()
    test_fs_engine.send({"id": "p6", "type": "preview", "path": str(docs / "SLOWREAD.png")})
    reply = test_fs_engine.read(timeout=10)
    assert (reply["id"], reply["thumbnail"], reply["outcomeCode"]) == ("p6", {"kind": "page"}, "cannotRead")
    assert 1.5 < time.monotonic() - started < 5


def test_a_newer_preview_replaces_the_running_one_and_leaves_a_listing_alone(test_fs_engine: Engine) -> None:
    docs = test_fs_engine.documents  # type: ignore[attr-defined]
    (docs / "SLOWREAD.png").write_bytes(b"")
    (docs / "notes.txt").write_bytes(b"hello")
    test_fs_engine.send({"id": "l9", "type": "listFolder", "path": "SLOW"})  # still running below
    test_fs_engine.send({"id": "p7", "type": "preview", "path": str(docs / "SLOWREAD.png")})
    time.sleep(0.1)
    test_fs_engine.send({"id": "p8", "type": "preview", "path": str(docs / "notes.txt")})
    assert test_fs_engine.read() == {"id": "p7", "type": "cancelled"}
    reply = test_fs_engine.read()
    assert reply["id"] == "p8" and reply["thumbnail"] == {"kind": "text", "text": "hello"}
    test_fs_engine.send({"id": "l9", "type": "cancel"})
    assert test_fs_engine.read() == {"id": "l9", "type": "cancelled"}


def test_preview_without_a_path_is_invalid(engine: Engine) -> None:
    engine.send({"id": "p9", "type": "preview"})
    assert engine.read() == {"id": "p9", "type": "error", "code": "invalidRequest", "data": {}}
