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

from adapters.stdio_transport import PROTOCOL_VERSION, StdioTransport

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


def main() -> int:
    setup_logging()
    transport = StdioTransport.open(validate=os.environ.get("FB2_VALIDATE_PROTOCOL") == "1")
    transport.send({"id": None, "type": "ready", "protocolVersion": PROTOCOL_VERSION})
    try:
        transport.serve_forever()
    finally:
        transport.close()
        logging.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
