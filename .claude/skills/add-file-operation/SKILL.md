---
name: add-file-operation
description: Implement or extend file management features in the File Browser, including buttons and actions for creating, renaming, deleting, copying, moving, or duplicating files and creating folders. Use when asked to add a new file operation or change its behavior. Do not use for visual styling, layout changes, code explanations, or ordinary file creation and editing in the project.

---

# Add a file operation

## Goal

Add **one** file operation to the File Browser, safely and end to end. The operation goes from a UI
control, through the existing protocol, to the Python engine, which does the write. It ships with
tests at every layer and a spec that the reusable validator checks against the real engine.

Create File (`createFile`) is the proven reference implementation. Every step below points at it.

## Scope

- One operation per run. Don't implement others "while you're there".
- Don't change other operations (Create File included). Moving a shared helper is allowed only
  if its behaviour stays the same and its tests stay green.
- Offline only. No external services and no network dependencies. Adding any new dependency is the
  user's decision.
- Delete is out of scope unless the user explicitly asks and approves a design
  ([safety-rules.md](references/safety-rules.md#9-privacy-and-scope)).

## Helpers (every file in this skill)

| File | What it's for |
|------|---------------|
| [references/architecture.md](references/architecture.md) | The request path, the 15 touchpoints in build order, the refresh rule, conventions |
| [references/safety-rules.md](references/safety-rules.md) | Name rules, containment, atomic no-overwrite primitives, permissions, error codes, cancellation, privacy, UI behaviour |
| [references/operations.md](references/operations.md) | Starting designs for Create File, Create Folder, Rename File and Copy File |
| [references/testing.md](references/testing.md) | Test layers with Create File templates, the required case matrix, test commands |
| [references/validation.md](references/validation.md) | Dependencies, the spec format, what the validator probes, exit codes, troubleshooting |
| [scripts/validate_operation.py](scripts/validate_operation.py) | Reusable validator: static wiring, live engine probes, project suites |
| [scripts/check_skill.py](scripts/check_skill.py) | Self-check of this skill package, plus live validation of every implemented spec |
| [specs/create-file.json](specs/create-file.json) | The spec of the reference implementation: copy it for a new operation |
| [specs/rename-file.json](specs/rename-file.json) | Rename File: rename one file in its own folder (row menu and F2) |

When you add `specs/<op>.json`, add a link to it in this table. `check_skill.py` fails while any
file in this folder isn't linked from here.

## Dependencies

- **Python 3.14 through `uv`**: the engine's environment (`engine/pyproject.toml`), with the dev group
  (`pytest` 9.2.0, `jsonschema` 4.26.0). Run the scripts with `uv run --project engine python`, never
  plain `python`.
- **Node and npm**: the app (`app/package.json`). `npm test` and `npm run typecheck` regenerate the
  protocol types first.
- **Windows**: the adapter and the denied-folder probe (`icacls`) are Windows-specific.
- Both scripts use only the Python standard library.

## Commands

All of these run from the repository root unless a folder is named.

| Purpose | Command |
|---------|---------|
| Wiring to-do list | `uv run --project engine python .claude/skills/add-file-operation/scripts/validate_operation.py --spec .claude/skills/add-file-operation/specs/<op>.json --static-only` |
| Full validation | `uv run --project engine python .claude/skills/add-file-operation/scripts/validate_operation.py --spec .claude/skills/add-file-operation/specs/<op>.json --run-tests` |
| Skill self-check | `uv run --project engine python .claude/skills/add-file-operation/scripts/check_skill.py --with-validation` |
| Engine tests | `uv run pytest -q` (in `engine/`) |
| App types and tests | `npm run typecheck` then `npm test` (in `app/`) |
| Run the app | free port 1420, then `.\node_modules\.bin\tauri.cmd dev` (in `app/`) |

## Workflow

### Step 1: Define the operation

1. Read [operations.md](references/operations.md) for the operation's starting design. For anything
   not listed, answer the questions at the end of that file.
2. Settle with the user, before writing code: the request and reply names, the fields, the new error
   codes, and where the control goes. These names become the protocol contract.
3. Copy [specs/create-file.json](specs/create-file.json) to `specs/<op>.json`. Set `"status": "planned"`
   and fill in every field ([validation.md](references/validation.md#spec-format-specsopjson)).
   Link it in the Helpers table.

### Step 2: Inspect

1. Read [architecture.md](references/architecture.md). Then open the Create File file for each
   touchpoint you'll mirror: `engine/core/create.py`, `engine/main.py`, `app/src/browse/session.ts`,
   `app/src/browse/NewFile.tsx`.
2. Run the **wiring to-do list** command. Every `FAIL` line is a touchpoint still to build.
3. Run the engine and app tests once, so you know they're green before you change anything.

### Step 3: Protocol first

Touchpoints 1–4 in [architecture.md](references/architecture.md#touchpoints-in-build-order): the two
schemas, the examples (one per schema, plus `error-<code>.json` for each new code), and `codes.json`.
Then run `npm run gen:protocol` in `app/` and confirm both new types appear in
`app/src/protocol/generated.ts`.

### Step 4: Engine

1. **Core** (`engine/core/<op>.py`): name rules, containment, the `OSError` → code mapping, and
   cancellation, following [safety-rules.md](references/safety-rules.md) rules 1–7. Reuse
   `name_is_valid`, `child_of` and `folder_error_code`. Don't copy them.
2. **Port**: a method with a docstring that lists its exceptions.
3. **Adapter**: the atomic no-overwrite primitive from the table in safety rule 3. Never use a
   check-then-write on its own.
4. **Handler and channel** (`engine/main.py`): its own channel. Log codes only, never names.
5. Write the core, adapter and stdio tests as you go ([testing.md](references/testing.md)).

### Step 5: UI

1. `client.ts`: add the Request and Reply union entries.
2. `session.ts`: the `BrowseActions` method, its result type, and the implementation with the refresh rule.
3. `AppShell.tsx`: forward the method in `leavingSearch()`.
4. Add `<method>: vi.fn()` to **every** `BrowseActions` fake (`grep -rln "clearPathError: vi.fn" app/src`).
5. The component and where it's mounted, and the catalog keys (`<prefix>.*`, one sentence per error
   code, plus `<prefix>.failed`).
6. Session, component and shell tests ([testing.md](references/testing.md)).

### Step 6: Enforce safety

Go through [safety-rules.md](references/safety-rules.md) rule by rule and point to the line of code
and the test that covers each one. If a rule has no test, write the test before going on.

### Step 7: Validate and fix

1. Run **full validation**.
2. On any `FAIL`: read the `-- why` part, fix the **implementation** (not the spec, unless the spec is
   genuinely wrong, and if so, say so in the report), and run it again.
3. Repeat until it ends with `SUMMARY: N passed, 0 failed` and exit code 0, or until you hit a blocker
   you can't fix. Report a blocker plainly. Never weaken a probe or delete a test to get a pass.
4. Set the spec's `"status": "implemented"`.

## Self-validation

**Don't report success until all of these hold. Run them in this order:**

1. Full validation of the new spec exits 0 with `0 failed`.
2. The skill self-check (`check_skill.py --with-validation`) exits 0. This re-validates **every**
   implemented spec, including Create File, which proves nothing else broke. It also proves this
   skill's links and helpers are still complete.
3. `git status` shows changes only in the touchpoints for this operation, its tests, and its spec.
   Nothing unrelated has changed.
4. If you could launch the app (`tauri.cmd dev`), check the control by eye: it works, the error appears
   inline, and the list refreshes. If you couldn't, say so in the report. Don't claim it.

If any of these fails, the result is *not done*: report it as a blocker with the failing output.

## Success criteria

- The control works in the app and the engine performs the operation.
- An existing item is never overwritten, in any casing, as any kind of item.
- Invalid names and path traversal are rejected with nothing changed on disk.
- No missing folder is ever created. Permissions are inherited and denials are reported.
- The file list refreshes after success, with the result selected.
- Validation and the skill self-check both pass.

## Final report

Report:
- **Files changed**, grouped by layer (protocol, engine, UI, tests, spec)
- **Tests run**: each command and its pass count
- **Validation results**: the `SUMMARY` lines of the validator and the skill self-check
- **Not verified**: anything you didn't check (for example, by eye in the app)
- **Remaining issues and decisions** for the user
