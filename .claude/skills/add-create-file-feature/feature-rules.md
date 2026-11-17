
# File Browser Rules

## Architecture
- Reuse existing Python file operations.
- Reuse the existing TypeScript UI components.
- Use the existing communication mechanism.
- Do not add external network dependencies.

## File Creation
- Create files only inside the allowed root.
- Never overwrite an existing file.
- Reject empty filenames.
- Reject "." and ".." as filenames.
- Reject path separators in filenames.
- Do not create missing parent directories.
- Preserve filesystem permissions.

## UI
- Show a New File button.
- Request a filename from the user.
- Show clear errors.
- Refresh the file list after success.

## Scope
- Do not modify unrelated functionality.
- Do not delete existing files.
- Follow existing project conventions.
