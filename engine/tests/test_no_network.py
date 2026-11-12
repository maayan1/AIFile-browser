"""NFR-1: no engine module imports a network library (see docs/network-check.md).

The engine talks to the shell only over stdin/stdout, so nothing under engine/ needs sockets,
TLS, HTTP or mail clients, or asyncio's stream and server helpers.
"""

from __future__ import annotations

import ast
from pathlib import Path

from tests.test_import_direction import imported_modules

ENGINE_DIR = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache"}
BANNED = {
    "socket", "_socket", "ssl", "_ssl", "http", "urllib", "ftplib", "smtplib", "xmlrpc", "requests", "httpx",
    "socketserver", "poplib", "imaplib", "urllib3", "aiohttp", "websockets",
    "webbrowser", "telnetlib", "nntplib", "wsgiref", "asyncore", "asynchat",
}
# Banned as a dotted prefix only: the rest of multiprocessing is fine.
BANNED_PREFIXES = {"multiprocessing.connection"}
# asyncio itself is fine; its network parts are not.
ASYNCIO_NETWORK = {
    "open_connection", "start_server", "open_unix_connection", "start_unix_server",
    "streams", "StreamReader", "StreamWriter", "Server",
}
LOOP_NETWORK = {
    "create_connection", "create_server", "create_datagram_endpoint", "sock_connect",
    "create_unix_connection", "create_unix_server", "sock_sendto", "sock_sendall", "sock_accept",
    "connect_accepted_socket", "getaddrinfo",
}
DYNAMIC_IMPORTS = {"__import__", "import_module"}


def _is_banned(module: str) -> bool:
    parts = module.split(".")
    if parts[0] in BANNED:
        return True
    if any(module == p or module.startswith(p + ".") for p in BANNED_PREFIXES):
        return True
    return parts[0] == "asyncio" and len(parts) > 1 and parts[1] in ASYNCIO_NETWORK


def _asyncio_names(tree: ast.AST) -> set[str]:
    """Names bound to the asyncio module: `import asyncio`, `import asyncio as aio`."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == "asyncio" or (a.name.startswith("asyncio.") and a.asname is None):
                    names.add(a.asname or "asyncio")
    return names


def _call_name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def network_uses(path: Path, engine_root: Path) -> list[tuple[int, str]]:
    """(line, what) for every network import or asyncio network call in a file."""
    found = [(line, f"imports {m}") for line, m in imported_modules(path, engine_root) if _is_banned(m)]
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    asyncio_names = _asyncio_names(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for a in node.names:
                if node.module == "asyncio" and a.name in ASYNCIO_NETWORK | {"*"}:
                    found.append((node.lineno, f"imports asyncio.{a.name}"))
                elif _is_banned(f"{node.module}.{a.name}") and not _is_banned(node.module):
                    found.append((node.lineno, f"imports {node.module}.{a.name}"))
        elif isinstance(node, ast.Attribute) and node.attr in ASYNCIO_NETWORK:
            if isinstance(node.value, ast.Name) and node.value.id in asyncio_names:
                found.append((node.lineno, f"uses {node.value.id}.{node.attr}"))
        elif isinstance(node, ast.Call):
            name = _call_name(node.func)
            if isinstance(node.func, ast.Attribute) and name in LOOP_NETWORK:
                found.append((node.lineno, f"calls {name}()"))
            elif name in DYNAMIC_IMPORTS and node.args:
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and _is_banned(arg.value):
                    found.append((node.lineno, f"imports {arg.value}"))
    return sorted(set(found))


def engine_sources(engine_root: Path) -> list[Path]:
    return sorted(
        p for p in engine_root.rglob("*.py") if not SKIP_DIRS.intersection(p.relative_to(engine_root).parts)
    )


def find_violations(engine_root: Path) -> list[str]:
    violations = []
    for path in engine_sources(engine_root):
        where = path.relative_to(engine_root).as_posix()
        violations.extend(f"{where}:{line} {what}" for line, what in network_uses(path, engine_root))
    return violations


def test_scan_covers_the_engine() -> None:
    names = {p.relative_to(ENGINE_DIR).as_posix() for p in engine_sources(ENGINE_DIR)}
    assert {"main.py", "adapters/stdio_transport.py", "core/browse.py"} <= names
    assert not any(n.startswith(".venv/") for n in names)


def test_engine_imports_no_network_module() -> None:
    assert find_violations(ENGINE_DIR) == []


def test_scanner_flags_planted_violations(tmp_path: Path) -> None:
    (tmp_path / "adapters").mkdir()
    (tmp_path / "clean.py").write_text(
        "import asyncio\nimport json, os, subprocess\nfrom asyncio import Queue\nasyncio.run(None)\n"
        "import multiprocessing\nfrom multiprocessing import Pool\nimport asyncio as aio\naio.sleep(1)\n",
        encoding="utf-8",
    )
    (tmp_path / "adapters" / "bad.py").write_text(
        "import socket\n"
        "import ssl as tls\n"
        "from http import client\n"
        "import http.server\n"
        "from urllib.request import urlopen\n"
        "import ftplib\n"
        "import smtplib\n"
        "from xmlrpc.client import ServerProxy\n"
        "import requests\n"
        "import httpx\n"
        "from asyncio import open_connection\n"
        "import asyncio.streams\n"
        "server = asyncio.start_server(None)\n"
        "loop.create_connection(None)\n"
        "mod = __import__('socket')\n"
        "mod = importlib.import_module('urllib.request')\n"
        "import _socket\n"
        "from _ssl import RAND_bytes\n"
        "import multiprocessing.connection\n"
        "from multiprocessing import connection\n"
        "from multiprocessing.connection import Client\n"
        "import webbrowser\n"
        "import telnetlib\n"
        "import nntplib\n"
        "from wsgiref.simple_server import make_server\n"
        "import asyncore\n"
        "import asynchat\n"
        "import asyncio as aio\n"  # line 28: binding the name is fine, using its network parts is not
        "aio.open_connection('h', 1)\n"
        "from asyncio import *\n"
        "loop.create_unix_connection(None)\n"
        "loop.create_unix_server(None)\n"
        "loop.sock_sendto(s, b'', a)\n"
        "loop.sock_sendall(s, b'')\n"
        "loop.sock_accept(s)\n"
        "loop.connect_accepted_socket(None, s)\n"
        "loop.getaddrinfo('h', 1)\n",
        encoding="utf-8",
    )
    # A venv under the root is someone else's code and is never scanned.
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv" / "lib.py").write_text("import socket\n", encoding="utf-8")

    violations = find_violations(tmp_path)

    assert all(v.startswith("adapters/bad.py:") for v in violations), violations
    assert sorted({int(v.split(":")[1].split()[0]) for v in violations}) == [*range(1, 28), *range(29, 38)]
    assert "adapters/bad.py:13 uses asyncio.start_server" in violations
    assert "adapters/bad.py:14 calls create_connection()" in violations
    assert "adapters/bad.py:20 imports multiprocessing.connection" in violations
    assert "adapters/bad.py:29 uses aio.open_connection" in violations
    assert "adapters/bad.py:30 imports asyncio.*" in violations
    assert "adapters/bad.py:37 calls getaddrinfo()" in violations
