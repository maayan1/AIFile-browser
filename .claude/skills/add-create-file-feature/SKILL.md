
---
name: add-create-file-feature
description: >
  Add a Create File feature to a local File Browser
  built with Python and TypeScript.
  Use when implementing or updating file creation.
---

# Add Create File Feature

## Goal
Implement a safe, working Create File feature
in the local File Browser application.

## Project Context
- Python handles file operations.
- TypeScript handles the user interface.
- The application works offline.
- Do not introduce external web services.

## References
Read [feature-rules.md](feature-rules.md).

## Workflow

### Step 1: Inspect the project
1. Locate the Python file management code.
2. Locate the TypeScript file browser UI.
3. Find how TypeScript calls Python.
4. Identify the allowed root directory.
5. Identify existing tests and build commands.

### Step 2: Implement file creation
1. Reuse the existing TypeScript-to-Python bridge.
2. Add a New File button to the UI.
3. Allow the user to enter a filename.
4. Validate the filename.
5. Call the Python file creation function.
6. Refresh the file list after success.

### Step 3: Enforce safety
1. Prevent overwriting existing files.
2. Reject invalid filenames.
3. Prevent path traversal.
4. Respect existing filesystem permissions.
5. Handle errors without crashing the UI.

### Step 4: Add tests
Test:
- Valid file creation
- Duplicate filename
- Empty filename
- Path traversal
- Missing parent directory
- UI refresh after success

### Step 5: Validate
Run the project tests.

Run:
python validate-feature.py

If validation fails:
1. Identify the failure.
2. Fix the implementation.
3. Run validation again.

Repeat until all checks pass or report a blocker.

## Success Criteria
- New File button works.
- Python creates the requested file.
- Existing files are never overwritten.
- Invalid paths are rejected.
- File list refreshes after creation.
- Validation passes.

## Final Report
Report:
- Files changed
- Tests executed
- Validation results
- Remaining issues
