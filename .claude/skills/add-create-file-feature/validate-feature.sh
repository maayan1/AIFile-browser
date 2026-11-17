
from pathlib import Path
from tempfile import TemporaryDirectory

# Replace with the actual project import.
from file_manager import create_file


def test_create_file():
    with TemporaryDirectory() as temp:
        root = Path(temp)
        folder = root / "documents"
        folder.mkdir()

        # Successful creation
        create_file(root, "documents", "notes.txt")
        assert (folder / "notes.txt").is_file()

        # Duplicate file must be rejected
        try:
            create_file(root, "documents", "notes.txt")
        except FileExistsError:
            pass
        else:
            raise AssertionError("Duplicate file accepted")

        # Path traversal must be rejected
        try:
            create_file(root, "documents", "../bad.txt")
        except (ValueError, PermissionError):
            pass
        else:
            raise AssertionError("Path traversal accepted")

    print("All file creation tests passed")


if __name__ == "__main__":
    test_create_file()
