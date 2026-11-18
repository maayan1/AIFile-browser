"""Measures name-search speed against the real engine (NFR-3, Story 2.4).

    uv run --project engine python engine/scripts/measure_name_search.py <tree folder>

Starts `engine/main.py` and talks to it over stdin/stdout in JSON lines, as the shell does (with a
throwaway FB2_LOG_DIR, and without FB2_VALIDATE_PROTOCOL, as in a release build; `--validate`
turns it on, as in a debug build). Each search is timed from sending `search` to receiving its
terminal `searchDone`.

The first search after the engine starts (SEARCHES[0]) runs once on its own first: it is reported
on its own line, must take at most FIRST_LIMIT seconds, and is not counted (NFR-2). Then all 20
SEARCHES run in order and are all counted: the report gives each one's time and match count, then
the median, the p90 (nearest rank: the 18th of 20) and the maximum.

Exit codes: 0 within target; 1 when the p90 is at least P90_LIMIT seconds or the first search took
more than FIRST_LIMIT; 2 when the folder is missing or the engine fails (it is always closed).

The tree is the one `fixtures/make_large_tree.py` builds; it plants names so each search hits its
intended range (`expected_range`). The search text is printed here, never written to the engine log.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import queue
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ENGINE_DIR = Path(__file__).resolve().parents[1]

P90_LIMIT = 6.0  # seconds, Enter to results (NFR-3)
FIRST_LIMIT = 10.0  # seconds, the first search after the engine starts (NFR-2)
READY_TIMEOUT = 30.0
REPLY_TIMEOUT = 120.0  # the longest wait for any one reply before the run is called failed

DEFAULT_FILES = 50_000  # the size the ranges below are stated for

# Each kind's intended match range on the default tree (files and folders that match).
RARE, COMMON, EXTENSION, NONE, LETTER = "rare", "common", "extension", "none", "letter"
RANGES: dict[str, tuple[int, int]] = {
    RARE: (1, 10),
    COMMON: (100, 2_000),
    EXTENSION: (1_000, 10_000),
    NONE: (0, 0),
    LETTER: (10_000, 99_999),  # tens of thousands
}
FIXED = {RARE, NONE}  # the same range whatever the tree's size


@dataclass(frozen=True)
class Search:
    text: str
    kind: str


SEARCHES: list[Search] = [
    Search("report", COMMON),
    Search("zephyrine", RARE),
    Search("סיכום", COMMON),
    Search(".pdf", EXTENSION),
    Search("meeting", COMMON),
    Search("invoice 7731", RARE),
    Search("a", LETTER),
    Search("חשבונית", COMMON),
    Search("budget", COMMON),
    Search("qxzvbnw", NONE),
    Search("kilimanjaro", RARE),
    Search("photo", COMMON),
    Search("פגישה", COMMON),
    Search("contract", COMMON),
    Search("מכתב המלצה", RARE),
    Search("notes", COMMON),
    Search("e", LETTER),
    Search("passport scan", RARE),
    Search("תמונה", COMMON),
    Search("presentation", COMMON),
]


def expected_range(kind: str, files: int = DEFAULT_FILES) -> tuple[int, int]:
    """The intended match range of a `kind` of search on a generated tree of `files` files."""
    low, high = RANGES[kind]
    if kind in FIXED:
        return low, high
    scale = files / DEFAULT_FILES
    return math.floor(low * scale), math.ceil(high * scale)


def p90(times: list[float]) -> float:
    """The nearest-rank 90th percentile: 90% of the times are at or below it."""
    ordered = sorted(times)
    return ordered[math.ceil(0.9 * len(ordered)) - 1]


class EngineFailed(Exception):
    pass


class Engine:
    """The real engine over stdio: one JSON line per message each way."""

    def __init__(self, log_dir: Path, validate: bool) -> None:
        env = dict(os.environ, FB2_LOG_DIR=str(log_dir))
        env.pop("FB2_VALIDATE_PROTOCOL", None)
        if validate:
            env["FB2_VALIDATE_PROTOCOL"] = "1"
        self.stderr = open(log_dir / "engine-stderr.txt", "wb")  # never an undrained pipe
        self.proc = subprocess.Popen(
            [sys.executable, "main.py"],
            cwd=ENGINE_DIR,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr,
        )
        self.lines: queue.Queue[bytes | None] = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()
        self.next_id = 0

    def _pump(self) -> None:
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            self.lines.put(raw)
        self.lines.put(None)  # the engine closed its stdout

    def read(self, timeout: float) -> dict[str, Any]:
        try:
            raw = self.lines.get(timeout=timeout)
        except queue.Empty:
            raise EngineFailed(f"no reply from the engine within {timeout:.0f} s") from None
        if raw is None:
            raise EngineFailed(f"the engine exited (code {self.proc.wait()})")
        try:
            message = json.loads(raw.decode("utf-8"))
        except ValueError as exc:  # not UTF-8 (UnicodeDecodeError) or not JSON
            raise EngineFailed(f"unreadable engine line: {exc}") from None
        if not isinstance(message, dict):
            raise EngineFailed("an engine line that isn't a JSON object")
        return message

    def send(self, message: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.write(json.dumps(message, ensure_ascii=False).encode("utf-8") + b"\n")
            self.proc.stdin.flush()
        except OSError as exc:  # BrokenPipeError when the engine has exited
            raise EngineFailed(f"couldn't send to the engine: {exc}") from None

    def search(self, text: str, folder: str) -> tuple[float, int]:
        """(seconds from sending `search` to its `searchDone`, matches received)."""
        self.next_id += 1
        request_id = f"m{self.next_id}"
        message = {"id": request_id, "type": "search", "text": text, "folder": folder}
        found = 0
        started = time.perf_counter()
        self.send(message)
        while True:
            reply = self.read(REPLY_TIMEOUT)
            if reply.get("id") != request_id:
                continue  # an event (id null), never another search's reply here
            kind = reply.get("type")
            if kind == "nameMatches":
                batch = reply.get("matches")
                if not isinstance(batch, list):
                    raise EngineFailed("a nameMatches reply without its matches")
                found += len(batch)
            elif kind == "searchDone":
                return time.perf_counter() - started, found
            elif kind != "searchParsed":
                raise EngineFailed(f"search ended with {kind} {reply.get('code', '')}".rstrip())

    def close(self) -> None:
        try:
            if self.proc.stdin is not None:
                self.proc.stdin.close()  # the engine stops at the end of its input
            self.proc.wait(timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            pass
        finally:
            if self.proc.poll() is None:
                self.proc.kill()
                self.proc.wait()
            self.stderr.close()


def measure(folder: str, validate: bool = False, out=sys.stdout) -> int:  # type: ignore[no-untyped-def]
    """Runs the warm-up and the 20 searches, prints the report; returns the exit code."""

    def say(line: str = "") -> None:
        print(line, file=out, flush=True)

    with tempfile.TemporaryDirectory(prefix="fb2-measure-") as logs:
        engine = Engine(Path(logs), validate)
        try:
            ready = engine.read(READY_TIMEOUT)
            if ready.get("type") != "ready":
                raise EngineFailed(f"expected ready, got {ready.get('type')}")
            say(f"tree: {folder}")
            say(f"python {platform.python_version()}, {os.cpu_count()} logical cores, "
                f"protocol validation {'on' if validate else 'off'}")
            say()

            first = SEARCHES[0]
            first_time, first_found = engine.search(first.text, folder)
            first_ok = first_time <= FIRST_LIMIT
            say(f"first search after start: {first.text!r} {first_time:.3f} s, {first_found} matches "
                f"(limit {FIRST_LIMIT:.0f} s: {'ok' if first_ok else 'MISSED'}; not counted)")
            say()

            say(f"{'#':>2}  {'search':<16} {'kind':<9} {'seconds':>8} {'matches':>8}")
            times: list[float] = []
            for n, search in enumerate(SEARCHES, 1):
                seconds, found = engine.search(search.text, folder)
                times.append(seconds)
                say(f"{n:>2}  {search.text:<16} {search.kind:<9} {seconds:>8.3f} {found:>8}")
        except EngineFailed as exc:
            say(f"engine failed: {exc}")
            return 2
        finally:
            engine.close()

    median, ninetieth, longest = statistics.median(times), p90(times), max(times)
    p90_ok = ninetieth < P90_LIMIT
    say()
    say(f"median {median:.3f} s, p90 {ninetieth:.3f} s, max {longest:.3f} s over {len(times)} searches")
    say(f"p90 target: under {P90_LIMIT:.0f} s: {'ok' if p90_ok else 'MISSED'}")
    passed = p90_ok and first_ok
    say(f"verdict: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="measure_name_search.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("folder", type=Path, help="the tree to search (from fixtures/make_large_tree.py)")
    parser.add_argument("--validate", action="store_true", help="validate every message, as a debug build does")
    args = parser.parse_args(argv[1:])
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # Hebrew searches
    folder: Path = args.folder
    if not folder.is_dir():
        print(f"not a folder: {folder}", file=sys.stderr)
        return 2
    return measure(str(folder.resolve()), args.validate)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
