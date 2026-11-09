"""Channel dispatch rules (AD-10) and the listFolder handler's error mapping, in process."""

from __future__ import annotations

import queue
import threading
from collections.abc import Iterator

from adapters.stdio_transport import Channel, Message
from core.cancel import CancelToken
from core.ports.filesystem import FsEntry
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


class RaisingFs:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    def documents_folder(self) -> str:
        return "X:\\"

    def list(self, path: str) -> Iterator[FsEntry]:
        raise self.exc


def test_other_os_errors_map_to_folder_not_found() -> None:
    handle = main.list_folder_handler(RaisingFs(OSError(22, "The filename syntax is incorrect")))
    reply = handle({"id": "l1", "type": "listFolder", "path": "C:\\a<b"}, CancelToken())
    assert reply == {"id": "l1", "type": "error", "code": "folderNotFound", "data": {}}


def test_permission_error_maps_to_access_denied() -> None:
    handle = main.list_folder_handler(RaisingFs(PermissionError(13, "Access is denied")))
    reply = handle({"id": "l2", "type": "listFolder", "path": "C:\\denied"}, CancelToken())
    assert reply["code"] == "accessDenied"
