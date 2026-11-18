"""Run local release checks; never commit or publish."""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-script', default='build')
    args = parser.parse_args()
    root = Path.cwd()
    engine, app = root / 'engine', root / 'app'
    if not engine.is_dir() or not (app / 'package.json').is_file():
        print('BLOCKED: Run from the File Browser repository root.')
        return 1
    try:
        scripts = json.loads((app / 'package.json').read_text(encoding='utf-8'))['scripts']
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'BLOCKED: Cannot read npm scripts: {exc}')
        return 1
    results = []

    def run(label, command, cwd, clean=False):
        exe = shutil.which(command[0])
        if not exe:
            print(f'BLOCKED: {label}: {command[0]} not found')
            results.append((label, False))
            return
        print(f'\n=== {label}: {" ".join(command)} ===', flush=True)
        try:
            result = subprocess.run([exe, *command[1:]], cwd=cwd,
                                    capture_output=True, text=True, errors='replace',
                                    timeout=900, check=False)
            print(result.stdout, end='')
            print(result.stderr, end='')
            ok = result.returncode == 0 and (not clean or not result.stdout.strip())
            print(f'Exit code: {result.returncode}; {"PASS" if ok else "FAIL"}', flush=True)
        except (OSError, subprocess.TimeoutExpired) as exc:
            print(f'BLOCKED: {exc}')
            ok = False
        results.append((label, ok))

    run('Python tests', ['uv', 'run', 'pytest'], engine)
    for label, script in [('Typecheck', 'typecheck'), ('Frontend tests', 'test'), ('Build', args.build_script)]:
        if script not in scripts:
            print(f'BLOCKED: Missing npm script {script}')
            results.append((label, False))
        else:
            run(label, ['npm', 'run', script], app)
    run('Git clean worktree', ['git', 'status', '--porcelain'], root, clean=True)
    print('\n=== Summary ===')
    for label, ok in results:
        print(f'{"PASS" if ok else "FAIL/BLOCKED"}: {label}')
    passed = sum(ok for _, ok in results)
    print(f'{passed} passed, {len(results)-passed} failed/blocked')
    print('Manual desktop smoke test and release-build scope: require separate confirmation.')
    return 0 if all(ok for _, ok in results) else 1


if __name__ == '__main__':
    sys.exit(main())
