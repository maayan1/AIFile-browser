"""stdin/stdout JSON-lines transport between the Tauri shell and the engine (AD-2).

- One UTF-8 JSON object per line in both directions, flushed per line.
- The real stdout is privately duplicated and reserved for protocol lines.
  fd 1 and ``sys.stdout`` are redirected into a pipe that is drained into the
  log, so a stray ``print()`` (or a native library writing to fd 1) can never
  corrupt the protocol stream.
- All protocol output goes through one queue drained by one writer thread.
- ``ping`` is answered here: it is transport, not a product rule. ``status`` is a
  fixed placeholder here until indexing arrives. Both run on the reader thread.
- Long requests run on a channel (AD-10): one worker thread per channel, latest wins. The reader
  thread only queues them, so ``ping`` is answered while a listing runs. A newer request on the
  channel cancels the older one's token, and the older one ends with ``cancelled``; one stuck
  inside an OS call past a short grace period is abandoned to a thread of its own.
"""

from __future__ import annotations

import io
import json
import logging
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any, BinaryIO, Callable

from core.cancel import Cancelled, CancelToken

PROTOCOL_VERSION = 1

UNKNOWN_REQUEST = "unknownRequest"
INVALID_REQUEST = "invalidRequest"

PROTOCOL_DIR = Path(__file__).resolve().parents[2] / "protocol"

log = logging.getLogger("fb2.transport")
stray_log = logging.getLogger("fb2.stdout")

Message = dict[str, Any]
Handler = Callable[[Message], Message]
ChannelHandler = Callable[[Message, CancelToken], Message]


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


def cancelled(request_id: str) -> Message:
    return {"id": request_id, "type": "cancelled"}


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


# How long a cancelled request may keep running before its channel stops waiting for it. A
# listing that is only slow checks its token every few hundred entries and ends well within it;
# one blocked inside an OS call (a dead share, a drive that isn't ready) does not.
ABANDON_AFTER = 0.25

# Abandoned threads still blocked per channel; at the cap the channel waits for the running
# request again instead of starting yet another thread.
MAX_ABANDONED = 8


class _Job:
    """One submitted request. `done` and `abandoned` change only under the channel's lock."""

    def __init__(self, request: Message, handler: ChannelHandler, token: CancelToken) -> None:
        self.request = request
        self.handler = handler
        self.token = token
        self.done = False
        self.abandoned = False


class Channel:
    """One worker thread serving the queue one request at a time, latest wins (AD-10).

    Every submitted request ends with exactly one terminal reply: its handler's reply, an
    ``invalidRequest`` error if the handler fails, or ``cancelled`` if a newer request arrived
    before its reply was queued.

    A cancelled request still running after ``abandon_after`` seconds is abandoned: Python can't
    interrupt a thread inside an OS call, so the channel sends the request's ``cancelled`` reply
    itself, starts a fresh worker for the queue, and drops whatever the stuck thread returns.
    So an abandoned handler can still be running beside the next one on the same channel, as
    handlers on different channels already do: handlers and the ports they share must be
    thread-safe.
    """

    def __init__(
        self,
        name: str,
        send: Callable[[Message], None],
        abandon_after: float = ABANDON_AFTER,
        max_abandoned: int = MAX_ABANDONED,
    ) -> None:
        self.name = name
        self._send = send
        self._abandon_after = abandon_after
        self._max_abandoned = max_abandoned
        self._lock = threading.Lock()
        self._latest: CancelToken | None = None
        self._last_done: CancelToken | None = None  # the token of the last request that ended
        self._running: _Job | None = None
        self._abandoned = 0  # abandoned threads that haven't returned yet
        self._workers = 0  # workers started, for thread names
        self._queue: queue.Queue[_Job | None] = queue.Queue()
        self._thread = self._start_worker()

    def submit(self, request: Message, handler: ChannelHandler) -> None:
        token = CancelToken()
        with self._lock:
            # Every older request was cancelled when its successor arrived, so only the latest
            # can still be live.
            previous = self._latest
            if previous is not None:
                previous.cancel()
            self._latest = token
            # Watch the previous request unless it has already ended (the usual case).
            watch = previous is not None and previous is not self._last_done
        self._queue.put(_Job(request, handler, token))
        if watch:
            # Keyed on the token, not on what runs now: the worker may have taken the previous
            # request off the queue without having marked it running yet.
            timer = threading.Timer(self._abandon_after, self._abandon, args=(previous,))
            timer.daemon = True
            timer.start()

    @property
    def abandoned(self) -> int:
        """How many abandoned threads are still blocked."""
        with self._lock:
            return self._abandoned

    def close(self, timeout: float = 5.0) -> None:
        """Cancel what is running, answer what is queued, and stop the worker.

        A request stuck in an OS call is abandoned after the grace period, so it still gets its
        ``cancelled`` reply and closing doesn't wait out the timeout for it.
        """
        with self._lock:
            if self._latest is not None:
                self._latest.cancel()
        self._queue.put(None)
        deadline = time.monotonic() + timeout
        while True:
            with self._lock:
                worker, running = self._thread, self._running
            worker.join(timeout=max(0.0, min(self._abandon_after, deadline - time.monotonic())))
            if not worker.is_alive():
                with self._lock:
                    if self._thread is worker:
                        return
                continue  # an abandon started a fresh worker, which now owns the sentinel
            if time.monotonic() >= deadline:
                log.warning("channel %s: closed with a request still running", self.name)
                return
            if running is not None:
                self._abandon(running.token)

    def _start_worker(self) -> threading.Thread:
        self._workers += 1
        name = f"channel-{self.name}" if self._workers == 1 else f"channel-{self.name}-{self._workers}"
        thread = threading.Thread(target=self._run, name=name, daemon=True)
        thread.start()
        return thread

    def _abandon(self, token: CancelToken) -> None:
        """Stop waiting for the request `token` cancelled, if it is still running (a timer calls
        this after the cancel)."""
        with self._lock:
            job = self._running
            if job is None or job.token is not token or job.done:
                return
            if self._abandoned >= self._max_abandoned:
                log.warning("channel %s: %d requests already stuck; waiting for this one", self.name, self._abandoned)
                return
            job.abandoned = True
            self._abandoned += 1
            self._running = None
            log.warning("channel %s: abandoned a %s stuck past its cancel", self.name, job.request["type"])
            self._send(cancelled(job.request["id"]))
            self._thread = self._start_worker()

    def _run(self) -> None:
        while True:
            job = self._queue.get()
            if job is None:
                return
            with self._lock:
                self._running = job
            reply = self._reply(job)
            with self._lock:
                if job.abandoned:
                    # Its cancelled reply went out already, and a fresh worker owns the queue.
                    self._abandoned -= 1
                    log.info("channel %s: an abandoned %s returned", self.name, job.request["type"])
                    return
                job.done = True
                self._last_done = job.token
                self._running = None
            self._send(reply)

    @staticmethod
    def _reply(job: _Job) -> Message:
        request_id = job.request["id"]
        try:
            reply = cancelled(request_id) if job.token.cancelled else job.handler(job.request, job.token)
        except Cancelled:
            reply = cancelled(request_id)
        except Exception:
            log.exception("handler for %r failed", job.request["type"])
            reply = error(request_id, INVALID_REQUEST)
        if job.token.cancelled and reply.get("type") != "cancelled":
            reply = cancelled(request_id)
        return reply


class StdioTransport:
    def __init__(self, stdin: BinaryIO, protocol_out: BinaryIO, validator: SchemaValidator | None) -> None:
        self._stdin = stdin
        self._out = protocol_out
        self._validator = validator
        self._queue: queue.Queue[Message | None] = queue.Queue()
        self._writer = threading.Thread(target=self._write_loop, name="protocol-writer", daemon=True)
        self._drain: threading.Thread | None = None
        self._channels: dict[str, Channel] = {}
        self._channel_of: dict[str, tuple[Channel, ChannelHandler]] = {}

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

    def register_channel(self, request_type: str, channel: str, handler: ChannelHandler) -> None:
        """Serve `request_type` off the reader thread on the named channel (created on first use)."""
        if channel not in self._channels:
            self._channels[channel] = Channel(channel, self.send)
        self._channel_of[request_type] = (self._channels[channel], handler)

    def close(self) -> None:
        """Answer or cancel channel work, flush pending protocol output and stop the helper threads."""
        for channel in self._channels.values():
            channel.close()
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

        Requests in HANDLERS are handled one at a time on this reader thread, and the shell treats
        a ping unanswered within its ping timeout (5 s) as a hang. Any handler that can take longer
        than a few seconds must run on a channel instead (AD-10, ``register_channel``).
        """
        for raw in iter(self._stdin.readline, b""):
            reply = self.handle_line(raw)
            if reply is not None:
                self.send(reply)
        log.info("stdin closed")

    def handle_line(self, raw: bytes) -> Message | None:
        """The terminal reply for a reader-thread request, or None once a channel has queued it."""
        request = _parse(raw)
        if request is None:
            log.warning("invalid request line (%d bytes)", len(raw))
            return error(None, INVALID_REQUEST)

        request_id, request_type = request["id"], request["type"]
        handler = HANDLERS.get(request_type)
        channelled = self._channel_of.get(request_type)
        if handler is None and channelled is None:
            log.warning("unknown request type %r", request_type)
            return error(request_id, UNKNOWN_REQUEST)

        if self._validator is not None:
            problem = self._validator.problem(request)
            if problem:
                log.warning("request %s violates its schema: %s", request_type, problem)
                return error(request_id, INVALID_REQUEST)

        if handler is None:
            assert channelled is not None
            channel, channel_handler = channelled
            channel.submit(request, channel_handler)
            return None
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
