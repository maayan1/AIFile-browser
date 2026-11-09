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
from logging.handlers import RotatingFileHandler
from pathlib import Path

from adapters.stdio_transport import PROTOCOL_VERSION, ChannelHandler, Message, StdioTransport, error
from adapters.windows_fs import WindowsFileSystem
from core.browse import FolderUnreadable, list_folder
from core.cancel import CancelToken
from core.locations import locations
from core.ports.filesystem import FileSystemPort

FOLDER_NOT_FOUND = "folderNotFound"
ACCESS_DENIED = "accessDenied"
FOLDER_UNAVAILABLE = "folderUnavailable"

# Windows error codes that mean the folder isn't there: file or path not found, no such drive,
# a bad name (123: the filename syntax is incorrect), a bad path name, or not a folder (267).
# Python maps some other codes misleadingly (ERROR_NOT_READY to PermissionError, an unreachable
# share to FileNotFoundError), so the winerror decides when there is one.
NOT_FOUND_WINERRORS = frozenset({2, 3, 15, 123, 161, 267})
DENIED_WINERRORS = frozenset({5, 65})  # access denied, network access denied

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


def folder_error_code(exc: OSError) -> str:
    """The protocol code for why a folder can't be listed."""
    winerror = getattr(exc, "winerror", None)
    if winerror is not None:
        if winerror in NOT_FOUND_WINERRORS:
            return FOLDER_NOT_FOUND
        return ACCESS_DENIED if winerror in DENIED_WINERRORS else FOLDER_UNAVAILABLE
    if isinstance(exc, PermissionError):
        return ACCESS_DENIED
    if isinstance(exc, (FileNotFoundError, NotADirectoryError)):
        return FOLDER_NOT_FOUND
    return FOLDER_UNAVAILABLE


def list_folder_handler(fs: FileSystemPort) -> ChannelHandler:
    """The `listFolder` channel handler: a folderListing, or the folder error as a protocol code."""

    def handle(request: Message, token: CancelToken) -> Message:
        try:
            listing = list_folder(fs, request.get("path"), token)
        except FolderUnreadable as exc:
            # The folder exists: its place rides along, so Up and the breadcrumb still work.
            code = folder_error_code(exc.error)
            log.info("listFolder: %s (winerror %s)", code, getattr(exc.error, "winerror", None))
            return {**error(request["id"], code), "data": exc.place}
        except OSError as exc:
            code = folder_error_code(exc)
            log.info("listFolder: %s (winerror %s)", code, getattr(exc, "winerror", None))
            return error(request["id"], code)
        return {"id": request["id"], "type": "folderListing", **listing}

    return handle


def list_locations_handler(fs: FileSystemPort) -> ChannelHandler:
    """The `listLocations` channel handler: the nav pane's known folders and drives."""

    def handle(request: Message, token: CancelToken) -> Message:
        token.raise_if_cancelled()
        return {"id": request["id"], "type": "locations", **locations(fs)}

    return handle


def main() -> int:
    setup_logging()
    transport = StdioTransport.open(validate=os.environ.get("FB2_VALIDATE_PROTOCOL") == "1")
    fs = WindowsFileSystem()
    transport.register_channel("listFolder", "listFolder", list_folder_handler(fs))
    # Its own channel: reading a removable drive's label can block, and must never hold up a listing.
    transport.register_channel("listLocations", "locations", list_locations_handler(fs))
    transport.send({"id": None, "type": "ready", "protocolVersion": PROTOCOL_VERSION})
    try:
        transport.serve_forever()
    finally:
        transport.close()
        logging.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
