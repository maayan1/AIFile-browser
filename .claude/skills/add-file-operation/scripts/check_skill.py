#!/usr/bin/env python3
"""Self-check of the add-file-operation skill package itself.

Checks that SKILL.md has valid frontmatter, stays under 500 lines, links only to files that exist,
links at least one reference file, and links every helper in the skill folder directly; that every
script compiles and every spec loads; and that the validator really fails on a broken spec. With
--with-validation it also runs validate_operation.py on every spec whose status is "implemented",
so the skill only passes while the operations it describes still work.

Standard library only. From the repository root:

    uv run --project engine python .claude/skills/add-file-operation/scripts/check_skill.py --with-validation

Exit codes: 0 every check passed, 1 a check failed.
"""

from __future__ import annotations

import argparse
import json
import py_compile
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
SKILL_MD = SKILL_DIR / "SKILL.md"
VALIDATOR = SKILL_DIR / "scripts" / "validate_operation.py"
MAX_LINES = 500
LINK = re.compile(r"\]\(([^)\s]+)\)")
IGNORED_PARTS = {"__pycache__"}

sys.path.insert(0, str(VALIDATOR.parent))
from validate_operation import Report, SpecError, load_spec  # noqa: E402


def links_in(path: Path) -> set[str]:
    """Relative link targets in a markdown file, without #anchors, as posix paths from SKILL_DIR."""
    found = set()
    for target in LINK.findall(path.read_text(encoding="utf-8")):
        target = target.split("#", 1)[0]
        if not target or re.match(r"[a-z]+:", target):
            continue
        resolved = (path.parent / target).resolve()
        try:
            found.add(resolved.relative_to(SKILL_DIR).as_posix())
        except ValueError:
            found.add(str(resolved))  # outside the skill: still has to exist
    return found


def frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not match:
        return {}
    fields = {}
    for line in match.group(1).splitlines():
        key, sep, value = line.partition(":")
        if sep and not line.startswith(" "):
            fields[key.strip()] = value.strip()
    return fields


def helpers() -> list[str]:
    return sorted(
        p.relative_to(SKILL_DIR).as_posix()
        for p in SKILL_DIR.rglob("*")
        if p.is_file() and p != SKILL_MD and not IGNORED_PARTS & set(p.parts) and p.suffix != ".pyc"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Self-check the add-file-operation skill.")
    parser.add_argument("--with-validation", action="store_true", help="also validate every implemented spec live")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    r = Report()

    if not r.check(SKILL_MD.is_file(), "skill: SKILL.md exists", str(SKILL_MD)):
        return r.summary()
    text = SKILL_MD.read_text(encoding="utf-8")
    meta = frontmatter(text)
    r.check(meta.get("name") == SKILL_DIR.name, "skill: frontmatter name matches the folder", f"name is {meta.get('name')!r}")
    r.check(len(meta.get("description", "")) >= 40, "skill: frontmatter has a one-line description", "description missing or too short")
    lines = text.count("\n") + 1
    r.check(lines < MAX_LINES, f"skill: SKILL.md is under {MAX_LINES} lines ({lines})", "too long: move detail into references/")

    linked = links_in(SKILL_MD)
    broken = sorted(t for t in linked if not (SKILL_DIR / t).exists() and not Path(t).exists())
    r.check(not broken, "skill: every SKILL.md link resolves", f"broken: {broken}")
    r.check(any(t.startswith("references/") for t in linked), "skill: at least one reference file is linked", "link a references/*.md file")
    unlinked = [h for h in helpers() if h not in linked]
    r.check(not unlinked, f"skill: every helper is linked from SKILL.md ({len(helpers())} files)", f"not linked: {unlinked}")
    for ref in sorted((SKILL_DIR / "references").glob("*.md")):
        bad = sorted(t for t in links_in(ref) if not (SKILL_DIR / t).exists() and not Path(t).exists())
        r.check(not bad, f"skill: links in references/{ref.name} resolve", f"broken: {bad}")
    for heading in ("## Dependencies", "## Commands", "## Self-validation"):
        r.check(heading in text, f"skill: SKILL.md has '{heading}'", "section missing")

    for script in sorted((SKILL_DIR / "scripts").glob("*.py")):
        try:
            py_compile.compile(str(script), doraise=True, cfile=str(Path(tempfile.gettempdir()) / f"{script.stem}.pyc"))
            r.ok(f"skill: scripts/{script.name} compiles")
        except py_compile.PyCompileError as exc:
            r.fail(f"skill: scripts/{script.name} compiles", str(exc))

    specs = sorted((SKILL_DIR / "specs").glob("*.json"))
    r.check(bool(specs), "skill: at least one spec in specs/", "add specs/<operation>.json")
    implemented = []
    for spec_path in specs:
        try:
            spec = load_spec(spec_path)
            r.ok(f"skill: specs/{spec_path.name} loads ({spec['status']})")
            if spec["status"] == "implemented":
                implemented.append(spec_path)
        except SpecError as exc:
            r.fail(f"skill: specs/{spec_path.name} loads", str(exc))

    # The validator must not be vacuous: a spec for an operation that isn't wired has to fail.
    if specs:
        broken_spec = json.loads(specs[0].read_text(encoding="utf-8"))
        broken_spec.update(request="noSuchOperation", reply="noSuchReply", status="planned")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.json"
            path.write_text(json.dumps(broken_spec), encoding="utf-8")
            done = subprocess.run([sys.executable, str(VALIDATOR), "--spec", str(path), "--static-only"], capture_output=True, text=True)
        r.check(done.returncode == 1, "skill: the validator fails an unwired operation", f"exit {done.returncode}, expected 1")

    if args.with_validation:
        for spec_path in implemented:
            done = subprocess.run([sys.executable, str(VALIDATOR), "--spec", str(spec_path)], capture_output=True, text=True, encoding="utf-8", errors="replace")
            summary = next((line for line in reversed(done.stdout.splitlines()) if line.startswith("SUMMARY")), done.stdout[-300:])
            failures = [line for line in done.stdout.splitlines() if line.startswith(("FAIL", "ERROR"))]
            r.check(done.returncode == 0, f"skill: specs/{spec_path.name} validates live ({summary})", " | ".join(failures[:5]))
    else:
        r.skip("skill: live validation of implemented specs", "pass --with-validation")
    return r.summary()


if __name__ == "__main__":
    sys.exit(main())
