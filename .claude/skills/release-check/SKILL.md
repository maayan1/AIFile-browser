---
name: release-check
description: Run an explicit pre-release readiness check for the File Browser project and report test, build, and Git status. Not for routine feature development or publishing.
disable-model-invocation: true
---

# Release Check

## Goal
Assess release readiness without committing, pushing, publishing, or changing application code.

## Workflow
1. Read [release-rules.md](release-rules.md).
2. Identify the project root and inspect `app/package.json`, the Python project configuration, and documented build commands. Confirm that the configured checks match the project. Do not substitute a frontend-only build for a desktop release build.
3. From the project root, run [validate-release.py](validate-release.py):

   ```sh
   python .claude/skills/release-check/validate-release.py
   ```

   See the reference for prerequisites and the optional build script argument.
4. Inspect the output and exit code. If a check cannot run, report a blocker; do not declare success or silently skip it.
5. Report every check, exit code, Git status, and outstanding manual desktop smoke test. Do not fix files without permission.

## Success criteria
All automated checks pass, the Git worktree is clean, and the documented release build and manual smoke test are confirmed. Otherwise report what remains unverified.
