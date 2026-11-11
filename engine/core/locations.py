"""locations(): the places the nav pane offers, as protocol data (codes, never words)."""

from __future__ import annotations

from typing import Any

from core.ports.filesystem import FileSystemPort

# Known-folder codes in nav-pane order; the catalog words each one ("Documents").
KNOWN_FOLDER_CODES = ("documents", "desktop", "downloads")


def locations(fs: FileSystemPort) -> dict[str, Any]:
    """`{knownFolders, drives}`: the known folders that exist (resolved, in code order) and the
    fixed and removable drives in letter order."""
    known = fs.known_folders()
    known_folders = []
    for code in KNOWN_FOLDER_CODES:
        if code not in known:
            continue
        try:
            path = fs.resolve(known[code])
        except OSError:
            continue  # moved, deleted or unreachable: left out
        known_folders.append({"code": code, "path": path})
    drives = sorted(fs.drives(), key=lambda drive: drive.letter)
    return {
        "knownFolders": known_folders,
        "drives": [{"letter": d.letter, "label": d.label, "path": d.path} for d in drives],
    }
