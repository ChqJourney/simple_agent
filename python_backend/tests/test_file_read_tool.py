import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.file_read import FileReadTool


class FileReadToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_reads_file_content_from_workspace_relative_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "notes.txt").write_text("hello from file_read", encoding="utf-8")

            result = await FileReadTool().execute(
                tool_call_id="read-1",
                path="notes.txt",
                workspace_path=temp_dir,
            )

            self.assertTrue(result.success)
            self.assertEqual("hello from file_read", result.output)

    async def test_rejects_paths_outside_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, tempfile.TemporaryDirectory() as other_dir:
            outside_file = Path(other_dir) / "secret.txt"
            outside_file.write_text("should not be readable", encoding="utf-8")
            relative_escape = Path("..") / Path(other_dir).name / "secret.txt"

            result = await FileReadTool().execute(
                tool_call_id="read-2",
                path=str(relative_escape),
                workspace_path=temp_dir,
            )

            self.assertFalse(result.success)
            self.assertIn("inside workspace", result.error or "")

    async def test_rejects_directory_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = await FileReadTool().execute(
                tool_call_id="read-3",
                path=".",
                workspace_path=temp_dir,
            )

            self.assertFalse(result.success)
            self.assertIn("not a file", result.error or "")

    async def test_rejects_files_larger_than_the_configured_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "large.txt").write_text("0123456789", encoding="utf-8")

            with patch("tools.file_read.MAX_FILE_SIZE", 4):
                result = await FileReadTool().execute(
                    tool_call_id="read-4",
                    path="large.txt",
                    workspace_path=temp_dir,
                )

            self.assertFalse(result.success)
            self.assertIn("File too large", result.error or "")

    async def test_reports_decode_failures_for_invalid_encoding(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "latin1.txt").write_bytes(b"caf\xe9")

            result = await FileReadTool().execute(
                tool_call_id="read-5",
                path="latin1.txt",
                workspace_path=temp_dir,
                encoding="utf-8",
            )

            self.assertFalse(result.success)
            self.assertIn("Failed to decode file", result.error or "")


if __name__ == "__main__":
    unittest.main()
