"""Stand-in engine for the Rust supervisor tests (Story 1.2). Synthetic, no product logic.

Usage: python fake_engine.py MODE [ARG]

Modes:
  serve                       send ready, answer every ping with a pong until stdin closes
  crash-after-ready [MS] [PIDFILE]
                              write own pid to PIDFILE (if given), send ready, serve for MS
                              milliseconds (default 200), then exit 1
  serve-mark-on-eof MARKER    like serve, then write MARKER once stdin closes, and exit 0
  hang-after-ready            send ready, then never read or answer anything
  never-ready                 never send anything
  grandchild PIDFILE          start a sleeping child process, write "<own pid>\\n<child pid>\\n"
                              to PIDFILE, then behave like serve
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time

READY = {"id": None, "type": "ready", "protocolVersion": 1}


def send(message: dict) -> None:
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def serve() -> None:
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        if request.get("type") == "ping":
            send({"id": request.get("id"), "type": "pong"})


def main() -> int:
    mode = sys.argv[1]
    if mode == "serve":
        send(READY)
        serve()
        return 0
    if mode == "crash-after-ready":
        delay_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 200
        if len(sys.argv) > 3:
            with open(sys.argv[3], "w", encoding="utf-8") as f:
                f.write(f"{os.getpid()}\n")
        send(READY)
        threading.Thread(target=serve, daemon=True).start()
        time.sleep(delay_ms / 1000)
        os._exit(1)
    if mode == "serve-mark-on-eof":
        send(READY)
        serve()
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write("stdin closed\n")
        return 0
    if mode == "hang-after-ready":
        send(READY)
        time.sleep(3600)
        return 0
    if mode == "never-ready":
        time.sleep(3600)
        return 0
    if mode == "grandchild":
        # No inherited stdio, so only the job (not a held pipe) decides when the child dies.
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(3600)"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(f"{os.getpid()}\n{child.pid}\n")
        send(READY)
        serve()
        return 0
    sys.stderr.write(f"unknown mode {mode!r}\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
