# Release rules

## Prerequisites
- Python 3.9+ (validator uses only the standard library).
- Git, uv, Node.js and npm available on PATH.
- Existing project dependencies installed according to project documentation.
- Rust/Tauri and platform prerequisites if required by the actual desktop build.

## Checks
Run from the repository root. Expected layout: `engine/` and `app/`.

| Check | Working directory | Command |
| --- | --- | --- |
| Python tests | engine | `uv run pytest` |
| Type checking | app | `npm run typecheck` |
| Frontend tests | app | `npm test` |
| Build | app | `npm run build` |
| Git status | root | `git status --porcelain` |

The build command is an assumption: inspect package.json and release documentation first. If the documented release build is another npm script, pass its name with `--build-script NAME`. If the actual release build cannot be represented by an npm script, report a blocker and adapt the validator only with approval. A web-only build is not proof of desktop readiness.

## Running
`python .claude/skills/release-check/validate-release.py`

Optional: `python .claude/skills/release-check/validate-release.py --build-script tauri:build` (only if that script actually exists and is the documented local build).

Exit 0: all configured checks passed and Git is clean. Exit 1: failure, missing prerequisite, or dirty worktree. Automated success is not proof of release readiness: manually launch the Tauri app and test core file operations. Report this separately.

Do not use commands that publish, deploy, commit or push. Inspect npm scripts and lifecycle hooks before running; builds and tests may generate local artifacts. Do not delete or revert user files. Do not install dependencies without approval. Do not claim a skipped or unverified check passed.
