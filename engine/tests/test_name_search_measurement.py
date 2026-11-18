"""The name-search speed tools (Story 2.4): the large-tree generator and the measurement script.

Small trees in temp folders only: the generator's determinism and refusal, each of the 20
searches' intended match range on a scaled-down tree, and the script end to end against the real
engine (its report, exit codes, and a missing folder).
"""

from __future__ import annotations

import io
import os
import subprocess
import sys
from pathlib import Path

import pytest

from core.search.query import matches, normalize
from scripts import measure_name_search as measure

ENGINE_DIR = Path(__file__).resolve().parents[1]
GENERATOR = ENGINE_DIR.parent / "fixtures" / "make_large_tree.py"
SCRIPT = ENGINE_DIR / "scripts" / "measure_name_search.py"
UTF8 = dict(os.environ, PYTHONIOENCODING="utf-8")


def generate(folder: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GENERATOR), str(folder), *args],
        capture_output=True, text=True, encoding="utf-8", env=UTF8, timeout=120,
    )


def relative_paths(root: Path) -> list[str]:
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=ENGINE_DIR, capture_output=True, text=True, encoding="utf-8", env=UTF8, timeout=300,
    )


@pytest.fixture(scope="module")
def small_tree(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("tree") / "large"
    result = generate(root, "--files", "500")
    assert result.returncode == 0, result.stderr
    return root


def test_the_same_seed_gives_the_same_paths_and_another_seed_does_not(tmp_path: Path) -> None:
    first, second, other = tmp_path / "first", tmp_path / "second", tmp_path / "other"
    for folder, seed in [(first, "7"), (second, "7"), (other, "8")]:
        result = generate(folder, "--seed", seed, "--files", "300")
        assert result.returncode == 0, result.stderr
    paths = relative_paths(first)
    assert paths == relative_paths(second)
    assert paths != relative_paths(other)
    files = [p for p in first.rglob("*") if p.is_file()]
    assert len(files) == 300
    assert all(p.stat().st_size == 0 for p in files)
    assert len([p for p in first.rglob("*") if p.is_dir()]) == 15  # one folder per 20 files


def test_it_prints_the_counts(tmp_path: Path) -> None:
    result = generate(tmp_path / "tree", "--files", "200")
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("seed 2024: 200 files in 10 folders (largest folder: ")


@pytest.mark.parametrize("content", ["file", "folder"])
def test_a_folder_that_is_not_empty_is_refused_and_left_as_it_was(tmp_path: Path, content: str) -> None:
    root = tmp_path / "busy"
    root.mkdir()
    (root / "keep.txt").write_bytes(b"") if content == "file" else (root / "inner").mkdir()
    before = relative_paths(root)

    result = generate(root, "--files", "50")

    assert result.returncode == 2
    assert "not an empty folder" in result.stderr
    assert result.stdout == ""
    assert relative_paths(root) == before


def test_a_missing_parent_is_refused_and_not_created(tmp_path: Path) -> None:
    result = generate(tmp_path / "missing" / "tree", "--files", "10")
    assert result.returncode == 2
    assert "doesn't exist" in result.stderr
    assert not (tmp_path / "missing").exists()


def test_a_file_in_place_of_the_folder_is_refused(tmp_path: Path) -> None:
    target = tmp_path / "a-file"
    target.write_bytes(b"x")
    result = generate(target)
    assert result.returncode == 2
    assert target.read_bytes() == b"x"


def test_there_are_20_searches_of_every_intended_kind() -> None:
    kinds = [s.kind for s in measure.SEARCHES]
    assert len(measure.SEARCHES) == 20
    assert len({normalize(s.text) for s in measure.SEARCHES}) == 20
    assert kinds.count(measure.NONE) == 1
    assert kinds.count(measure.LETTER) == 2
    assert [s.text for s in measure.SEARCHES if s.kind == measure.EXTENSION] == [".pdf"]
    assert {measure.RARE, measure.COMMON} <= set(kinds)
    hebrew = [s for s in measure.SEARCHES if any("֐" <= c <= "׿" for c in s.text)]
    assert {s.kind for s in hebrew} == {measure.RARE, measure.COMMON}


def test_each_search_hits_its_intended_range_on_a_scaled_down_tree(tmp_path: Path) -> None:
    root = tmp_path / "tree"
    files = 2_000
    assert generate(root, "--files", str(files)).returncode == 0
    names = [p.name for p in root.rglob("*")]  # files and folders, as name search matches them

    for search in measure.SEARCHES:
        needle = normalize(search.text)
        found = sum(matches(name, needle) for name in names)
        low, high = measure.expected_range(search.kind, files)
        assert low <= found <= high, (search, found, (low, high))

    # The documented shape: folders nest at most MAX_DEPTH (6) levels below the root, and the three
    # very large folders hold their shares (6%, 5% and 4% of the files) while the rest hold ~20.
    folders = [p for p in root.rglob("*") if p.is_dir()]
    assert max(len(p.relative_to(root).parts) for p in folders) == 6
    sizes = sorted((sum(c.is_file() for c in p.iterdir()) for p in folders), reverse=True)
    assert all(size >= share for size, share in zip(sizes, [120, 100, 80])), sizes[:4]
    assert sizes[3] < 60


def test_expected_ranges_scale_except_the_fixed_kinds() -> None:
    assert measure.expected_range(measure.COMMON) == (100, 2_000)
    assert measure.expected_range(measure.COMMON, 5_000) == (10, 200)
    assert measure.expected_range(measure.LETTER, 50_000) == (10_000, 99_999)
    assert measure.expected_range(measure.RARE, 500) == (1, 10)
    assert measure.expected_range(measure.NONE, 500) == (0, 0)


def test_p90_is_the_nearest_rank() -> None:
    times = [float(n) for n in range(20, 0, -1)]  # 1 .. 20 in any order
    assert measure.p90(times) == 18.0
    assert measure.p90([3.0]) == 3.0


def test_the_script_measures_a_small_tree_end_to_end(small_tree: Path) -> None:
    result = run_script(str(small_tree))

    assert result.returncode == 0, result.stdout + result.stderr
    lines = result.stdout.splitlines()
    assert lines[0] == f"tree: {small_tree.resolve()}"
    first = [line for line in lines if line.startswith("first search after start:")]
    assert len(first) == 1 and "not counted" in first[0] and "ok" in first[0]
    rows = [line.split() for line in lines if line[:2].strip().isdigit()]
    assert [int(row[0]) for row in rows] == list(range(1, 21))
    for row, search in zip(rows, measure.SEARCHES):
        found = int(row[-1])
        low, high = measure.expected_range(search.kind, 500)
        assert low <= found <= high, (search, found)
        assert float(row[-2]) >= 0
    assert any(line.startswith("median ") and " p90 " in line and " max " in line for line in lines)
    assert lines[-1] == "verdict: PASS"


def test_a_miss_reports_the_same_and_exits_1(small_tree: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(measure, "P90_LIMIT", 0.0)
    out = io.StringIO()
    assert measure.measure(str(small_tree.resolve()), out=out) == 1
    report = out.getvalue()
    assert "p90 target: under 0 s: MISSED" in report
    assert report.rstrip().endswith("verdict: FAIL")


def test_a_slow_first_search_alone_is_a_miss(small_tree: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(measure, "FIRST_LIMIT", -1.0)
    out = io.StringIO()
    assert measure.measure(str(small_tree.resolve()), out=out) == 1
    assert "MISSED; not counted" in out.getvalue()
    assert "p90 target: under 6 s: ok" in out.getvalue()


def test_a_missing_folder_exits_2_with_a_message(tmp_path: Path) -> None:
    result = run_script(str(tmp_path / "gone"))
    assert result.returncode == 2
    assert "not a folder" in result.stderr


def test_an_engine_error_exits_2_and_closes_the_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    started: list[measure.Engine] = []
    real = measure.Engine

    def recorded(*args: object) -> measure.Engine:
        started.append(real(*args))  # type: ignore[arg-type]
        return started[-1]

    monkeypatch.setattr(measure, "Engine", recorded)
    out = io.StringIO()
    # Past the script's own folder check: the engine itself answers folderNotFound.
    assert measure.measure(str(tmp_path / "gone"), out=out) == 2
    assert "engine failed: search ended with error folderNotFound" in out.getvalue()
    assert len(started) == 1 and started[0].proc.poll() is not None


# A stand-in engine: says ready, then answers the first search with `reply` (raw bytes).
FAKE_ENGINE = """
import sys, time
out = sys.stdout.buffer
out.write(b'{{"id":null,"type":"ready","protocolVersion":1}}\\n')
out.flush()
sys.stdin.buffer.readline()
out.write({reply!r})
out.flush()
time.sleep(2)
"""


@pytest.mark.parametrize(
    ("reply", "says"),
    [
        (b"not json\n", "unreadable engine line"),
        (b'{"id":"m1","type":"nameMatches"\xff}\n', "unreadable engine line"),
        (b'{"id":"m1","type":"nameMatches"}\n', "a nameMatches reply without its matches"),
    ],
    ids=["not-json", "not-utf8", "no-matches"],
)
def test_a_broken_engine_reply_reports_engine_failed_and_exits_2(
    small_tree: Path, monkeypatch: pytest.MonkeyPatch, reply: bytes, says: str
) -> None:
    real = subprocess.Popen

    def fake(args: list[str], **kwargs: object) -> subprocess.Popen[bytes]:
        return real([sys.executable, "-c", FAKE_ENGINE.format(reply=reply)], **kwargs)  # type: ignore[call-overload]

    monkeypatch.setattr(measure.subprocess, "Popen", fake)
    out = io.StringIO()
    assert measure.measure(str(small_tree.resolve()), out=out) == 2
    assert f"engine failed: {says}" in out.getvalue()


def test_a_failed_send_reports_engine_failed_and_exits_2(small_tree: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenPipe:
        def write(self, data: bytes) -> None:
            raise BrokenPipeError(32, "Broken pipe")

        def flush(self) -> None: ...

        def close(self) -> None: ...

    real = measure.Engine

    def broken(*args: object) -> measure.Engine:
        engine = real(*args)  # type: ignore[arg-type]
        assert engine.proc.stdin is not None
        engine.proc.stdin.close()  # the real engine stops; the next send fails
        engine.proc.stdin = BrokenPipe()  # type: ignore[assignment]
        return engine

    monkeypatch.setattr(measure, "Engine", broken)
    out = io.StringIO()
    assert measure.measure(str(small_tree.resolve()), out=out) == 2
    assert "engine failed: couldn't send to the engine" in out.getvalue()
