import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.get_document_outline import GetDocumentOutlineTool


class GetDocumentOutlineToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_extracts_markdown_and_numbered_headings(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "standard.md").write_text(
                "# Intro\ntext\n## Scope\ntext\n4 Context\ntext\n4.1 Understanding context\n",
                encoding="utf-8",
            )

            result = await GetDocumentOutlineTool().execute(
                tool_call_id="outline-1",
                workspace_path=temp_dir,
                path="standard.md",
            )

            self.assertTrue(result.success)
            titles = [node["title"] for node in result.output["nodes"]]
            self.assertIn("Intro", titles)
            self.assertIn("Scope", titles)
            self.assertIn("4 Context", titles)
            self.assertIn("4.1 Understanding context", titles)

    async def test_respects_max_nodes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.md").write_text("# A\n# B\n# C\n", encoding="utf-8")

            result = await GetDocumentOutlineTool().execute(
                tool_call_id="outline-2",
                workspace_path=temp_dir,
                path="doc.md",
                max_nodes=2,
            )

            self.assertTrue(result.success)
            self.assertTrue(result.output["truncated"])
            self.assertEqual(2, len(result.output["nodes"]))

    async def test_rejects_unsupported_file_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.pdf").write_text("fake", encoding="utf-8")

            result = await GetDocumentOutlineTool().execute(
                tool_call_id="outline-3",
                workspace_path=temp_dir,
                path="doc.pdf",
            )

            self.assertFalse(result.success)
            self.assertIn("Unsupported file type", result.error or "")


if __name__ == "__main__":
    unittest.main()
