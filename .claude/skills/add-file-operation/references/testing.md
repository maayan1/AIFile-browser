# Testing approach

Test every layer separately, using the Create File tests as templates. Use a fake port for rules,
real temp folders for the adapter, the real engine process for the protocol, and jsdom for the UI.

## Layers and their Create File templates

| Layer | Template file | What it proves |
|-------|---------------|----------------|
| Core rules (fake `FileSystemPort`) | `engine/tests/test_create_core.py` (`CreateFs` fake) | Name rules, containment, the `OSError` → code mapping, nothing written on refusal, cancel before the write |
| Adapter (real temp folders) | `engine/tests/test_windows_fs.py` (`create_file` section) | Atomic no-overwrite in any casing, read-only file or folder counts as existing, no missing parent created, relative path refused, ACL deny → `PermissionError` (`icacls ... /deny *S-1-1-0:(WD)`; restore with `/remove:d`) |
| Engine over stdio | `engine/tests/test_stdio_roundtrip.py` (`createFile` section) | Real replies validated against the schema, the result in the next `listFolder`, invalid names and traversal leave the disk unchanged, runs beside a listing without cancelling it |
| Protocol | `engine/tests/test_protocol_examples.py` | Examples validate, every schema has an example, codes are in `codes.json`, every code has a `<prefix>.<code>` catalog sentence (add the operation's codes to that test) |
| Session | `app/src/browse/session.test.ts` (`BrowseSession.createFile`) | Sends the request, refreshes with the result selected, doesn't pull the user back after they've navigated away, engine restart → `failed` |
| Component | `app/src/browse/NewFile.test.tsx` | Disabled with no listing, focus, trimmed submit, inline error with the form kept open, Esc and Cancel, closes when the folder changes |
| Shell | `app/src/components/shell/AppShell.test.tsx` (`AppShell New file`) | Wired through the shell, disabled while loading or while search is open, all text from the catalog |

## Required case matrix (every operation)

- [ ] Valid operation, including a Hebrew name
- [ ] Target exists: same casing, other casing, and existing as the other kind (file vs folder)
- [ ] Empty name, `.`, `..`
- [ ] Path traversal: `..\x`, `../x`, `sub\x`, `C:\x`, `\\server\share\x`, `a:b`
- [ ] Reserved and malformed names: `CON`, `con.txt`, trailing dot or space, over 255 characters
- [ ] Missing folder or source: `folderNotFound`, and **no folder created**
- [ ] Permission denied: `accessDenied`, nothing created
- [ ] Cancelled before the write: nothing created
- [ ] The UI refreshes after success, with the result selected
- [ ] The user navigated away mid-request: no forced navigation
- [ ] Engine restart mid-request: `failed`, UI still usable
- [ ] Each error code shows its catalog sentence

Every refusal test also asserts that **the disk is unchanged**: compare a listing or the bytes before
and after, not only the error code.

## Commands

```powershell
# Engine (from engine/)
uv run pytest -q
uv run pytest -q tests/test_create_core.py -k exists   # one file / one case

# App (from app/): gen:protocol runs first automatically
npm run typecheck
npm test
npx vitest run src/browse/NewFile.test.tsx              # one file
```

To check the app by eye: free port 1420, then in `app/` run `.\node_modules\.bin\tauri.cmd dev`.
