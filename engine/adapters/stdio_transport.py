"""stdin/stdout JSON-lines transport between the Tauri shell and the engine (AD-2).

- One UTF-8 JSON object per line in both directions, flushed per line.
- The real stdout is privately duplicated and reserved for protocol lines.
  fd 1 and ``sys.stdout`` are redirected into a pipe that is drained into the
  log, so a stray ``print()`` (or a native library writing to fd 1) can never
  corrupt the protocol stream.
- All protocol output goes through one queue drained by one writer thread.
- ``ping`` is answered here: it is transport, not a product rule. ``status`` is a
  fixed placeholder here until indexing arrives.
"""

from __future__ import annotations

import io
import json
import logging
import os
import queue
import sys
import threading
from pathlib import Path
from typing import Any, BinaryIO, Callable

PROTOCOL_VERSION = 1

UNKNOWN_REQUEST = "unknownRequest"
INVALID_REQUEST = "invalidRequest"

PROTOCOL_DIR = Path(__file__).resolve().parents[2] / "protocol"

log = logging.getLogger("fb2.transport")
stray_log = logging.getLogger("fb2.stdout")

Message = dict[str, Any]
Handler = Callable[[Message], Message]


def handle_ping(request: Message) -> Message:
    reply: Message = {"id": request["id"], "type": "pong"}
    if "text" in request:
        reply["text"] = request["text"]
    return reply


def handle_status(request: Message) -> Message:
    # Placeholder snapshot until indexing exists (AD-16): nothing is running and nothing is indexed.
    return {"id": request["id"], "type": "statusReport", "phase": "idle", "documentCount": 0}


# Dispatch table: request type -> handler returning the terminal reply.
HANDLERS: dict[str, Handler] = {
    "ping": handle_ping,
    "status": handle_status,
}


def error(request_id: str | None, code: str) -> Message:
    return {"id": request_id, "type": "error", "code": code, "data": {}}


def encode(message: Message) -> bytes:
    """Serialize one message as a single UTF-8 JSON line (raises on lone surrogates)."""
    text = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
    return text.encode("utf-8") + b"\n"


class SchemaValidator:
    """Validates messages against protocol/schemas (debug builds only; jsonschema is a dev dependency)."""

    def __init__(self, protocol_dir: Path = PROTOCOL_DIR) -> None:
        import jsonschema  # noqa: PLC0415 - dev-only dependency, imported only when enabled

        self._validators: dict[str, Any] = {}
        for path in sorted((protocol_dir / "schemas").glob("*.schema.json")):
            schema = json.loads(path.read_text(encoding="utf-8"))
            message_type = path.name.removesuffix(".schema.json")
            self._validators[message_type] = jsonschema.Draft7Validator(schema)

    def problem(self, message: Message) -> str | None:
        """Return a short description of the first schema violation, or None if valid."""
        validator = self._validators.get(message.get("type"))  # type: ignore[arg-type]
        if validator is None:
            return f"no schema for type {message.get('type')!r}"
        err = next(iter(validator.iter_errors(message)), None)
        if err is None:
            return None
        where = "/".join(str(p) for p in err.absolute_path) or "(root)"
        return f"{err.validator} failed at {where}"


def _set_binary(fd: int) -> None:
    if sys.platform == "win32":
        import msvcrt  # noqa: PLC0415

        msvcrt.setmode(fd, os.O_BINARY)


class StdioTransport:
    def __init__(self, stdin: BinaryIO, protocol_out: BinaryIO, validator: SchemaValidator | None) -> None:
        self._stdin = stdin
        self._out = protocol_out
        self._validator = validator
        self._queue: queue.Queue[Message | None] = queue.Queue()
        self._writer = threading.Thread(target=self._write_loop, name="protocol-writer", daemon=True)
        self._drain: threading.Thread | None = None

    # ----- setup / teardown -------------------------------------------------

    @classmethod
    def open(cls, validate: bool = False) -> StdioTransport:
        """Take over the process's stdin/stdout. Call before anything else writes to stdout."""
        if sys.stdout is not None:
            sys.stdout.flush()

        # Private duplicate of the real stdout: the only place protocol lines go.
        protocol_fd = os.dup(1)
        _set_binary(protocol_fd)
        protocol_out = os.fdopen(protocol_fd, "wb")

        # fd 1 (and so sys.stdout) now feeds a pipe that is drained into the log.
        read_fd, write_fd = os.pipe()
        os.dup2(write_fd, 1)
        os.close(write_fd)
        sys.stdout = io.TextIOWrapper(
            io.FileIO(1, "w", closefd=False), encoding="utf-8", errors="backslashreplace", line_buffering=True
        )

        _set_binary(0)
        if sys.stdin is not None and hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8")
        stdin = sys.stdin.buffer if sys.stdin is not None else os.fdopen(0, "rb", closefd=False)

        validator = SchemaValidator() if validate else None
        transport = cls(stdin, protocol_out, validator)
        transport._drain = threading.Thread(
            target=_drain_to_log, args=(read_fd,), name="stdout-to-log", daemon=True
        )
        transport._drain.start()
        transport._writer.start()
        log.info("transport open (validate=%s)", validate)
        return transport

    def close(self) -> None:
        """Flush pending protocol output and stop the helper threads."""
        self._queue.put(None)
        self._writer.join(timeout=5)
        try:
            self._out.close()
        except OSError:
            pass
        if self._drain is not None:
            sys.stdout.flush()
            # Point fd 1 at the null device: that closes the pipe's last write end,
            # so the drain thread reads EOF after logging what is left.
            null_fd = os.open(os.devnull, os.O_WRONLY)
            os.dup2(null_fd, 1)
            os.close(null_fd)
            self._drain.join(timeout=5)
        log.info("transport closed")

    # ----- output -----------------------------------------------------------

    def send(self, message: Message) -> None:
        self._queue.put(message)

    def _write_loop(self) -> None:
        while True:
            message = self._queue.get()
            if message is None:
                return
            try:
                if self._validator is not None:
                    problem = self._validator.problem(message)
                    if problem:
                        log.error("outgoing %s violates its schema: %s", message.get("type"), problem)
                line = encode(message)
            except Exception:
                log.exception("could not encode outgoing %s", message.get("type"))
                request_id = message.get("id")
                line = encode(error(request_id if isinstance(request_id, str) else None, INVALID_REQUEST))
            try:
                self._out.write(line)
                self._out.flush()
            except OSError:
                log.exception("protocol stdout closed")
                return

    # ----- input ------------------------------------------------------------

    def serve_forever(self) -> None:
        """Read requests until stdin closes; reply to each with exactly one terminal message.

        Requests are handled one at a time on this reader thread, and the shell treats a ping
        unanswered within its ping timeout (5 s) as a hang. Any handler that can take longer than
        a few seconds must run off this thread (AD-10).
        """
        for raw in iter(self._stdin.readline, b""):
            reply = self.handle_line(raw)
            if reply is not None:
                self.send(reply)
        log.info("stdin closed")

    def handle_line(self, raw: bytes) -> Message:
        request = _parse(raw)
        if request is None:
            log.warning("invalid request line (%d bytes)", len(raw))
            return error(None, INVALID_REQUEST)

        request_id, request_type = request["id"], request["type"]
        handler = HANDLERS.get(request_type)
        if handler is None:
            log.warning("unknown request type %r", request_type)
            return error(request_id, UNKNOWN_REQUEST)

        if self._validator is not None:
            problem = self._validator.problem(request)
            if problem:
                log.warning("request %s violates its schema: %s", request_type, problem)
                return error(request_id, INVALID_REQUEST)

        try:
            return handler(request)
        except Exception:
            log.exception("handler for %r failed", request_type)
            return error(request_id, INVALID_REQUEST)


def _parse(raw: bytes) -> Message | None:
    """Return the request if it is a JSON object with a string id and string type, else None."""
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(request, dict):
        return None
    if not isinstance(request.get("id"), str) or not request["id"]:
        return None
    if not isinstance(request.get("type"), str) or not request["type"]:
        return None
    try:
        encode(request)  # rejects lone surrogates that could never be echoed back as UTF-8
    except UnicodeEncodeError:
        return None
    return request


def _drain_to_log(read_fd: int) -> None:
    with os.fdopen(read_fd, "rb") as pipe:
        for raw in pipe:
            stray_log.info("stdout: %s", raw.decode("utf-8", errors="replace").rstrip("\r\n"))
