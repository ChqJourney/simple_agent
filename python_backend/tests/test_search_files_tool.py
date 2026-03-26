import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.search_files import SearchFilesTool


class SearchFilesToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_plain_search_returns_matches_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.md").write_text("hello\nGB/T 19001\nbye\n", encoding="utf-8")
            (root / "b.txt").write_text("GB/T 19001 again\n", encoding="utf-8")

            result = await SearchFilesTool().execute(
                tool_call_id="search-1",
                workspace_path=temp_dir,
                query="GB/T 19001",
            )

            self.assertTrue(result.success)
            self.assertEqual("search_results", result.output["event"])
            self.assertEqual(2, result.output["summary"]["hit_count"])
            self.assertEqual(2, result.output["summary"]["file_count"])

    async def test_regex_and_case_sensitivity_are_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.md").write_text("Clause 4.1\nclause 4.2\n", encoding="utf-8")

            insensitive = await SearchFilesTool().execute(
                tool_call_id="search-2",
                workspace_path=temp_dir,
                query=r"clause 4\.\d",
                mode="regex",
            )
            sensitive = await SearchFilesTool().execute(
                tool_call_id="search-3",
                workspace_path=temp_dir,
                query=r"clause 4\.\d",
                mode="regex",
                case_sensitive=True,
            )

            self.assertEqual(2, insensitive.output["summary"]["hit_count"])
            self.assertEqual(1, sensitive.output["summary"]["hit_count"])

    async def test_glob_and_result_limit_are_applied(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.md").write_text("needle\nneedle\n", encoding="utf-8")
            (root / "b.txt").write_text("needle\n", encoding="utf-8")

            result = await SearchFilesTool().execute(
                tool_call_id="search-4",
                workspace_path=temp_dir,
                query="needle",
                file_glob="*.md",
                max_results=1,
            )

            self.assertTrue(result.output["truncated"])
            self.assertEqual(1, len(result.output["results"]))
            self.assertEqual("a.md", result.output["results"][0]["path"])

    async def test_invalid_regex_returns_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = await SearchFilesTool().execute(
                tool_call_id="search-5",
                workspace_path=temp_dir,
                query="(",
                mode="regex",
            )

            self.assertFalse(result.success)
            self.assertIn("Invalid regular expression", result.error or "")


if __name__ == "__main__":
    unittest.main()
