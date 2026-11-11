"""Channel dispatch rules (AD-10) and the listFolder handler's error mapping, in process."""

from __future__ import annotations

import queue
import threading
import time
from collections.abc import Iterator

import pytest

from adapters.stdio_transport import Channel, Message
from core.cancel import CancelToken
from core.ports.filesystem import Drive, FsEntry
import main

TIMEOUT = 5.0


def channel() -> tuple[Channel, queue.Queue[Message]]:
    sent: queue.Queue[Message] = queue.Queue()
    return Channel("t", sent.put), sent


def reply_with(kind: str):  # type: ignore[no-untyped-def]
    def handle(request: Message, token: CancelToken) -> Message:
        return {"id": request["id"], "type": kind}

    return handle


def test_a_failing_handler_yields_invalid_request_and_the_channel_keeps_serving() -> None:
    ch, sent = channel()

    def broken(request: Message, token: CancelToken) -> Message:
        raise RuntimeError("bug")

    ch.submit({"id": "a", "type": "x"}, broken)
    assert sent.get(timeout=TIMEOUT) == {"id": "a", "type": "error", "code": "invalidRequest", "data": {}}
    ch.submit({"id": "b", "type": "x"}, reply_with("pong"))
    assert sent.get(timeout=TIMEOUT) == {"id": "b", "type": "pong"}
    ch.close()


def test_a_request_cancelled_while_queued_never_runs() -> None:
    ch, sent = channel()
    started, release = threading.Event(), threading.Event()
    ran: list[str] = []

    def blocking(request: Message, token: CancelToken) -> Message:
        started.set()
        release.wait(TIMEOUT)
        return {"id": request["id"], "type": "pong"}

    def recording(request: Message, token: CancelToken) -> Message:
        ran.append(request["id"])
        return {"id": request["id"], "type": "pong"}

    ch.submit({"id": "a", "type": "x"}, blocking)
    assert started.wait(TIMEOUT)
    ch.submit({"id": "b", "type": "x"}, recording)  # queued behind a; cancels a
    ch.submit({"id": "c", "type": "x"}, recording)  # cancels b while it waits
    release.set()
    assert sent.get(timeout=TIMEOUT) == {"id": "a", "type": "cancelled"}
    assert sent.get(timeout=TIMEOUT) == {"id": "b", "type": "cancelled"}
    assert sent.get(timeout=TIMEOUT) == {"id": "c", "type": "pong"}
    assert ran == ["c"]
    ch.close()


def test_a_handler_finishing_after_its_cancel_yields_cancelled() -> None:
    ch, sent = channel()
    started, release = threading.Event(), threading.Event()

    def ignores_token(request: Message, token: CancelToken) -> Message:
        started.set()
        release.wait(TIMEOUT)
        return {"id": request["id"], "type": "pong"}  # never checks its token

    ch.submit({"id": "a", "type": "x"}, ignores_token)
    assert started.wait(TIMEOUT)
    ch.submit({"id": "b", "type": "x"}, reply_with("pong"))
    release.set()
    assert sent.get(timeout=TIMEOUT) == {"id": "a", "type": "cancelled"}
    assert sent.get(timeout=TIMEOUT) == {"id": "b", "type": "pong"}
    ch.close()


def stuck(started: threading.Event, release: threading.Event):  # type: ignore[no-untyped-def]
    """A handler blocked as if inside an OS call: it never checks its token."""

    def handle(request: Message, token: CancelToken) -> Message:
        started.set()
        release.wait(30)
        return {"id": request["id"], "type": "pong"}

    return handle


def test_a_request_stuck_past_its_cancel_is_abandoned_and_the_next_one_runs() -> None:
    ch, sent = channel()
    started, release = threading.Event(), threading.Event()
    try:
        ch.submit({"id": "a", "type": "x"}, stuck(started, release))
        assert started.wait(TIMEOUT)
        ch.submit({"id": "b", "type": "x"}, reply_with("pong"))
        # Both replies arrive while a is still blocked.
        assert sent.get(timeout=2) == {"id": "a", "type": "cancelled"}
        assert sent.get(timeout=2) == {"id": "b", "type": "pong"}
        assert ch.abandoned == 1
    finally:
        release.set()
    # When the OS call returns, the stuck thread's reply is dropped: a had its terminal reply.
    deadline = time.monotonic() + TIMEOUT
    while ch.abandoned and time.monotonic() < deadline:
        time.sleep(0.01)
    assert ch.abandoned == 0
    assert sent.empty()
    ch.submit({"id": "c", "type": "x"}, reply_with("pong"))
    assert sent.get(timeout=TIMEOUT) == {"id": "c", "type": "pong"}
    ch.close()


def test_a_slow_request_that_ends_within_the_grace_period_is_not_abandoned() -> None:
    sent: queue.Queue[Message] = queue.Queue()
    ch = Channel("t", sent.put, abandon_after=2.0)
    started, release = threading.Event(), threading.Event()
    try:
        ch.submit({"id": "a", "type": "x"}, stuck(started, release))
        assert started.wait(TIMEOUT)
        ch.submit({"id": "b", "type": "x"}, reply_with("pong"))
        # a keeps running for a quarter of the grace period: nothing is sent meanwhile.
        with pytest.raises(queue.Empty):
            sent.get(timeout=0.5)
        release.set()
        assert sent.get(timeout=TIMEOUT) == {"id": "a", "type": "cancelled"}
        assert sent.get(timeout=TIMEOUT) == {"id": "b", "type": "pong"}
        assert ch.abandoned == 0
    finally:
        release.set()
    ch.close()


def test_no_watch_is_started_when_the_previous_request_already_ended() -> None:
    def timers() -> set[threading.Thread]:
        return {t for t in threading.enumerate() if isinstance(t, threading.Timer)}

    before = timers()  # earlier tests' watches may still be counting down
    ch, sent = channel()
    for i in range(20):
        ch.submit({"id": str(i), "type": "x"}, reply_with("pong"))
        assert sent.get(timeout=TIMEOUT) == {"id": str(i), "type": "pong"}
    assert timers() - before == set()
    ch.close()


def test_close_answers_and_abandons_a_stuck_latest_request() -> None:
    ch, sent = channel()
    started, release = threading.Event(), threading.Event()
    try:
        ch.submit({"id": "a", "type": "x"}, stuck(started, release))
        assert started.wait(TIMEOUT)
        began = time.monotonic()
        ch.close(timeout=TIMEOUT)
        assert time.monotonic() - began < 2
        assert sent.get_nowait() == {"id": "a", "type": "cancelled"}
        assert sent.empty()
    finally:
        release.set()


def test_at_the_cap_the_channel_waits_for_the_stuck_request_again() -> None:
    sent: queue.Queue[Message] = queue.Queue()
    ch = Channel("t", sent.put, abandon_after=0.05, max_abandoned=1)
    a_started, a_release = threading.Event(), threading.Event()
    b_started, b_release = threading.Event(), threading.Event()
    try:
        ch.submit({"id": "a", "type": "x"}, stuck(a_started, a_release))
        assert a_started.wait(TIMEOUT)
        ch.submit({"id": "b", "type": "x"}, stuck(b_started, b_release))
        assert sent.get(timeout=2) == {"id": "a", "type": "cancelled"}
        assert b_started.wait(TIMEOUT)
        ch.submit({"id": "c", "type": "x"}, reply_with("pong"))
        # a still holds the only abandoned slot, so c waits behind b.
        with pytest.raises(queue.Empty):
            sent.get(timeout=0.5)
        b_release.set()
        assert sent.get(timeout=TIMEOUT) == {"id": "b", "type": "cancelled"}
        assert sent.get(timeout=TIMEOUT) == {"id": "c", "type": "pong"}
    finally:
        a_release.set()
        b_release.set()
    ch.close()


def test_close_does_not_wait_for_an_abandoned_thread() -> None:
    ch, sent = channel()
    started, release = threading.Event(), threading.Event()
    try:
        ch.submit({"id": "a", "type": "x"}, stuck(started, release))
        assert started.wait(TIMEOUT)
        ch.submit({"id": "b", "type": "x"}, reply_with("pong"))
        assert sent.get(timeout=2)["id"] == "a"
        assert sent.get(timeout=2)["id"] == "b"
        began = time.monotonic()
        ch.close(timeout=TIMEOUT)
        assert time.monotonic() - began < 1
    finally:
        release.set()


class RaisingFs:
    """Resolves every path as given; listing raises `exc` (or resolving does, with `on_resolve`)."""

    def __init__(self, exc: Exception, on_resolve: bool = False) -> None:
        self.exc = exc
        self.on_resolve = on_resolve

    def documents_folder(self) -> str:
        return "X:\\"

    def known_folders(self) -> dict[str, str]:
        return {}

    def drives(self, letter: str | None = None) -> list[Drive]:
        return []

    def resolve(self, path: str) -> str:
        if self.on_resolve:
            raise self.exc
        return path

    def list(self, path: str) -> Iterator[FsEntry]:
        raise self.exc


def list_reply(exc: Exception, on_resolve: bool = False) -> Message:
    handle = main.list_folder_handler(RaisingFs(exc, on_resolve))
    return handle({"id": "l1", "type": "listFolder", "path": "C:\\x"}, CancelToken())


@pytest.mark.parametrize(
    ("exc", "code"),
    [
        (FileNotFoundError(2, "The system cannot find the file specified"), "folderNotFound"),
        (NotADirectoryError(20, "Not a directory"), "folderNotFound"),
        (OSError(None, "The filename syntax is incorrect", None, 123), "folderNotFound"),
        (OSError(None, "The directory name is invalid", None, 267), "folderNotFound"),
        (OSError(None, "The system cannot find the path specified", None, 3), "folderNotFound"),
        (PermissionError(13, "Access is denied"), "accessDenied"),
        (OSError(None, "Access is denied", None, 5), "accessDenied"),
        # Python maps ERROR_NOT_READY to PermissionError and an unreachable share to
        # FileNotFoundError; the winerror decides.
        (OSError(None, "The device is not ready", None, 21), "folderUnavailable"),
        (OSError(None, "The network path was not found", None, 53), "folderUnavailable"),
        (OSError(None, "The network name cannot be found", None, 67), "folderUnavailable"),
        (OSError(22, "Invalid argument"), "folderUnavailable"),
    ],
    ids=lambda v: v if isinstance(v, str) else f"{type(v).__name__}-{getattr(v, 'winerror', None) or v.errno}",
)
def test_folder_errors_map_to_codes(exc: OSError, code: str) -> None:
    # A path that doesn't resolve has no place; a resolved folder that can't be listed sends its own.
    assert list_reply(exc, on_resolve=True) == {"id": "l1", "type": "error", "code": code, "data": {}}
    assert list_reply(exc, on_resolve=False) == {
        "id": "l1",
        "type": "error",
        "code": code,
        "data": {
            "path": "C:\\x",
            "parent": "C:\\",
            "segments": [
                {"kind": "drive", "letter": "C", "label": None, "path": "C:\\"},
                {"kind": "folder", "name": "x", "path": "C:\\x"},
            ],
        },
    }


def test_list_locations_handler_replies_with_locations() -> None:
    handle = main.list_locations_handler(RaisingFs(OSError()))
    assert handle({"id": "n1", "type": "listLocations"}, CancelToken()) == {
        "id": "n1", "type": "locations", "knownFolders": [], "drives": [],
    }
