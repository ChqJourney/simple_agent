import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from unittest.mock import patch

from tools.get_document_structure import GetDocumentStructureTool


class GetDocumentStructureToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_extracts_markdown_and_numbered_headings(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "standard.md").write_text(
                "# Intro\ntext\n## Scope\ntext\n4 Context\ntext\n4.1 Understanding context\n",
                encoding="utf-8",
            )

            result = await GetDocumentStructureTool().execute(
                tool_call_id="outline-1",
                workspace_path=temp_dir,
                path="standard.md",
            )

            self.assertTrue(result.success)
            self.assertEqual("document_structure", result.output["event"])
            self.assertEqual("text", result.output["document_type"])
            titles = [node["title"] for node in result.output["nodes"]]
            self.assertIn("Intro", titles)
            self.assertIn("Scope", titles)
            self.assertIn("4 Context", titles)
            self.assertIn("4.1 Understanding context", titles)

    async def test_respects_max_nodes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.md").write_text("# A\n# B\n# C\n", encoding="utf-8")

            result = await GetDocumentStructureTool().execute(
                tool_call_id="outline-2",
                workspace_path=temp_dir,
                path="doc.md",
                max_nodes=2,
            )

            self.assertTrue(result.success)
            self.assertTrue(result.output["truncated"])
            self.assertEqual(2, len(result.output["nodes"]))

    async def test_uses_pdf_outline_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.pdf").write_bytes(b"%PDF-1.7")

            with patch(
                "tools.get_document_structure.get_pdf_outline",
                return_value={
                    "page_count": 20,
                    "items": [
                        {"title": "4 Management requirements", "level": 1, "page_number": 7},
                        {"title": "4.1 Organization", "level": 2, "page_number": 8},
                    ],
                },
            ):
                result = await GetDocumentStructureTool().execute(
                    tool_call_id="outline-3",
                    workspace_path=temp_dir,
                    path="doc.pdf",
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf", result.output["document_type"])
            self.assertEqual("pdf_outline", result.output["structure_type"])
            self.assertEqual(7, result.output["nodes"][0]["locator"]["page_number"])

    async def test_extracts_word_structure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "manual.docx").write_bytes(b"fake-docx")

            with patch(
                "tools.get_document_structure.get_word_structure",
                return_value={
                    "structure_type": "word_heading_map",
                    "items": [
                        {
                            "title": "4 Management requirements",
                            "level": 1,
                            "anchor": "4-management-requirements",
                            "locator": {"paragraph_start": 3, "paragraph_end": 12},
                        }
                    ],
                },
            ):
                result = await GetDocumentStructureTool().execute(
                    tool_call_id="outline-4",
                    workspace_path=temp_dir,
                    path="manual.docx",
                )

            self.assertTrue(result.success)
            self.assertEqual("docx", result.output["document_type"])
            self.assertEqual("word_heading_map", result.output["structure_type"])
            self.assertEqual(3, result.output["nodes"][0]["locator"]["paragraph_start"])

    async def test_extracts_word_table_structure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "trf.docx").write_bytes(b"fake-docx")

            with patch(
                "tools.get_document_structure.get_word_structure",
                return_value={
                    "structure_type": "word_table_map",
                    "items": [
                        {
                            "title": "Table 1: Clause verification",
                            "level": 1,
                            "anchor": "table-1",
                            "locator": {"table_index": 1, "row_start": 1, "row_end": 24},
                            "table_type": "trf_checklist",
                        }
                    ],
                },
            ):
                result = await GetDocumentStructureTool().execute(
                    tool_call_id="outline-5",
                    workspace_path=temp_dir,
                    path="trf.docx",
                )

            self.assertTrue(result.success)
            self.assertEqual("docx", result.output["document_type"])
            self.assertEqual("word_table_map", result.output["structure_type"])
            self.assertEqual(1, result.output["nodes"][0]["locator"]["table_index"])

    async def test_extracts_excel_workbook_structure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "checklist.xlsx").write_bytes(b"fake-xlsx")

            with patch(
                "tools.get_document_structure.get_excel_structure",
                return_value={
                    "structure_type": "excel_workbook_map",
                    "sheet_count": 2,
                    "items": [
                        {
                            "title": "Sheet1",
                            "level": 1,
                            "anchor": "sheet1",
                            "locator": {
                                "sheet_name": "Sheet1",
                                "row_start": 1,
                                "row_end": 120,
                                "column_start": 1,
                                "column_end": 6,
                            },
                        }
                    ],
                },
            ):
                result = await GetDocumentStructureTool().execute(
                    tool_call_id="outline-6",
                    workspace_path=temp_dir,
                    path="checklist.xlsx",
                )

            self.assertTrue(result.success)
            self.assertEqual("xlsx", result.output["document_type"])
            self.assertEqual("excel_workbook_map", result.output["structure_type"])
            self.assertEqual(2, result.output["summary"]["sheet_count"])
            self.assertEqual("Sheet1", result.output["nodes"][0]["locator"]["sheet_name"])

    async def test_extracts_pptx_slide_structure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "deck.pptx").write_bytes(b"fake-pptx")

            with patch(
                "tools.get_document_structure.get_pptx_structure",
                return_value={
                    "structure_type": "pptx_slide_map",
                    "slide_count": 3,
                    "items": [
                        {
                            "title": "Overview",
                            "level": 1,
                            "anchor": "slide-1-overview",
                            "locator": {"slide_number": 1},
                        }
                    ],
                },
            ):
                result = await GetDocumentStructureTool().execute(
                    tool_call_id="outline-7",
                    workspace_path=temp_dir,
                    path="deck.pptx",
                )

            self.assertTrue(result.success)
            self.assertEqual("pptx", result.output["document_type"])
            self.assertEqual("pptx_slide_map", result.output["structure_type"])
            self.assertEqual(3, result.output["summary"]["slide_count"])
            self.assertEqual(1, result.output["nodes"][0]["locator"]["slide_number"])

    async def test_rejects_unsupported_file_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.bin").write_text("fake", encoding="utf-8")

            result = await GetDocumentStructureTool().execute(
                tool_call_id="outline-8",
                workspace_path=temp_dir,
                path="doc.bin",
            )

            self.assertFalse(result.success)
            self.assertIn("Unsupported file type", result.error or "")


if __name__ == "__main__":
    unittest.main()
