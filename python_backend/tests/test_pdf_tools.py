import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.pdf_tools import (
    PdfGetInfoTool,
    PdfGetOutlineTool,
    PdfReadLinesTool,
    PdfReadPagesTool,
    PdfSearchTool,
)
from document_readers.pdf_reader import parse_page_spec


class PdfToolsTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_page_spec_accepts_all_alias(self) -> None:
        self.assertEqual([1, 2, 3, 4], parse_page_spec("all", page_count=4))
        self.assertEqual([1, 2, 3], parse_page_spec("*", page_count=3))

    def test_parse_page_spec_returns_friendly_error(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid pages spec"):
            parse_page_spec("foo", page_count=10)

    async def test_pdf_info_tool_wraps_reader_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "manual.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch("tools.pdf_tools.get_pdf_info", return_value={"page_count": 12, "has_outline": True, "outline_count": 8, "metadata": {}}):
                result = await PdfGetInfoTool().execute(
                    tool_call_id="pdf-info-1",
                    workspace_path=temp_dir,
                    path="manual.pdf",
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf_info", result.output["event"])
            self.assertEqual(12, result.output["summary"]["page_count"])
            self.assertTrue(result.output["summary"]["has_outline"])

    async def test_pdf_outline_tool_resolves_workspace_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "manual.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch(
                "tools.pdf_tools.get_pdf_outline",
                return_value={"page_count": 12, "items": [{"title": "Scope", "level": 1, "page_number": 3}]},
            ) as mocked:
                result = await PdfGetOutlineTool().execute(
                    tool_call_id="pdf-outline-1",
                    workspace_path=temp_dir,
                    path="manual.pdf",
                    max_depth=2,
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf_outline", result.output["event"])
            self.assertEqual(1, result.output["summary"]["item_count"])
            called_path = mocked.call_args.kwargs["max_depth"]
            self.assertEqual(2, called_path)

    async def test_pdf_read_pages_tool_returns_page_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "manual.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch(
                "tools.pdf_tools.read_pdf_pages",
                return_value={
                    "pdf_path": str(pdf_path),
                    "page_count": 12,
                    "pages": [2, 3],
                    "mode": "page_text",
                    "filters": {},
                    "items": [{"page_number": 2, "text": "scope", "total_lines": 10}],
                },
            ):
                result = await PdfReadPagesTool().execute(
                    tool_call_id="pdf-pages-1",
                    workspace_path=temp_dir,
                    path="manual.pdf",
                    pages="2-3",
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf_pages", result.output["event"])
            self.assertEqual([2, 3], result.output["summary"]["requested_pages"])

    async def test_pdf_read_pages_tool_allows_all_pages_keyword(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "manual.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch(
                "tools.pdf_tools.read_pdf_pages",
                return_value={
                    "pdf_path": str(pdf_path),
                    "page_count": 12,
                    "pages": list(range(1, 13)),
                    "mode": "page_text",
                    "filters": {},
                    "items": [{"page_number": 1, "text": "scope", "total_lines": 10}],
                },
            ) as mocked:
                result = await PdfReadPagesTool().execute(
                    tool_call_id="pdf-pages-all",
                    workspace_path=temp_dir,
                    path="manual.pdf",
                    pages="all",
                )

            self.assertTrue(result.success)
            self.assertEqual("all", mocked.call_args.kwargs["pages"])
            self.assertEqual(list(range(1, 13)), result.output["summary"]["requested_pages"])

    async def test_pdf_read_lines_tool_returns_line_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "manual.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch(
                "tools.pdf_tools.read_pdf_lines",
                return_value={
                    "pdf_path": str(pdf_path),
                    "page_count": 12,
                    "page_number": 5,
                    "requested_lines": [1, 2],
                    "include_context": 1,
                    "total_lines": 30,
                    "filters": {},
                    "items": [{"line_number": 1, "text": "hello", "requested": True}],
                },
            ):
                result = await PdfReadLinesTool().execute(
                    tool_call_id="pdf-lines-1",
                    workspace_path=temp_dir,
                    path="manual.pdf",
                    page_number=5,
                    line_numbers="1-2",
                    include_context=1,
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf_lines", result.output["event"])
            self.assertEqual(5, result.output["summary"]["page_number"])

    async def test_pdf_search_tool_returns_structured_hits(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "manual.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch(
                "tools.pdf_tools.search_pdf",
                return_value={
                    "pdf_path": str(pdf_path),
                    "page_count": 12,
                    "query": "scope",
                    "search_mode": "line",
                    "top_k": 5,
                    "filters": {},
                    "items": [{"page_number": 3, "line_number": 8, "text": "scope"}],
                },
            ):
                result = await PdfSearchTool().execute(
                    tool_call_id="pdf-search-1",
                    workspace_path=temp_dir,
                    path="manual.pdf",
                    query="scope",
                    search_mode="line",
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf_search", result.output["event"])
            self.assertEqual("line", result.output["summary"]["search_mode"])
            self.assertEqual(1, result.output["summary"]["result_count"])

    async def test_pdf_tools_reject_non_pdf_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            text_path = Path(temp_dir) / "notes.txt"
            text_path.write_text("hello", encoding="utf-8")

            result = await PdfSearchTool().execute(
                tool_call_id="pdf-search-2",
                workspace_path=temp_dir,
                path="notes.txt",
                query="hello",
            )

            self.assertFalse(result.success)
            self.assertIn("Unsupported file type", result.error or "")


if __name__ == "__main__":
    unittest.main()
