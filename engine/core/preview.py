"""preview(): the selected file's details and its Preview Panel thumbnail (the preview request).

Which file gets which thumbnail is a product rule, so it lives here (rules/preview.py holds the
limits): an image up to the size cap is sent whole as base64 (never decoded or resized), a text or
Markdown file sends its first bytes decoded as text, and every other file gets a page shape the UI
draws from its type. A file that can't be shown that way gets the page shape and a ReadOutcome.

A file is read only here, on selection, through the port's read-only `read_head`, and only when its
type has something to read. One whose attributes say its content is online only is never opened.
Every read is capped and has a deadline, checked between chunks together with the cancel token.
Nothing read is kept: the reply carries it, and nothing else does.
"""

from __future__ import annotations

import base64
import codecs
from collections.abc import Callable
from typing import Any

from core.browse import listed_entry
from core.cancel import CancelToken
from core.create import child_of
from core.outcomes import ReadOutcome
from core.ports.filesystem import ONLINE_ONLY_ATTRIBUTES, FileSystemPort, StoredOnline
from core.rules import preview as rules
from core.rules.file_types import extension, file_type_code

Clock = Callable[[], float]
"""Seconds on a monotonic clock (injected, so tests control the deadline)."""

PAGE: dict[str, Any] = {"kind": "page"}

# The separators a requested path may use, before the port normalizes it.
_SEPARATORS = ("\\", "/")


class DeadlinePassed(Exception):
    """A read ran past its deadline (rules.preview.READ_DEADLINE_SECONDS)."""


def preview(fs: FileSystemPort, path: str, token: CancelToken, clock: Clock) -> dict[str, Any]:
    """`{details, thumbnail, outcomeCode?}` for the file at `path`, as previewReady words them.

    Every per-file failure is an outcome, never an exception. Raises Cancelled when `token` is
    cancelled before the reply is ready.
    """
    token.raise_if_cancelled()
    deadline = clock() + rules.READ_DEADLINE_SECONDS
    try:
        folder, name = fs.locate(path)
        if name is None:
            raise FileNotFoundError(path)
        full = child_of(folder, name)
        entry = fs.stat(full)
    except OSError:
        return _page(_details_from_path(path), ReadOutcome.CANNOT_READ)
    if entry.is_dir:
        return _page(_details_from_path(path), ReadOutcome.CANNOT_READ)
    listed = listed_entry(entry)
    details = {
        "name": entry.name,
        "path": full,
        "typeCode": listed["typeCode"],
        "size": listed["size"],
        "modified": listed["modified"],
    }

    mime = rules.IMAGE_MIME_TYPES.get(extension(entry.name))
    is_text = mime is None and details["typeCode"] in rules.TEXT_TYPE_CODES
    if entry.attributes & ONLINE_ONLY_ATTRIBUTES:
        return _page(details, ReadOutcome.STORED_ONLY_IN_ONEDRIVE)
    if mime is None and not is_text:
        return _page(details)
    if mime is not None and entry.size > rules.IMAGE_MAX_BYTES:
        return _page(details, ReadOutcome.TOO_LARGE)

    def check() -> None:
        token.raise_if_cancelled()
        if clock() > deadline:
            raise DeadlinePassed

    # One byte past the cap tells an image that grew since it was looked up from one that fits.
    limit = rules.IMAGE_MAX_BYTES + 1 if mime is not None else rules.TEXT_HEAD_BYTES
    try:
        data = fs.read_head(full, limit, check)
    except StoredOnline:
        return _page(details, ReadOutcome.STORED_ONLY_IN_ONEDRIVE)
    except (OSError, DeadlinePassed):
        return _page(details, ReadOutcome.CANNOT_READ)
    token.raise_if_cancelled()
    # `check` runs before each chunk, so the last (for text, the only) one is checked here.
    if clock() > deadline:
        return _page(details, ReadOutcome.CANNOT_READ)

    if mime is not None:
        if len(data) > rules.IMAGE_MAX_BYTES:
            return _page(details, ReadOutcome.TOO_LARGE)
        image = {"kind": "image", "mime": mime, "data": base64.b64encode(data).decode("ascii")}
        return {"details": details, "thumbnail": image}
    text = decode_head(data, cut=len(data) >= limit)
    return {"details": details, "thumbnail": {"kind": "text", "text": text}}


def decode_head(data: bytes, cut: bool) -> str:
    """A text file's first bytes as text: UTF-16 when it starts with a UTF-16 byte order mark, else
    UTF-8 (its BOM dropped). Invalid bytes become U+FFFD. When the bytes were `cut` off at the read
    limit, a character they end partway through is dropped rather than replaced."""
    encoding = "utf-8"
    for bom, name in (
        (codecs.BOM_UTF8, "utf-8"),
        (codecs.BOM_UTF16_LE, "utf-16-le"),
        (codecs.BOM_UTF16_BE, "utf-16-be"),
    ):
        if data.startswith(bom):
            data, encoding = data[len(bom) :], name
            break
    decoder = codecs.getincrementaldecoder(encoding)(errors="replace")
    return decoder.decode(data, final=not cut)


def _page(details: dict[str, Any], outcome: ReadOutcome | None = None) -> dict[str, Any]:
    reply: dict[str, Any] = {"details": details, "thumbnail": dict(PAGE)}
    if outcome is not None:
        reply["outcomeCode"] = outcome.value
    return reply


def _details_from_path(path: str) -> dict[str, Any]:
    """Details for a file the port couldn't look up: its name and type from the path as sent, and
    no size or date."""
    name = path.strip().strip('"').rstrip("".join(_SEPARATORS))
    for separator in _SEPARATORS:
        name = name.rsplit(separator, 1)[-1]
    name = name or path
    return {"name": name, "path": path, "typeCode": file_type_code(name), "size": None, "modified": None}
