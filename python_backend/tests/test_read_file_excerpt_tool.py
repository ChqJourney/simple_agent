import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.read_file_excerpt import ReadFileExcerptTool


class ReadFileExcerptToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_reads_line_excerpt(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.md").write_text("a\nb\nc\nd\n", encoding="utf-8")

            result = await ReadFileExcerptTool().execute(
                tool_call_id="excerpt-1",
                workspace_path=temp_dir,
                path="doc.md",
                unit="line",
                start=2,
                end=3,
            )

            self.assertTrue(result.success)
            self.assertEqual("b\nc", result.output["content"])
            self.assertEqual(2, result.output["summary"]["line_count"])

    async def test_reads_char_excerpt(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.txt").write_text("abcdef", encoding="utf-8")

            result = await ReadFileExcerptTool().execute(
                tool_call_id="excerpt-2",
                workspace_path=temp_dir,
                path="doc.txt",
                unit="char",
                start=2,
                end=4,
            )

            self.assertTrue(result.success)
            self.assertEqual("bcd", result.output["content"])
            self.assertEqual(3, result.output["summary"]["char_count"])

    async def test_invalid_ranges_fail_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.txt").write_text("abcdef", encoding="utf-8")

            result = await ReadFileExcerptTool().execute(
                tool_call_id="excerpt-3",
                workspace_path=temp_dir,
                path="doc.txt",
                start=4,
                end=2,
            )

            self.assertFalse(result.success)
            self.assertIn("Invalid range", result.error or "")

    async def test_page_unit_is_not_yet_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.txt").write_text("abcdef", encoding="utf-8")

            result = await ReadFileExcerptTool().execute(
                tool_call_id="excerpt-4",
                workspace_path=temp_dir,
                path="doc.txt",
                unit="page",
                start=1,
                end=1,
            )

            self.assertFalse(result.success)
            self.assertIn("Page-based excerpts", result.error or "")


if __name__ == "__main__":
    unittest.main()
