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
    def __init__(self, log_dir: Path, args: list[str] | None = None) -> None:
        env = dict(os.environ, FB2_LOG_DIR=str(log_dir), FB2_VALIDATE_PROTOCOL="1")
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
