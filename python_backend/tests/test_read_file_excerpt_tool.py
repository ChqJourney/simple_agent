import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.read_document_segment import ReadDocumentSegmentTool


class ReadDocumentSegmentToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_reads_line_excerpt(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.md").write_text("a\nb\nc\nd\n", encoding="utf-8")

            result = await ReadDocumentSegmentTool().execute(
                tool_call_id="excerpt-1",
                workspace_path=temp_dir,
                path="doc.md",
                locator={
                    "type": "text_line_range",
                    "line_start": 2,
                    "line_end": 3,
                },
            )

            self.assertTrue(result.success)
            self.assertEqual("document_segment", result.output["event"])
            self.assertEqual("b\nc", result.output["content"])
            self.assertEqual(2, result.output["summary"]["line_count"])

    async def test_reads_char_excerpt(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.txt").write_text("abcdef", encoding="utf-8")

            result = await ReadDocumentSegmentTool().execute(
                tool_call_id="excerpt-2",
                workspace_path=temp_dir,
                path="doc.txt",
                locator={
                    "type": "text_char_range",
                    "char_start": 2,
                    "char_end": 4,
                },
            )

            self.assertTrue(result.success)
            self.assertEqual("bcd", result.output["content"])
            self.assertEqual(3, result.output["summary"]["char_count"])

    async def test_invalid_ranges_fail_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "doc.txt").write_text("abcdef", encoding="utf-8")

            result = await ReadDocumentSegmentTool().execute(
                tool_call_id="excerpt-3",
                workspace_path=temp_dir,
                path="doc.txt",
                locator={
                    "type": "text_line_range",
                    "line_start": 4,
                    "line_end": 2,
                },
            )

            self.assertFalse(result.success)
            self.assertIn("Invalid range", result.error or "")

    async def test_reads_pdf_page_segment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "doc.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch(
                "tools.read_document_segment.read_pdf_pages",
                return_value={
                    "items": [
                        {"page_number": 2, "text": "Clause 4.1", "total_lines": 4},
                        {"page_number": 3, "text": "Clause 4.2", "total_lines": 5},
                    ]
                },
            ):
                result = await ReadDocumentSegmentTool().execute(
                    tool_call_id="excerpt-4",
                    workspace_path=temp_dir,
                    path="doc.pdf",
                    locator={
                        "type": "pdf_page_range",
                        "page_start": 2,
                        "page_end": 3,
                    },
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf", result.output["document_type"])
            self.assertEqual("pdf_page_range", result.output["segment_type"])
            self.assertIn("[Page 2]", result.output["content"])
            self.assertEqual(2, result.output["summary"]["page_count"])

    async def test_reads_pdf_line_segment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "doc.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            with patch(
                "tools.read_document_segment.read_pdf_lines",
                return_value={
                    "items": [
                        {"line_number": 9, "text": "context", "requested": False},
                        {"line_number": 10, "text": "target line", "requested": True},
                    ]
                },
            ):
                result = await ReadDocumentSegmentTool().execute(
                    tool_call_id="excerpt-5",
                    workspace_path=temp_dir,
                    path="doc.pdf",
                    locator={
                        "type": "pdf_line_range",
                        "page_number": 6,
                        "line_start": 10,
                        "line_end": 10,
                    },
                    include_context=1,
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf_line_range", result.output["segment_type"])
            self.assertIn("[Context L9]", result.output["content"])
            self.assertIn("[L10] target line", result.output["content"])

    async def test_reads_word_paragraph_segment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = root / "doc.docx"
            docx_path.write_bytes(b"fake-docx")

            with patch(
                "tools.read_document_segment.read_word_paragraphs",
                return_value={
                    "items": [
                        {"paragraph_index": 4, "text": "context", "requested": False},
                        {"paragraph_index": 5, "text": "target paragraph", "requested": True},
                    ]
                },
            ):
                result = await ReadDocumentSegmentTool().execute(
                    tool_call_id="excerpt-6",
                    workspace_path=temp_dir,
                    path="doc.docx",
                    locator={
                        "type": "word_paragraph_range",
                        "paragraph_start": 5,
                        "paragraph_end": 5,
                    },
                    include_context=1,
                )

            self.assertTrue(result.success)
            self.assertEqual("docx", result.output["document_type"])
            self.assertEqual("word_paragraph_range", result.output["segment_type"])
            self.assertIn("[Context P4]", result.output["content"])
            self.assertIn("[P5] target paragraph", result.output["content"])

    async def test_reads_word_table_segment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = root / "trf.docx"
            docx_path.write_bytes(b"fake-docx")

            with patch(
                "tools.read_document_segment.read_word_table_rows",
                return_value={
                    "table_index": 2,
                    "title": "Table 2: Clause verification",
                    "table_type": "trf_checklist",
                    "row_start": 10,
                    "row_end": 11,
                    "column_start": 1,
                    "column_end": 3,
                    "header_row_index": 1,
                    "column_headers": ["Clause", "Requirement", "Result"],
                    "items": [
                        {
                            "row_index": 1,
                            "requested": False,
                            "is_header": True,
                            "cells": [
                                {"column_index": 1, "text": "Clause"},
                                {"column_index": 2, "text": "Requirement"},
                                {"column_index": 3, "text": "Result"},
                            ],
                            "text": "Clause | Requirement | Result",
                        },
                        {
                            "row_index": 10,
                            "requested": True,
                            "is_header": False,
                            "cells": [
                                {"column_index": 1, "text": "5.1"},
                                {"column_index": 2, "text": "Marking is durable"},
                                {"column_index": 3, "text": "P"},
                            ],
                            "text": "5.1 | Marking is durable | P",
                        },
                    ],
                },
            ):
                result = await ReadDocumentSegmentTool().execute(
                    tool_call_id="excerpt-7",
                    workspace_path=temp_dir,
                    path="trf.docx",
                    locator={
                        "type": "word_table_range",
                        "table_index": 2,
                        "row_start": 10,
                        "row_end": 11,
                        "column_start": 1,
                        "column_end": 3,
                    },
                    include_context=1,
                )

            self.assertTrue(result.success)
            self.assertEqual("docx", result.output["document_type"])
            self.assertEqual("word_table_range", result.output["segment_type"])
            self.assertIn("[Table 2] Table 2: Clause verification", result.output["content"])
            self.assertIn("[Header R1] Clause | Requirement | Result", result.output["content"])
            self.assertIn("[R10] Clause=5.1 | Requirement=Marking is durable | Result=P", result.output["content"])

    async def test_reads_excel_range_segment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            xlsx_path = root / "records.xlsx"
            xlsx_path.write_bytes(b"fake-xlsx")

            with patch(
                "tools.read_document_segment.read_excel_range",
                return_value={
                    "sheet_name": "Checklist",
                    "row_start": 10,
                    "row_end": 11,
                    "column_start": 1,
                    "column_end": 4,
                    "header_row_index": 1,
                    "column_headers": ["Clause", "Requirement", "Observation", "Verdict"],
                    "items": [
                        {
                            "row_index": 1,
                            "requested": False,
                            "is_header": True,
                            "cells": [
                                {"column_index": 1, "column_letter": "A", "text": "Clause"},
                                {"column_index": 2, "column_letter": "B", "text": "Requirement"},
                                {"column_index": 3, "column_letter": "C", "text": "Observation"},
                                {"column_index": 4, "column_letter": "D", "text": "Verdict"},
                            ],
                            "text": "Clause | Requirement | Observation | Verdict",
                        },
                        {
                            "row_index": 10,
                            "requested": True,
                            "is_header": False,
                            "cells": [
                                {"column_index": 1, "column_letter": "A", "text": "5.1"},
                                {"column_index": 2, "column_letter": "B", "text": "Marking is durable"},
                                {"column_index": 3, "column_letter": "C", "text": "OK"},
                                {"column_index": 4, "column_letter": "D", "text": "P"},
                            ],
                            "text": "5.1 | Marking is durable | OK | P",
                        },
                    ],
                },
            ):
                result = await ReadDocumentSegmentTool().execute(
                    tool_call_id="excerpt-8",
                    workspace_path=temp_dir,
                    path="records.xlsx",
                    locator={
                        "type": "excel_range",
                        "sheet_name": "Checklist",
                        "row_start": 10,
                        "row_end": 11,
                        "column_start": 1,
                        "column_end": 4,
                    },
                    include_context=1,
                )

            self.assertTrue(result.success)
            self.assertEqual("xlsx", result.output["document_type"])
            self.assertEqual("excel_range", result.output["segment_type"])
            self.assertIn("[Sheet Checklist]", result.output["content"])
            self.assertIn("[Header R1] Clause | Requirement | Observation | Verdict", result.output["content"])
            self.assertIn("[R10] Clause=5.1 | Requirement=Marking is durable | Observation=OK | Verdict=P", result.output["content"])

    async def test_reads_pptx_slide_segment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pptx_path = root / "slides.pptx"
            pptx_path.write_bytes(b"fake-pptx")

            with patch(
                "tools.read_document_segment.read_pptx_slides",
                return_value={
                    "items": [
                        {
                            "slide_number": 2,
                            "title": "Test flow",
                            "text": "IEC 60335 checklist overview",
                            "notes_text": "Presenter note",
                            "text_blocks": [{"shape_index": 1, "text": "IEC 60335 checklist overview"}],
                        }
                    ]
                },
            ):
                result = await ReadDocumentSegmentTool().execute(
                    tool_call_id="excerpt-9",
                    workspace_path=temp_dir,
                    path="slides.pptx",
                    locator={
                        "type": "pptx_slide_range",
                        "slide_start": 2,
                        "slide_end": 2,
                    },
                )

            self.assertTrue(result.success)
            self.assertEqual("pptx", result.output["document_type"])
            self.assertEqual("pptx_slide_range", result.output["segment_type"])
            self.assertIn("[Slide 2] Test flow", result.output["content"])
            self.assertIn("[Notes]", result.output["content"])


if __name__ == "__main__":
    unittest.main()
