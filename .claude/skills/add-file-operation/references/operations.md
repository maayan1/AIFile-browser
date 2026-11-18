# Operation notes

These are starting designs, based on the Create File implementation. Confirm the names with the user
before writing schemas: once the protocol is published it's hard to change.

## Create File (implemented: the reference)

- `createFile {folder, name}` → `fileCreated {path, name}`
- Codes: `invalidName`, `fileExists`, plus the folder codes
- Core: `engine/core/create.py`. Port: `create_file(path)`. UI: `NewFile.tsx` in `TopBar`, prefix `newFile`
- Spec: [create-file.json](../specs/create-file.json)

## Create Folder

- `createFolder {folder, name}` → `folderCreated {path, name}`
- Codes: reuse `invalidName` and `fileExists`. A file *or* folder with that name blocks it. Then the folder codes.
- Port: `create_folder(path)` → `os.mkdir(path)`. **Never** `makedirs` or `exist_ok`.
- Core: reuse `name_is_valid`, `child_of` and the containment check from `core/create.py`. Consider
  moving them to a shared `core/names.py` first (a behaviour-preserving refactor that keeps
  `test_create_core.py` green).
- UI: a "New folder" control next to New file in `TopBar`, prefix `newFolder`.
- Refresh: `showInFolder` with the new folder's path, so it's selected (not opened).
- Spec probe: `created: [{"path": "{name}", "kind": "folder"}]`.

## Rename File

- `renameItem {path, newName}` → `itemRenamed {oldPath, path, name}`
- Allowed root: the item's own parent folder. The new name is one name (rule 1). The result's parent
  must be the source's parent: rename never moves an item.
- Codes: `invalidName`, `fileExists`, `folderNotFound` (the source is gone), `accessDenied`, and maybe
  `fileInUse` (winerror 32: another program has the file open). That one is new, so add it to
  `codes.json` with a sentence.
- Port: `rename(src, dst)` → `os.rename`. Decide case-only renames explicitly (allowed, same item).
- UI: a "Rename" item in `RowMenu` and F2 in `shortcuts.ts`. Prefill the current name with the stem
  selected (not the extension). Prefix `rename`.
- Refresh: `showInFolder` with the *new* path.
- Spec probes: `request {"path": "{root}\\existing.txt", "newName": "{name}"}`,
  `removed: ["existing.txt"]`, `created: [{"path": "{name}", "kind": "file", "content": "keep me"}]`.
  The fixture needs a second file (for example `other.txt`) to use in `existingNames`.

## Copy File

- `copyFile {path, folder, name?}` → `fileCopied {path, name}`. With no `name`, decide the default
  explicitly (for example `notes - Copy.txt`, the way Explorer does it).
- Codes: as Rename, plus `folderNotFound` for the destination.
- Port: `copy_file(src, dst, token)`. Open `dst` with `O_CREAT | O_EXCL`, stream `src` in 1 MiB chunks,
  and check the token between chunks. On any failure or cancel, close and delete **only** `dst`. Copy
  the modification time only if the user asks for it.
- Channel: its own (`copyFile`). It may be long, so the UI shows progress or busy and allows cancel
  (`{"type": "cancel", "id": ...}`).
- Never copies folders. That would be a separate operation with its own rules.
- Spec probe: `created: [{"path": "{name}", "kind": "file", "content": "keep me"}]`, source unchanged.

## Anything else

Before writing code, answer these: the request and reply names, the allowed root, the atomic
primitive, the new error codes, where the control goes, what gets selected after the refresh, and
whether it can take long (cancellation).
