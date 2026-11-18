# Architecture: where a file operation lives

Every file operation goes through the same path that Create File (`createFile`) already uses. Copy
that path layer by layer. Don't invent a new bridge.

## The request path

```
UI component (app/src/browse/<Op>.tsx, mounted in TopBar or RowMenu)
  -> BrowseSession.<method>()           app/src/browse/session.ts
  -> ProtocolClient.request()           app/src/protocol/client.ts   (typed by generated.ts)
  -> Tauri command engine_send          app/src-tauri/src/engine.rs  (forwards the JSON line; no per-type code)
  -> engine stdin, one JSON line        protocol/schemas/<request>.schema.json
  -> StdioTransport channel             engine/adapters/stdio_transport.py
  -> <op>_handler(fs)                   engine/main.py
  -> core function                      engine/core/<op>.py          (pure rules, no os/pathlib)
  -> FileSystemPort.<port_method>()     engine/core/ports/filesystem.py
  -> WindowsFileSystem.<port_method>()  engine/adapters/windows_fs.py (the only code that touches disk)
  <- reply line: <reply> or {"type":"error","code":...}  back the same way
```

- **Hexagonal engine.** `engine/core` never imports `os`, `pathlib`, `json`, `shutil` or the adapters.
  `engine/tests/test_import_direction.py` enforces this. The core decides; the port acts.
- **Protocol first.** The JSON schemas in `protocol/schemas/` are the contract. The TypeScript types
  in `app/src/protocol/generated.ts` are generated from them by `npm run gen:protocol`, which runs
  automatically before dev, build, test and typecheck. That file is never committed or hand-edited.
- **The Rust bridge doesn't change.** `engine.rs` forwards any line. The only exception is opening a
  file in its default program, which has its own command (`open_file` in `protocol/ipc.json`).
- **No allowed root folder for the whole app.** The allowed root for an operation is the folder
  being acted on: the listed folder (`browse.listing.path`) for creating something, or the item's own
  parent folder for rename and copy. The core resolves that folder through the port and refuses any
  target whose parent isn't exactly that resolved folder.

## Touchpoints, in build order

| # | File | What to add | Create File example |
|---|------|-------------|---------------------|
| 1 | `protocol/schemas/<request>.schema.json` | Draft-07 schema. `title` is the PascalCase type; `type` is a `const`; `id` is required; `additionalProperties: false`. The description lists every error code. | `createFile.schema.json` |
| 2 | `protocol/schemas/<reply>.schema.json` | Success reply, same rules. | `fileCreated.schema.json` |
| 3 | `protocol/examples/*.json` | One single-line example per schema, plus `error-<code>.json` for each new code. Use Hebrew names (the fixtures do). | `create-file.json`, `file-created.json`, `error-file-exists.json`, `error-invalid-name.json` |
| 4 | `protocol/codes.json` | Add the new codes to `errorCodes`. Reuse existing codes when the meaning is the same. | `invalidName`, `fileExists` |
| 5 | `engine/core/<op>.py` | Pure function `(fs, ..., token) -> dict`, an `<Op>Refused(code)` exception, name checks, a containment check, and an `OSError` → code mapping. Reuse `core.errors.folder_error_code`. | `core/create.py` |
| 6 | `engine/core/ports/filesystem.py` | A Protocol method whose docstring says exactly which `OSError` it raises and when. | `create_file(path)` |
| 7 | `engine/adapters/windows_fs.py` | The real call, using an atomic no-overwrite primitive ([safety-rules.md](safety-rules.md)). | `os.open(O_CREAT \| O_EXCL)` |
| 8 | `engine/main.py` | `<op>_handler(fs)` returning a `ChannelHandler`; `transport.register_channel("<request>", "<own channel>", ...)`. Log the code and winerror, never names. | `create_file_handler` |
| 9 | `app/src/protocol/client.ts` | `Omit<Request, "id">` in the `Request` union; the reply title in the `Reply` union. | `CreateFile`, `FileCreated` |
| 10 | `app/src/browse/session.ts` | A `BrowseActions` method, a result type, and the `BrowseSession` implementation with the refresh rule. | `createFile()`, `CreateFileResult` |
| 11 | `app/src/components/shell/AppShell.tsx` | Forward the new method in `leavingSearch()`. Every `BrowseActions` method goes through it. | `createFile: (f, n) => actions.createFile(f, n)` |
| 12 | `app/src/browse/<Op>.tsx` and where it's mounted | The control and its form. Folder-level operations go in `TopBar.tsx`; item-level ones (rename, copy) go in `RowMenu.tsx`. | `NewFile.tsx` in `TopBar.tsx` |
| 13 | `app/src/i18n/catalog.ts` | `<prefix>.*` keys: labels, one sentence per error code, and `<prefix>.failed`. All UI text comes from the catalog (`AppShell.test.tsx` checks this). | `newFile.*` |
| 14 | Every `BrowseActions` test fake | Add `<method>: vi.fn()`. Adding a method to the interface breaks the typecheck in all of them. Find them with `grep -rln "clearPathError: vi.fn" app/src`. | 7 files |
| 15 | Tests per layer | See [testing.md](testing.md). | |

## The refresh rule (UI)

When the engine replies with success, the session lists the folder again with the result selected
and scrolled into view. It does that by navigating to `{ type: "showInFolder", path: reply.path }`
with `"push"`. It does this **only if the session is still active and still showing that folder**:
if the user moved away while the request ran, don't pull them back. An `EngineStoppedError`
(the engine restarted) is reported as `failed` without logging. Anything else is logged with
`console.error` and also reported as `failed`. The UI never throws.

## Conventions

- Comments explain *why*, in plain English. Docstrings say what's raised and when.
- Exact pinned versions only. Adding a dependency is a decision for the user. Never add a network
  dependency: `engine/tests/test_no_network.py` and the CSP enforce offline operation.
- Hebrew file names are first-class. Use one in at least one test per layer, and `dir="auto"` on inputs.
- Running the app: stop any stray `vite` on port 1420, then in `app/` run
  `.\node_modules\.bin\tauri.cmd dev`. On this machine `npm run tauri dev` fails because of a
  PATH/script-shell quirk.
