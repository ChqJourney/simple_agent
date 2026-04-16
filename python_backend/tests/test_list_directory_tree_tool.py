import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.list_directory_tree import ListDirectoryTreeTool


class ListDirectoryTreeToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_lists_workspace_entries_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "docs").mkdir()
            (root / "docs" / "report.md").write_text("# Report\n", encoding="utf-8")
            (root / "notes.txt").write_text("hello", encoding="utf-8")

            result = await ListDirectoryTreeTool().execute(
                tool_call_id="tree-1",
                workspace_path=temp_dir,
            )

            self.assertTrue(result.success)
            self.assertEqual("directory_tree", result.output["event"])
            self.assertEqual(2, result.output["summary"]["file_count"])
            self.assertEqual(1, result.output["summary"]["directory_count"])
            self.assertIn([".md", 1], result.output["summary"]["top_extensions"])

    async def test_respects_hidden_and_glob_filters(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".secret.md").write_text("hidden", encoding="utf-8")
            (root / "visible.md").write_text("visible", encoding="utf-8")
            (root / "visible.txt").write_text("visible", encoding="utf-8")

            result = await ListDirectoryTreeTool().execute(
                tool_call_id="tree-2",
                workspace_path=temp_dir,
                file_glob="*.md",
            )

            paths = [entry["path"] for entry in result.output["entries"]]
            self.assertEqual(["visible.md"], paths)

    async def test_truncates_entries_when_limit_is_hit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for index in range(3):
                (root / f"file-{index}.txt").write_text("x", encoding="utf-8")

            result = await ListDirectoryTreeTool().execute(
                tool_call_id="tree-3",
                workspace_path=temp_dir,
                max_entries=2,
            )

            self.assertTrue(result.success)
            self.assertTrue(result.output["truncated"])
            self.assertEqual(2, len(result.output["entries"]))

    async def test_blocks_paths_outside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = await ListDirectoryTreeTool().execute(
                tool_call_id="tree-4",
                workspace_path=temp_dir,
                path="/tmp",
            )

            self.assertFalse(result.success)
            self.assertIn("Path must be inside workspace", result.error or "")

    async def test_does_not_traverse_symlinked_directory_outside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, tempfile.TemporaryDirectory() as outside_dir:
            root = Path(temp_dir)
            outside = Path(outside_dir)
            (outside / "secret.txt").write_text("secret", encoding="utf-8")
            try:
                (root / "outside-link").symlink_to(outside, target_is_directory=True)
            except OSError as exc:
                self.skipTest(f"symlinks unavailable: {exc}")

            result = await ListDirectoryTreeTool().execute(
                tool_call_id="tree-5",
                workspace_path=temp_dir,
                max_depth=2,
                include_hidden=True,
            )

            self.assertTrue(result.success)
            paths = [entry["path"] for entry in result.output["entries"]]
            self.assertNotIn("outside-link", paths)
            self.assertNotIn("outside-link/secret.txt", paths)


if __name__ == "__main__":
    unittest.main()
