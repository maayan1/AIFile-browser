"""Preview thumbnail limits: which files get which thumbnail, and how much may be read for one."""

from __future__ import annotations

# Images are sent whole (never decoded or resized), so only files up to this size are read.
IMAGE_MAX_BYTES = 10 * 1024 * 1024

# Extension -> the MIME type the UI shows the bytes as. Only formats WebView2 draws.
IMAGE_MIME_TYPES: dict[str, str] = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
}

# File type codes (rules/file_types.py) whose first bytes are shown as text.
TEXT_TYPE_CODES = frozenset({"text", "markdown"})

# How much of a text file is read: its first bytes, enough for the thumbnail's first lines.
TEXT_HEAD_BYTES = 2048

# Every read is checked against its deadline (and its cancel token) between chunks of this size.
READ_CHUNK_BYTES = 64 * 1024

# Seconds from the request to the end of its read; past it the file is `cannotRead`.
READ_DEADLINE_SECONDS = 2.0
