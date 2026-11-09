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
# cancel token, and whose "NOTREADY" folder is on a drive that isn't ready.
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
        return self._slow() if path == "SLOW" else super().list(path)

    def _hang(self):
        # Blocked as if inside scandir on a dead share: never checks its cancel token.
        time.sleep(60)
        yield from ()

    def _slow(self):
        for i in range(10**6):
            time.sleep(0.001)
            yield FsEntry(f"f{i}.txt", False, 1, None, 0x20, 0)

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
