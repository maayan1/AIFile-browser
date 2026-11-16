"""Engine entry point: log setup, stdio transport first, then `ready`.

Spawned only by the Rust shell (AD-14). In development: `uv run --project engine python main.py`.
Environment:
  FB2_VALIDATE_PROTOCOL=1  validate every message against protocol/ (debug builds)
  FB2_LOG_DIR              override the log folder (tests)
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from collections.abc import Callable
from logging.handlers import RotatingFileHandler
from pathlib import Path

from adapters.stdio_transport import (
    PROTOCOL_VERSION,
    ChannelHandler,
    Emit,
    Message,
    StdioTransport,
    StreamingHandler,
    error,
)
from adapters.windows_fs import WindowsFileSystem
from core.browse import FolderUnreadable, list_folder, show_in_folder
from core.cancel import CancelToken
from core.errors import (  # re-exported: the folder codes and their mapping live in core
    ACCESS_DENIED,
    DENIED_WINERRORS,
    FOLDER_NOT_FOUND,
    FOLDER_UNAVAILABLE,
    NOT_FOUND_WINERRORS,
    folder_error_code,
)
from core.locations import locations
from core.ports.filesystem import FileSystemPort
from core.search import name_search, parse_query

log = logging.getLogger("fb2.main")

LOG_MAX_BYTES = 1_000_000
LOG_BACKUP_COUNT = 3


def log_dir() -> Path:
    override = os.environ.get("FB2_LOG_DIR")
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(local) / "FileBrowser2" / "logs"


def setup_logging() -> None:
    folder = log_dir()
    folder.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        folder / "engine.log", maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s [%(threadName)s] %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)

    def log_uncaught(exc_type, exc, tb):  # type: ignore[no-untyped-def]
        logging.getLogger("fb2").critical("uncaught exception", exc_info=(exc_type, exc, tb))

    sys.excepthook = log_uncaught
    threading.excepthook = lambda args: log_uncaught(args.exc_type, args.exc_value, args.exc_traceback)


def folder_handler(produce: Callable[[Message, CancelToken], Message]) -> ChannelHandler:
    """A handler replying with `produce`'s folderListing, or the folder error as a protocol code."""

    def handle(request: Message, token: CancelToken) -> Message:
        try:
            listing = produce(request, token)
        except FolderUnreadable as exc:
            # The folder exists: its place rides along, so Up and the breadcrumb still work.
            code = folder_error_code(exc.error)
            log.info("%s: %s (winerror %s)", request["type"], code, getattr(exc.error, "winerror", None))
            return {**error(request["id"], code), "data": exc.place}
        except OSError as exc:
            code = folder_error_code(exc)
            log.info("%s: %s (winerror %s)", request["type"], code, getattr(exc, "winerror", None))
            return error(request["id"], code)
        return {"id": request["id"], "type": "folderListing", **listing}

    return handle


def list_folder_handler(fs: FileSystemPort) -> ChannelHandler:
    """The `listFolder` handler: a folderListing, or the folder error as a protocol code."""
    return folder_handler(lambda request, token: list_folder(fs, request.get("path"), token))


def show_in_folder_handler(fs: FileSystemPort) -> ChannelHandler:
    """The `showInFolder` handler: the item's folder with the item selected, or the folder error."""
    return folder_handler(lambda request, token: show_in_folder(fs, request["path"], token))


def list_locations_handler(fs: FileSystemPort) -> ChannelHandler:
    """The `listLocations` channel handler: the nav pane's known folders and drives."""

    def handle(request: Message, token: CancelToken) -> Message:
        token.raise_if_cancelled()
        return {"id": request["id"], "type": "locations", **locations(fs)}

    return handle


def search_handler(fs: FileSystemPort) -> StreamingHandler:
    """The `search` handler: searchParsed and nameMatches through `emit`, then searchDone, or the
    folder error as a protocol code. The search text is never logged."""

    def handle(request: Message, token: CancelToken, emit: Emit) -> Message:
        request_id = request["id"]

        def send(message: Message) -> None:
            emit({"id": request_id, **message})

        query = parse_query(request["text"], request.get("literalPhrases", []))
        try:
            done = name_search(fs, request["folder"], query, token, send)
        except OSError as exc:
            code = folder_error_code(exc)
            log.info("search: %s (winerror %s)", code, getattr(exc, "winerror", None))
            return error(request_id, code)
        return {"id": request_id, **done}

    return handle


def main() -> int:
    setup_logging()
    transport = StdioTransport.open(validate=os.environ.get("FB2_VALIDATE_PROTOCOL") == "1")
    fs = WindowsFileSystem()
    transport.register_channel("listFolder", "listFolder", list_folder_handler(fs))
    # The same channel: a Show in folder and a listing replace each other (latest wins).
    transport.register_channel("showInFolder", "listFolder", show_in_folder_handler(fs))
    # Its own channel: reading a removable drive's label can block, and must never hold up a listing.
    transport.register_channel("listLocations", "locations", list_locations_handler(fs))
    # Its own channel, latest wins: a new search replaces the running one and nothing else.
    transport.register_channel("search", "search", search_handler(fs), streaming=True)
    transport.send({"id": None, "type": "ready", "protocolVersion": PROTOCOL_VERSION})
    try:
        transport.serve_forever()
    finally:
        transport.close()
        logging.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
