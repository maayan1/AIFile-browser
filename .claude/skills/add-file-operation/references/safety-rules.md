# Safety rules for every file operation

These rules are the generalised form of the Create File rules, which shipped and passed validation.
They aren't optional: [validate_operation.py](../scripts/validate_operation.py) probes most of them
against the real engine.

## 1. Names are one name, never a path

The engine is the authority. The UI only trims the name; it never validates or builds paths
from the user's text. Reject the name with `invalidName` when it:

- is empty, `.` or `..`
- contains `\ / : * ? " < > |` or a control character (U+0000–U+001F). That covers traversal,
  absolute paths, UNC paths, drive letters and NTFS streams.
- ends with a dot or a space (Windows would silently save it under another name)
- is a reserved device name, with or without an extension (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
  `LPT1`–`LPT9`, and the superscript variants)
- is longer than 255 characters

Reuse `core.create.name_is_valid` (and `INVALID_NAME`) rather than copying it. If an operation needs
different rules, move the shared check to a shared core module first, without changing its behaviour.

## 2. Containment: nothing outside the folder being acted on

1. Resolve the folder through the port (`fs.resolve(folder)`). This normalizes casing and fails for a
   folder that's missing or unreadable, which gives the folder's error code.
2. Join it with the name (`core.create.child_of`).
3. **Check the joined result again:** `parent_of(path) == resolved` and the last segment equals the
   name. If not, refuse with `invalidName`. This is defence in depth: it holds even if rule 1 is ever loosened.
4. For an operation with a source (rename, copy), the source must also resolve, and it must be an
   existing item of the kind the operation expects.

## 3. Never overwrite, atomically

A check-then-write is **not** enough on its own, because something can appear between the two steps.
The adapter must use an OS primitive that fails when the target exists:

| Operation | Primitive in `windows_fs.py` | Never use |
|-----------|------------------------------|-----------|
| Create file | `os.open(path, O_WRONLY \| O_CREAT \| O_EXCL \| O_BINARY \| O_NOINHERIT)` | `open(path, "w")`, `Path.touch()` |
| Create folder | `os.mkdir(path)` | `os.makedirs`, `exist_ok=True` |
| Rename | `os.rename(src, dst)` (MoveFileEx without REPLACE_EXISTING fails when `dst` exists) | `os.replace`, `shutil.move` |
| Copy | Open the destination with `O_CREAT \| O_EXCL`, then copy the bytes in chunks | `shutil.copy*` to the target path (they overwrite) |

- An existing item **in any casing**, and of **any kind** (file or folder), means `fileExists`.
- On Windows, `CREATE_NEW` over an existing folder or a read-only file fails as *access denied*. The
  adapter turns that into `FileExistsError` when `os.path.lexists(path)` (see `create_file`).
- A case-only rename (`notes.txt` → `Notes.txt`) is the one case where the target "exists" and
  that's fine: it's the same file. Decide it explicitly and test it.

## 4. Never create missing parents

A missing folder gives `folderNotFound`, and nothing is created anywhere. Create Folder creates exactly
one folder, the final segment, inside an existing folder.

## 5. Permissions

- Set no mode bits and no ACLs. New items inherit whatever their folder gives them.
- A folder that refuses the write gives `accessDenied`.
- Map Windows errors through `core.errors.folder_error_code` and an operation-specific mapper like
  `create_error_code` (winerror 80/183 → `fileExists`, 123/206 → `invalidName`, 5/65 → `accessDenied`).
  The winerror decides, because Python's exception classes mislead on Windows.

## 6. Errors never crash anything

| Code | When | UI sentence key |
|------|------|-----------------|
| `invalidName` | Rule 1 or 2 failed | `<prefix>.invalidName` |
| `fileExists` | The target exists, in any casing, as any kind of item | `<prefix>.fileExists` |
| `folderNotFound` | The folder (or source) doesn't exist | `<prefix>.folderNotFound` |
| `accessDenied` | Permissions refused it | `<prefix>.accessDenied` |
| `folderUnavailable` | Drive not ready, share unreachable, anything else | `<prefix>.folderUnavailable` |
| (anything else, engine restart) | | `<prefix>.failed` |

- Each new code goes in `protocol/codes.json`, gets an `error-<code>.json` example, and gets a
  catalog sentence.
- The handler catches `<Op>Refused` and replies `error(id, code)`. The core must catch **every**
  `OSError` from the port and turn it into a code. The transport turns any other exception into
  `invalidRequest` (the UI shows `<prefix>.failed`), but it logs the traceback, and an `OSError`
  traceback contains the path, which would break rule 9.
- In the UI, errors appear inline (`role="alert"`), the form stays open with the name selected, and
  nothing is thrown.

## 7. Cancellation and long operations

- Call `token.raise_if_cancelled()` before validating and again right before the write.
- Long operations (copying a large file) check the token between chunks. On cancel or failure, delete
  **only the partial file this operation created**, and nothing else.

## 8. Its own channel

Register the request on its own channel (`register_channel("<request>", "<request>", ...)`). A write
must never cancel a listing or a search, they must never cancel it, and a slow share must not block
the reader thread's pings.

## 9. Privacy and scope

- Never log file names, paths or content. Log the code and the winerror only.
- No network and no external services.
- Never delete or modify a user's existing item, except the one item the operation is about
  (rename moves its source; nothing else is touched).
- Don't modify other operations. If a shared helper has to move, keep its behaviour identical and
  keep its tests passing.
- Delete is out of scope for this skill unless the user explicitly asks and approves a design
  (for example, Recycle Bin only). It's the one operation that can't be undone.

## 10. UI behaviour

- The control is disabled while no folder is listed, while one is loading, and while the search view
  is open.
- Focus goes to the name field when the form opens. Esc closes the form, stops propagation (so it
  doesn't also leave the search view), and refocuses the trigger.
- On success: close the form, refocus the trigger, and refresh (see the refresh rule in
  [architecture.md](architecture.md)).
- The form belongs to the folder that was listed when it opened. Navigating to another folder closes it.
