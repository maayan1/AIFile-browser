# Validation: the spec format and the scripts

## Dependencies

| Need | Version on this machine | Used by |
|------|------------------------|---------|
| Python | 3.14, through `uv` (`engine/pyproject.toml`) | both scripts and the engine they start |
| `jsonschema` | 4.26.0, from the engine dev group | the engine's protocol validation (`FB2_VALIDATE_PROTOCOL=1`) during live probes |
| `pytest` | 9.2.0, from the engine dev group | `--run-tests` |
| Node and npm | from `app/package.json` | `--run-tests` (typecheck, vitest) |
| `icacls` | Windows built-in | the denied-folder probe (skipped on other systems) |

The scripts themselves use only the standard library. Always run them through
`uv run --project engine python ...` from the repository root, so the engine they start has its dev
dependencies.

## validate_operation.py

```powershell
# While building: a to-do list of missing wiring (no engine started)
uv run --project engine python .claude/skills/add-file-operation/scripts/validate_operation.py --spec .claude/skills/add-file-operation/specs/<op>.json --static-only

# Done: wiring + live probes + every project suite
uv run --project engine python .claude/skills/add-file-operation/scripts/validate_operation.py --spec .claude/skills/add-file-operation/specs/<op>.json --run-tests
```

| Flag | Effect |
|------|--------|
| `--spec PATH` | Required. The operation's spec. |
| `--static-only` | Only check the wiring. |
| `--run-tests` | Also run `uv run pytest -q` (engine), `npm run typecheck` and `npm test` (app). |
| `--keep` | Keep the probe folders and the engine log (the path is printed). |
| `--repo PATH` | Repository root, if it isn't found from the current folder. |

Each output line is `PASS`, `FAIL` or `SKIP`, then the check, then `-- why` on failure. The last line
is `SUMMARY: N passed, M failed, K skipped`. **Exit codes:** `0` everything passed, `1` a check
failed, `2` the spec or the environment can't be used. Live probes are skipped while any static check
fails.

### What the live stage proves

It starts the real engine (`python main.py`, with `FB2_VALIDATE_PROTOCOL=1`, as Tauri does in
development). For each probe it builds a fresh fixture in a temp folder, sends one request, and
snapshots every byte under the probe folder before and after:

1. **Success:** the reply type and fields, the disk changed exactly as `created` and `removed` say,
   and a `listFolder` (the UI's refresh) lists the result.
2. **Every invalid name** (about 28 built in, plus `extraInvalidNames`): the invalid code, and no change on disk.
3. **Every `existingNames` entry:** the exists code, and no change (nothing overwritten).
4. **`missingFolder`:** the missing code, and nothing created anywhere.
5. **`denied`:** an Everyone-deny ACL on the path, then the code, and no change. The ACL is always restored.
6. **`cases`:** custom probes.
7. **After all probes:** the engine exits 0, no message violated its schema, and the log contains no probed file name.

## Spec format (`specs/<op>.json`)

Copy [create-file.json](../specs/create-file.json) and edit it. Every field:

| Field | Meaning |
|-------|---------|
| `operation` | A readable name ("Rename File"). |
| `status` | `planned` while you build it, `implemented` once it validates. `check_skill.py --with-validation` live-validates only `implemented` specs. |
| `request`, `reply` | camelCase message types. Schemas are expected at `protocol/schemas/<type>.schema.json`. |
| `channel` | The engine channel. It must be used by this request only. |
| `errorCodes` | Every code the operation can end with. Each must be in `codes.json` and have a catalog sentence. |
| `newErrorCodes` | The codes this operation introduces. Each needs an `error`-type example. |
| `catalogPrefix` | The UI catalog prefix (`newFile`). `<prefix>.<code>` and `<prefix>.failed` must exist. |
| `sessionMethod` | The `BrowseActions` method, or `null` for an operation with no browse UI. |
| `portMethod` | The `FileSystemPort` and `WindowsFileSystem` method name. |
| `files` | Role → path (or a list of paths) that must exist: core, tests, UI component. |
| `fixture` | `folders` (list) and `files` (path → UTF-8 content), built fresh for each probe under `{root}`. |
| `probes.request` | The request fields (without `id` and `type`). `{root}` is the fixture folder, `{name}` is the probed name. |
| `probes.nameField` | The field holding the user's name; `null` skips the invalid-name probes. |
| `probes.success` | `name`, the `reply` fields expected, `created` (`[{path, kind: file\|folder, content}]`), `removed` (paths), and `listFolder` (the folder to list for the refresh check). |
| `probes.existingNames` | Names that already exist in the fixture (vary the casing; include a folder). |
| `probes.missingFolder` | Fields to override so the folder or source is missing. |
| `probes.denied` | `{path, rights, code}`: deny `rights` (icacls syntax: `(WD)` add file, `(AD)` add folder, `(D)` delete) on `path`. |
| `probes.invalidCode`, `existsCode`, `missingCode` | Override the defaults `invalidName`, `fileExists`, `folderNotFound`. |
| `probes.extraInvalidNames`, `allowNames` | Add to the built-in invalid list, or exempt names from it. |
| `probes.cases` | `[{label, request (field overrides), name, expectCode (null = success)}]`. |

## check_skill.py

```powershell
uv run --project engine python .claude/skills/add-file-operation/scripts/check_skill.py --with-validation
```

It checks the skill package: frontmatter, SKILL.md under 500 lines, every link resolves, at least one
reference is linked, **every file in the skill folder is linked from SKILL.md**, the scripts compile,
the specs load, and the validator *fails* on a deliberately unwired spec (so it isn't vacuous). With
`--with-validation` it also live-validates every `implemented` spec. Same exit codes.

## Troubleshooting

- `jsonschema missing`: you ran plain `python`. Use `uv run --project engine python`.
- `no reply within 15 s`: the request type isn't registered, or the handler is blocked. Check the
  engine log with `--keep`.
- The denied probe leaves a folder you can't delete: run `icacls <path> /remove:d *S-1-1-0`.
- The app won't start under `tauri dev`: port 1420 is taken by a stray `vite`. Stop it, then run
  `.\node_modules\.bin\tauri.cmd dev` in `app/`.
