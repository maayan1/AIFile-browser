"""Extension -> typeCode map. The UI's catalog words each code; the engine never sends words."""

from __future__ import annotations

FOLDER = "folder"
OTHER = "other"

# Every type code the UI words. `folder` is for folder entries; files get one of the rest.
TYPE_CODES = (
    FOLDER, "pdf", "word", "excel", "powerpoint", "text", "markdown",
    "image", "audio", "video", "archive", OTHER,
)

_EXTENSIONS_BY_TYPE: dict[str, tuple[str, ...]] = {
    "pdf": ("pdf",),
    "word": ("doc", "docx", "docm", "dot", "dotx", "dotm"),
    "excel": ("xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm"),
    "powerpoint": ("ppt", "pptx", "pptm", "pps", "ppsx", "ppsm", "pot", "potx", "potm"),
    "text": ("txt", "log"),
    "markdown": ("md", "markdown"),
    "image": ("jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "heic", "heif", "svg", "ico"),
    "audio": ("mp3", "wav", "m4a", "flac", "ogg", "wma", "aac", "opus"),
    "video": ("mp4", "mov", "avi", "mkv", "wmv", "webm", "m4v", "mpg", "mpeg"),
    "archive": ("zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"),
}

EXTENSION_TYPES: dict[str, str] = {
    ext: code for code, extensions in _EXTENSIONS_BY_TYPE.items() for ext in extensions
}


def extension(name: str) -> str:
    """The lower-case text after the last dot, or "" when there is none."""
    _, dot, ext = name.rpartition(".")
    return ext.lower() if dot else ""


def file_type_code(name: str) -> str:
    return EXTENSION_TYPES.get(extension(name), OTHER)
