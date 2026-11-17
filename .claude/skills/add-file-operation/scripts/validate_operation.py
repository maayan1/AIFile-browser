#!/usr/bin/env python3
"""Validate one File Browser file operation against its spec (specs/<operation>.json).

Three stages, each optional after the first:

1. static  - the operation is wired through every layer: protocol schemas, examples and codes, the
             engine channel, the port and the adapter, the UI client, session, shell, catalog and
             every BrowseActions test fake.
2. live    - the real engine is started over stdin/stdout (as Tauri starts it, with protocol
             validation on) and the operation is probed on throwaway folders: one success plus the
             list refresh, then every invalid name and path traversal, every existing name, a missing
             folder and a denied folder, each of which must leave the disk exactly as it was.
3. tests   - the project suites: engine pytest, app typecheck and app vitest (--run-tests).

Standard library only. Run it from the repository root with the engine's environment, so the
engine it starts has jsonschema for protocol validation:

    uv run --project engine python .claude/skills/add-file-operation/scripts/validate_operation.py \
        --spec .claude/skills/add-file-operation/specs/create-file.json --run-tests

Exit codes: 0 every check passed, 1 a check failed, 2 the spec or the environment is unusable.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

# Names no file operation may accept as "one name": empty and dot names, path traversal in both
# separators, absolute and UNC paths, the stream colon, wildcards, control characters, a trailing
# dot or space (Windows would silently rename it), reserved device names, and a name too long.
INVALID_NAMES: list[str] = [
    "",
    ".",
    "..",
    "..\\escaped.txt",
    "../escaped.txt",
    "..\\..\\escaped.txt",
    "sub\\nested.txt",
    "sub/nested.txt",
    "C:\\escaped.txt",
    "\\\\server\\share\\escaped.txt",
    "\\escaped.txt",
    "a:b.txt",
    "stream.txt:hidden",
    "wild*.txt",
    "what?.txt",
    'quote".txt',
    "pipe|.txt",
    "less<.txt",
    "tab\there.txt",
    "nul\u0000byte.txt",
    "trailing.",
    "trailing ",
    "CON",
    "con.txt",
    "NUL",
    "COM1.log",
    "LPT9",
    "x" * 256,
]

REQUIRED_KEYS = {
    "operation": str,
    "status": str,
    "request": str,
    "reply": str,
    "channel": str,
    "errorCodes": list,
    "catalogPrefix": str,
    "files": dict,
    "fixture": dict,
    "probes": dict,
}
STATUSES = {"planned", "implemented"}
EVERYONE = "*S-1-1-0"


class SpecError(Exception):
    """The spec can't be used; the message says why."""


# ----- reporting ------------------------------------------------------------------------------


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, status: str, check: str, detail: str = "") -> None:
        self.rows.append((status, check, detail))
        line = f"{status:<5} {check}"
        print(f"{line}  -- {detail}" if detail else line, flush=True)

    def ok(self, check: str, detail: str = "") -> None:
        self.add("PASS", check, detail)

    def fail(self, check: str, detail: str = "") -> None:
        self.add("FAIL", check, detail)

    def skip(self, check: str, detail: str = "") -> None:
        self.add("SKIP", check, detail)

    def check(self, passed: bool, check: str, detail: str = "") -> bool:
        (self.ok if passed else self.fail)(check, "" if passed else detail)
        return passed

    def summary(self) -> int:
        counts = {s: sum(1 for r in self.rows if r[0] == s) for s in ("PASS", "FAIL", "SKIP")}
        print(f"\nSUMMARY: {counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped")
        return 1 if counts["FAIL"] else 0


# ----- spec -----------------------------------------------------------------------------------


def find_repo(start: Path) -> Path:
    for folder in [start, *start.parents]:
        if (folder / "engine" / "main.py").is_file() and (folder / "protocol" / "codes.json").is_file():
            return folder
    raise SpecError("repository root not found (needs engine/main.py and protocol/codes.json); pass --repo")


def load_spec(path: Path) -> dict[str, Any]:
    """The spec at `path`, checked for the keys and types the validator relies on."""
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SpecError(f"{path}: {exc}") from exc
    if not isinstance(spec, dict):
        raise SpecError(f"{path}: the spec must be a JSON object")
    for key, kind in REQUIRED_KEYS.items():
        if not isinstance(spec.get(key), kind):
            raise SpecError(f"{path}: '{key}' must be a {kind.__name__}")
    if spec["status"] not in STATUSES:
        raise SpecError(f"{path}: 'status' must be one of {sorted(STATUSES)}")
    if not re.fullmatch(r"[a-z][A-Za-z]+", spec["request"]) or not re.fullmatch(r"[a-z][A-Za-z]+", spec["reply"]):
        raise SpecError(f"{path}: 'request' and 'reply' are camelCase message types")
    probes = spec["probes"]
    if not isinstance(probes.get("request"), dict):
        raise SpecError(f"{path}: 'probes.request' must be an object of request fields")
    success = probes.get("success")
    if not isinstance(success, dict) or not isinstance(success.get("created", []), list):
        raise SpecError(f"{path}: 'probes.success' must be an object (see references/validation.md)")
    for item in success.get("created", []):
        if not isinstance(item, dict) or item.get("kind") not in ("file", "folder") or "path" not in item:
            raise SpecError(f"{path}: each 'probes.success.created' item needs 'path' and kind 'file' or 'folder'")
    return spec


def fill(template: Any, root: Path, name: str | None) -> Any:
    """`template` with {root} replaced by the probe folder and {name} by the probed name."""
    if isinstance(template, str):
        text = template.replace("{root}", str(root))
        return text if name is None else text.replace("{name}", name)
    if isinstance(template, dict):
        return {key: fill(value, root, name) for key, value in template.items()}
    if isinstance(template, list):
        return [fill(value, root, name) for value in template]
    return template


def rel(repo: Path, path: Path) -> str:
    try:
        return path.relative_to(repo).as_posix()
    except ValueError:
        return str(path)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


# ----- stage 1: static wiring -----------------------------------------------------------------


def static_checks(repo: Path, spec: dict[str, Any], r: Report) -> None:
    proto = repo / "protocol"
    request, reply, prefix = spec["request"], spec["reply"], spec["catalogPrefix"]
    titles: dict[str, str] = {}

    for kind in ("request", "reply"):
        mtype = spec[kind]
        path = proto / "schemas" / f"{mtype}.schema.json"
        if not path.is_file():
            r.fail(f"static: {kind} schema {mtype}", f"missing {rel(repo, path)}")
            continue
        schema = json.loads(read(path))
        title = schema.get("title")
        problems = []
        if schema.get("properties", {}).get("type", {}).get("const") != mtype:
            problems.append(f'properties.type.const must be "{mtype}"')
        if not isinstance(title, str) or title[:1] != mtype[:1].upper() or title.lower() != mtype.lower():
            problems.append(f"title must be the PascalCase type ({mtype[:1].upper() + mtype[1:]})")
        if schema.get("additionalProperties") is not False:
            problems.append("additionalProperties must be false")
        if "id" not in schema.get("required", []):
            problems.append("id must be required")
        if r.check(not problems, f"static: {kind} schema {mtype}", "; ".join(problems)) and isinstance(title, str):
            titles[kind] = title

    examples = []
    for path in sorted((proto / "examples").glob("*.json")):
        try:
            examples.append(json.loads(read(path)))
        except json.JSONDecodeError:
            r.fail("static: protocol example parses", rel(repo, path))
    types = {e.get("type") for e in examples}
    for kind in ("request", "reply"):
        r.check(spec[kind] in types, f"static: example of {spec[kind]}", f"add protocol/examples/<name>.json with type {spec[kind]}")

    codes = set(json.loads(read(proto / "codes.json")).get("errorCodes", []))
    missing = [c for c in spec["errorCodes"] if c not in codes]
    r.check(not missing, "static: error codes in protocol/codes.json", f"missing {missing}")
    example_codes = {e.get("code") for e in examples if e.get("type") == "error"}
    missing = [c for c in spec.get("newErrorCodes", []) if c not in example_codes]
    r.check(not missing, "static: an error example per new code", f"add protocol/examples/error-<code>.json for {missing}")

    main_py = read(repo / "engine" / "main.py")
    channels = re.findall(r'register_channel\(\s*"([^"]+)"\s*,\s*"([^"]+)"', main_py)
    mine = [ch for req, ch in channels if req == request]
    if r.check(bool(mine), f"static: engine registers {request}", f'register_channel("{request}", "{spec["channel"]}", ...) in engine/main.py'):
        sharing = sorted(req for req, ch in channels if ch == spec["channel"] and req != request)
        r.check(
            mine == [spec["channel"]] and not sharing,
            f"static: {request} has its own channel '{spec['channel']}'",
            f"registered on {mine}; also on that channel: {sharing}",
        )

    port_method = spec.get("portMethod")
    if port_method:
        for path in (repo / "engine/core/ports/filesystem.py", repo / "engine/adapters/windows_fs.py"):
            r.check(f"def {port_method}(" in read(path), f"static: {port_method}() in {rel(repo, path)}", "method missing")
    else:
        r.skip("static: port method", "spec has no portMethod")

    client = read(repo / "app/src/protocol/client.ts")
    if "request" in titles:
        r.check(f'Omit<{titles["request"]}, "id">' in client, f"static: client Request union has {titles['request']}", "add it in app/src/protocol/client.ts")
    if "reply" in titles:
        union = re.search(r"export type Reply\s*=([^;]*);", client, re.S)
        r.check(bool(union and re.search(rf"\b{titles['reply']}\b", union.group(1))), f"static: client Reply union has {titles['reply']}", "add it in app/src/protocol/client.ts")

    method = spec.get("sessionMethod")
    if method:
        session = read(repo / "app/src/browse/session.ts")
        actions = re.search(r"export interface BrowseActions\s*\{(.*?)\n\}", session, re.S)
        r.check(bool(actions and re.search(rf"^\s+{method}\(", actions.group(1), re.M)), f"static: BrowseActions.{method}", "declare it in app/src/browse/session.ts")
        r.check(len(re.findall(rf"^\s+{method}\(", session, re.M)) >= 2, f"static: BrowseSession implements {method}", "implement it in the BrowseSession class")
        shell = read(repo / "app/src/components/shell/AppShell.tsx")
        r.check(f"actions.{method}(" in shell, f"static: AppShell forwards {method}", "add it to leavingSearch() in AppShell.tsx")
        # A full BrowseActions fake is recognised by its clearPathError stub, typed or not.
        fake = re.compile(r"\bclearPathError:\s*vi\.fn[<(]")
        fakes = [p for p in sorted((repo / "app/src").rglob("*.test.ts*")) if fake.search(read(p))]
        lacking = [rel(repo, p) for p in fakes if not re.search(rf"\b{method}\s*:", read(p))]
        r.check(bool(fakes) and not lacking, f"static: every BrowseActions fake has {method} ({len(fakes)} files)", f"add `{method}: vi.fn(),` to {lacking}")
    else:
        r.skip("static: UI session", "spec has no sessionMethod")

    catalog = read(repo / "app/src/i18n/catalog.ts")
    missing = [c for c in [*spec["errorCodes"], "failed"] if f'"{prefix}.{c}":' not in catalog]
    r.check(not missing, f"static: catalog sentence per code ({prefix}.*)", f"add {[f'{prefix}.{c}' for c in missing]} to app/src/i18n/catalog.ts")

    for role, value in spec["files"].items():
        for path in value if isinstance(value, list) else [value]:
            r.check((repo / path).is_file(), f"static: {role} file {path}", "missing")


# ----- stage 2: live engine probes ------------------------------------------------------------


class Engine:
    """The real engine over stdin/stdout, as Tauri runs it in development."""

    def __init__(self, engine_dir: Path, log_dir: Path) -> None:
        env = dict(os.environ, FB2_LOG_DIR=str(log_dir), FB2_VALIDATE_PROTOCOL="1")
        self.log_dir = log_dir
        self.stderr = open(log_dir / "engine-stderr.txt", "wb")
        self.proc = subprocess.Popen(
            [sys.executable, "main.py"],
            cwd=engine_dir,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr,
        )
        self.lines: queue.Queue[bytes] = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()
        self.counter = 0

    def _pump(self) -> None:
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            self.lines.put(raw)

    def read(self, timeout: float = 15.0) -> dict[str, Any]:
        return json.loads(self.lines.get(timeout=timeout).decode("utf-8"))

    def request(self, message: dict[str, Any], timeout: float = 15.0) -> dict[str, Any]:
        """Send `message` with a fresh id; its terminal reply (stream messages are skipped)."""
        self.counter += 1
        rid = f"v{self.counter}"
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({"id": rid, **message}, ensure_ascii=False).encode("utf-8") + b"\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + timeout
        while True:
            reply = self.read(max(0.1, deadline - time.monotonic()))
            if reply.get("id") == rid and reply.get("type") not in ("searchParsed", "nameMatches"):
                return reply

    def close(self) -> int:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        try:
            return self.proc.wait(timeout=10)
        finally:
            if self.proc.poll() is None:
                self.proc.kill()
            self.stderr.close()

    def log(self) -> str:
        return read(self.log_dir / "engine.log")


def build_fixture(case_dir: Path, fixture: dict[str, Any]) -> Path:
    """A fresh `root` folder inside `case_dir`, laid out as the spec's fixture says."""
    root = case_dir / "root"
    root.mkdir(parents=True)
    for folder in fixture.get("folders", []):
        (root / folder).mkdir(parents=True, exist_ok=True)
    for path, content in fixture.get("files", {}).items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode("utf-8"))
    return root


def snapshot(case_dir: Path) -> dict[str, bytes | str]:
    """Every item under `case_dir` (so also anything that escaped `root`), with file bytes."""
    return {
        p.relative_to(case_dir).as_posix(): "<dir>" if p.is_dir() else p.read_bytes()
        for p in sorted(case_dir.rglob("*"))
    }


def diff(before: dict[str, Any], after: dict[str, Any]) -> str:
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed = sorted(k for k in set(before) & set(after) if before[k] != after[k])
    parts = [f"{label}: {items}" for label, items in (("added", added), ("removed", removed), ("changed", changed)) if items]
    return "; ".join(parts) or "no change"


def icacls(*args: str) -> None:
    subprocess.run(["icacls", *args], check=True, capture_output=True)


def live_checks(repo: Path, spec: dict[str, Any], r: Report, keep: bool) -> None:
    try:
        import jsonschema  # noqa: F401  (the engine validates every message with it)
    except ImportError:
        r.fail("live: environment", "jsonschema missing: run with `uv run --project engine python ...`")
        return

    probes, fixture = spec["probes"], spec["fixture"]
    request_type, reply_type = spec["request"], spec["reply"]
    template = probes["request"]
    invalid_code = probes.get("invalidCode", "invalidName")
    exists_code = probes.get("existsCode", "fileExists")
    missing_code = probes.get("missingCode", "folderNotFound")
    success = probes["success"]
    work = Path(tempfile.mkdtemp(prefix="fb2-validate-"))
    log_dir = work / "logs"
    log_dir.mkdir()
    engine = Engine(repo / "engine", log_dir)
    cases = 0

    def case(label: str, fields: Any, name: str | None, expect_code: str | None,
             before_send: Callable[[Path], Callable[[], None] | None] | None = None) -> None:
        """One probe on a fresh fixture. An expected error must leave the disk untouched."""
        nonlocal cases
        cases += 1
        case_dir = work / f"case{cases:02d}"
        root = build_fixture(case_dir, fixture)
        before = snapshot(case_dir)
        undo = before_send(root) if before_send else None
        try:
            reply = engine.request({"type": request_type, **fill(fields, root, name)})
        except queue.Empty:
            r.fail(f"live: {label}", "no reply within 15 s")
            return
        finally:
            if undo:
                undo()
        after = snapshot(case_dir)
        if expect_code is None:
            check_success(label, root, case_dir, reply, before, after, name)
            return
        got = reply.get("code") if reply.get("type") == "error" else reply.get("type")
        problems = []
        if got != expect_code:
            problems.append(f"expected error {expect_code}, got {got}")
        if after != before:
            problems.append(f"disk changed ({diff(before, after)})")
        r.check(not problems, f"live: {label}", "; ".join(problems))

    def check_success(label: str, root: Path, case_dir: Path, reply: dict[str, Any],
                      before: dict[str, Any], after: dict[str, Any], name: str | None) -> None:
        problems = []
        if reply.get("type") != reply_type:
            problems.append(f"expected {reply_type}, got {reply.get('type')} {reply.get('code', '')}".strip())
        for key, value in fill(success.get("reply", {}), root, name).items():
            if reply.get(key) != value:
                problems.append(f"reply.{key} is {reply.get(key)!r}, expected {value!r}")
        expected: dict[str, Any] = dict(before)
        for item in success.get("removed", []):
            if expected.pop(f"root/{fill(item, root, name)}", None) is None:
                problems.append(f"spec lists '{item}' as removed but the fixture lacks it")
        for item in success.get("created", []):
            key = f"root/{fill(item['path'], root, name)}"
            if item["kind"] == "folder":
                expected[key] = "<dir>"
            else:
                expected[key] = fill(item.get("content", ""), root, name).encode("utf-8")
        if after != expected:
            problems.append(f"disk is not as expected ({diff(expected, after)})")
        r.check(not problems, f"live: {label}", "; ".join(problems))

        listing_path = success.get("listFolder")
        if listing_path and not problems:
            listing = engine.request({"type": "listFolder", "path": fill(listing_path, root, name)})
            names = {e.get("name") for e in listing.get("entries", [])}
            wanted = [fill(i["path"], root, name).split("/")[-1] for i in success.get("created", [])]
            r.check(
                listing.get("type") == "folderListing" and all(w in names for w in wanted),
                "live: the refresh listing shows the result",
                f"listFolder replied {listing.get('type')}; entries {sorted(n for n in names if n)}",
            )

    try:
        ready = engine.read()
        if not r.check(ready.get("type") == "ready", "live: engine starts and sends ready", f"got {ready}"):
            return

        case("success: " + str(success.get("name")), template, success.get("name"), None)

        if probes.get("nameField", "name"):
            skipped = set(probes.get("allowNames", []))
            for bad in [*INVALID_NAMES, *probes.get("extraInvalidNames", [])]:
                if bad not in skipped:
                    case(f"rejects invalid name {bad[:40]!r}", template, bad, invalid_code)
        else:
            r.skip("live: invalid names", "spec sets nameField to null")

        for existing in probes.get("existingNames", []):
            case(f"never overwrites existing {existing!r}", template, existing, exists_code)
        if not probes.get("existingNames"):
            r.skip("live: existing names", "spec lists no existingNames")

        if probes.get("missingFolder"):
            case("missing folder: nothing created", {**template, **probes["missingFolder"]}, success.get("name"), missing_code)
        else:
            r.skip("live: missing folder", "spec has no missingFolder")

        denied = probes.get("denied")
        if denied and os.name == "nt":
            def deny(root: Path) -> Callable[[], None]:
                target = fill(denied["path"], root, None)
                icacls(target, "/deny", f"{EVERYONE}:{denied.get('rights', '(WD)')}")
                return lambda: icacls(target, "/remove:d", EVERYONE)
            case("denied folder: accessDenied, nothing created", template, success.get("name"), denied.get("code", "accessDenied"), deny)
        else:
            r.skip("live: denied folder", "no 'denied' probe in spec" if not denied else "Windows only")

        for extra in probes.get("cases", []):
            case(extra["label"], {**template, **extra.get("request", {})}, extra.get("name"), extra.get("expectCode"))
    finally:
        code = engine.close()
        r.check(code == 0, "live: engine exits cleanly", f"exit code {code}")
        log = engine.log()
        r.check("violates its schema" not in log, "live: every message matched its schema", f"see {log_dir / 'engine.log'}")
        private = [n for n in [success.get("name"), *probes.get("existingNames", [])] if n and n in log]
        r.check(not private, "live: the engine log holds no file names", f"logged: {private}")
        if keep:
            print(f"(kept probe folders in {work})")
        else:
            shutil.rmtree(work, ignore_errors=True)


# ----- stage 3: project suites ----------------------------------------------------------------


def run_suites(repo: Path, r: Report) -> None:
    npm = shutil.which("npm")
    suites: list[tuple[str, list[str], Path]] = [("engine pytest", [sys.executable, "-m", "pytest", "-q"], repo / "engine")]
    if npm:
        suites += [("app typecheck", [npm, "run", "typecheck"], repo / "app"), ("app vitest", [npm, "test"], repo / "app")]
    else:
        r.fail("tests: npm", "npm not on PATH")
    for label, command, cwd in suites:
        done = subprocess.run(command, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        # Node prints certificate warnings on this machine; they aren't test output.
        output = [line for line in (done.stdout + done.stderr).strip().splitlines() if not line.startswith("Warning:")]
        tally = next((line.strip() for line in reversed(output) if re.search(r"^\s*Tests\s+\d|\d+ passed", line)), "")
        tail = " | ".join(line.strip() for line in output[-12:])
        r.check(done.returncode == 0, f"tests: {label}" + (f" ({tally})" if tally else ""), f"exit {done.returncode}: {tail}")


# ----- main -----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate one File Browser file operation against its spec.")
    parser.add_argument("--spec", required=True, type=Path, help="specs/<operation>.json")
    parser.add_argument("--repo", type=Path, help="repository root (found from the current folder otherwise)")
    parser.add_argument("--static-only", action="store_true", help="check the wiring only: a to-do list while building")
    parser.add_argument("--run-tests", action="store_true", help="also run engine pytest, app typecheck and app vitest")
    parser.add_argument("--keep", action="store_true", help="keep the probe folders and engine log")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        repo = (args.repo or find_repo(Path.cwd())).resolve()
        spec = load_spec(args.spec)
    except SpecError as exc:
        print(f"ERROR {exc}")
        return 2

    print(f"Validating {spec['operation']} ({spec['request']} -> {spec['reply']}), status {spec['status']}, in {repo}\n")
    r = Report()
    static_checks(repo, spec, r)
    if args.static_only:
        r.skip("live", "--static-only")
    elif any(row[0] == "FAIL" for row in r.rows):
        r.skip("live", "static checks failed: wire every layer first")
    else:
        live_checks(repo, spec, r, args.keep)
    if args.run_tests:
        run_suites(repo, r)
    return r.summary()


if __name__ == "__main__":
    sys.exit(main())
