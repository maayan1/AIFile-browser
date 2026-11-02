"""AD-1: engine/core never imports adapters, ONNX Runtime, the file system or JSON storage directly."""

from __future__ import annotations

import ast
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
BANNED = {
    "adapters", "onnxruntime", "os", "pathlib", "shutil", "glob", "io", "json",
    "tempfile", "subprocess", "sqlite3", "pickle", "shelve", "importlib",
}
BANNED_CALLS = {"open", "__import__"}


def _module_of(path: Path, engine_root: Path) -> list[str]:
    """Package parts of the module containing `path`, e.g. core/rules/x.py -> ['core', 'rules']."""
    return list(path.relative_to(engine_root).parent.parts)


def imported_modules(path: Path, engine_root: Path) -> list[tuple[int, str]]:
    """(line, absolute module name) for every import in a file, with relative imports resolved."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend((node.lineno, alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                package = _module_of(path, engine_root)
                base = package[: len(package) - (node.level - 1)] if node.level > 1 else package
                if node.module:
                    found.append((node.lineno, ".".join([*base, node.module])))
                else:
                    found.extend((node.lineno, ".".join([*base, alias.name])) for alias in node.names)
            elif node.module:
                found.append((node.lineno, node.module))
    return found


def banned_calls(path: Path) -> list[tuple[int, str]]:
    """(line, name) for every call to a banned builtin such as open() or __import__()."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [
        (node.lineno, node.func.id)
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in BANNED_CALLS
    ]


def find_violations(engine_root: Path) -> list[str]:
    violations = []
    for path in sorted((engine_root / "core").rglob("*.py")):
        found = [
            (line, f"imports {module}")
            for line, module in imported_modules(path, engine_root)
            if module.split(".")[0] in BANNED
        ]
        found += [(line, f"calls {name}()") for line, name in banned_calls(path)]
        where = path.relative_to(engine_root).as_posix()
        violations.extend(f"{where}:{line} {what}" for line, what in sorted(found))
    return violations


def test_core_imports_nothing_banned() -> None:
    assert find_violations(ENGINE_DIR) == []


def test_scanner_flags_planted_violations(tmp_path: Path) -> None:
    rules = tmp_path / "core" / "rules"
    rules.mkdir(parents=True)
    (tmp_path / "core" / "__init__.py").write_text("", encoding="utf-8")
    (tmp_path / "core" / "clean.py").write_text(
        "from core.ports import something\nimport core.rules\nfrom . import ports\n", encoding="utf-8"
    )
    (rules / "bad.py").write_text(
        "import os\n"
        "from pathlib import Path\n"
        "import json as j\n"
        "from adapters.stdio_transport import HANDLERS\n"
        "from ...adapters import stdio_transport\n"
        "from ... import adapters\n"
        "import onnxruntime.capi\n"
        "import tempfile\n"
        "import subprocess\n"
        "import sqlite3\n"
        "import pickle\n"
        "import shelve\n"
        "from importlib import import_module\n"
        "data = open('x').read()\n"
        "mod = __import__('os')\n",
        encoding="utf-8",
    )

    violations = find_violations(tmp_path)

    assert all(v.startswith("core/rules/bad.py:") for v in violations), violations
    assert [int(v.split(":")[1].split()[0]) for v in violations] == list(range(1, 16))
    assert "core/rules/bad.py:14 calls open()" in violations
    assert "core/rules/bad.py:15 calls __import__()" in violations
