import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.search_documents import SearchDocumentsTool


class SearchDocumentsToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_plain_search_returns_matches_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.md").write_text("hello\nGB/T 19001\nbye\n", encoding="utf-8")
            (root / "b.txt").write_text("GB/T 19001 again\n", encoding="utf-8")

            result = await SearchDocumentsTool().execute(
                tool_call_id="search-1",
                workspace_path=temp_dir,
                query="GB/T 19001",
            )

            self.assertTrue(result.success)
            self.assertEqual("document_search_results", result.output["event"])
            self.assertEqual(2, result.output["summary"]["hit_count"])
            self.assertEqual(2, result.output["summary"]["file_count"])
            self.assertEqual("text", result.output["results"][0]["document_type"])
            self.assertEqual(str(root.resolve()), result.output["resolved_root_path"])
            self.assertEqual(str((root / "a.md").resolve()), result.output["results"][0]["absolute_path"])
            self.assertEqual(str(root.resolve()), result.output["results"][0]["resolved_root_path"])

    async def test_regex_and_case_sensitivity_are_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.md").write_text("Clause 4.1\nclause 4.2\n", encoding="utf-8")

            insensitive = await SearchDocumentsTool().execute(
                tool_call_id="search-2",
                workspace_path=temp_dir,
                query=r"clause 4\.\d",
                mode="regex",
            )
            sensitive = await SearchDocumentsTool().execute(
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

            result = await SearchDocumentsTool().execute(
                tool_call_id="search-4",
                workspace_path=temp_dir,
                query="needle",
                file_glob="*.md",
                max_results=1,
            )

            self.assertTrue(result.output["truncated"])
            self.assertEqual(1, len(result.output["results"]))
            self.assertEqual("a.md", result.output["results"][0]["path"])

    async def test_hidden_directories_are_skipped_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "visible.md").write_text("IEC 60335\n", encoding="utf-8")
            hidden_dir = root / ".agent"
            hidden_dir.mkdir()
            (hidden_dir / "session.md").write_text("IEC 60335 hidden\n", encoding="utf-8")

            result = await SearchDocumentsTool().execute(
                tool_call_id="search-hidden-default",
                workspace_path=temp_dir,
                query="IEC 60335",
            )

            self.assertTrue(result.success)
            self.assertEqual(1, result.output["summary"]["hit_count"])
            self.assertEqual("visible.md", result.output["results"][0]["path"])

    async def test_hidden_directories_can_be_included_explicitly(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            hidden_dir = root / ".agent"
            hidden_dir.mkdir()
            (hidden_dir / "session.md").write_text("IEC 60335 hidden\n", encoding="utf-8")

            result = await SearchDocumentsTool().execute(
                tool_call_id="search-hidden-include",
                workspace_path=temp_dir,
                query="IEC 60335",
                include_hidden=True,
            )

            self.assertTrue(result.success)
            self.assertEqual(1, result.output["summary"]["hit_count"])
            self.assertEqual(".agent/session.md", result.output["results"][0]["path"])

    async def test_search_runs_in_background_thread(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.md").write_text("IEC 60335\n", encoding="utf-8")
            main_thread_id = threading.get_ident()
            observed_thread_ids: list[int] = []

            def fake_search_text_file(
                self,
                candidate,
                *,
                path_str,
                pattern,
                max_results,
                context_lines,
                results,
            ):
                observed_thread_ids.append(threading.get_ident())
                results.append(
                    {
                        "path": path_str,
                        "document_type": "text",
                        "locator": {"line": 1, "column": 1},
                        "line": 1,
                        "column": 1,
                        "match_text": "IEC 60335",
                        "context_before": "",
                        "context_after": "",
                    }
                )
                return 0, False

            with patch.object(SearchDocumentsTool, "_search_text_file", new=fake_search_text_file):
                result = await SearchDocumentsTool().execute(
                    tool_call_id="search-thread",
                    workspace_path=temp_dir,
                    query="IEC 60335",
                )

            self.assertTrue(result.success)
            self.assertEqual(1, len(observed_thread_ids))
            self.assertNotEqual(main_thread_id, observed_thread_ids[0])

    async def test_searches_pdf_lines_with_structured_locators(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "manual.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            fake_page = {
                "lines": [
                    {"line_number": 1, "text": "Header"},
                    {"line_number": 2, "text": "Clause 4.2 applies here"},
                    {"line_number": 3, "text": "Footer"},
                ]
            }

            reader = patch("tools.search_documents.PdfReader").start()
            self.addCleanup(patch.stopall)
            reader_instance = reader.return_value.__enter__.return_value
            reader_instance.page_count = 1
            reader_instance._get_page_content.return_value = fake_page

            result = await SearchDocumentsTool().execute(
                tool_call_id="search-5",
                workspace_path=temp_dir,
                query="Clause 4.2",
                path="manual.pdf",
            )

            self.assertTrue(result.success)
            self.assertEqual("pdf", result.output["results"][0]["document_type"])
            self.assertEqual(1, result.output["results"][0]["locator"]["page_number"])
            self.assertEqual(2, result.output["results"][0]["locator"]["line_number"])

    async def test_searches_word_paragraphs_with_structured_locators(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = root / "manual.docx"
            docx_path.write_bytes(b"fake-docx")

            with patch(
                "tools.search_documents.search_word_document",
                return_value={
                    "items": [
                        {
                            "paragraph_index": 8,
                            "style_name": "Heading 2",
                            "match_text": "Clause 4.2",
                            "text": "Clause 4.2 applies here",
                            "context_before": "4 Management requirements",
                            "context_after": "Supporting note",
                        }
                    ]
                },
            ):
                result = await SearchDocumentsTool().execute(
                    tool_call_id="search-6",
                    workspace_path=temp_dir,
                    query="Clause 4.2",
                    path="manual.docx",
                )

            self.assertTrue(result.success)
            self.assertEqual("docx", result.output["results"][0]["document_type"])
            self.assertEqual(8, result.output["results"][0]["locator"]["paragraph_index"])
            self.assertEqual("Heading 2", result.output["results"][0]["style_name"])

    async def test_searches_word_table_cells_with_structured_locators(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = root / "trf.docx"
            docx_path.write_bytes(b"fake-docx")

            with patch(
                "tools.search_documents.search_word_document",
                return_value={
                    "items": [
                        {
                            "source_type": "table_cell",
                            "table_index": 2,
                            "row_index": 14,
                            "column_index": 3,
                            "table_title": "Table 2: Clause verification",
                            "table_type": "trf_checklist",
                            "section_title": "5 Marking and instructions",
                            "column_header": "Result",
                            "row_text": "5.1 | Marking is durable | P",
                            "match_text": "P",
                            "text": "P",
                            "context_before": "5.0 | General | P",
                            "context_after": "5.2 | Rating | P",
                        }
                    ]
                },
            ):
                result = await SearchDocumentsTool().execute(
                    tool_call_id="search-7",
                    workspace_path=temp_dir,
                    query="P",
                    path="trf.docx",
                )

            self.assertTrue(result.success)
            self.assertEqual("docx", result.output["results"][0]["document_type"])
            self.assertEqual("table_cell", result.output["results"][0]["match_source"])
            self.assertEqual(2, result.output["results"][0]["locator"]["table_index"])
            self.assertEqual(14, result.output["results"][0]["locator"]["row_index"])
            self.assertEqual(3, result.output["results"][0]["locator"]["column_index"])
            self.assertEqual("Result", result.output["results"][0]["column_header"])

    async def test_searches_excel_cells_with_structured_locators(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            xlsx_path = root / "records.xlsx"
            xlsx_path.write_bytes(b"fake-xlsx")

            with patch(
                "tools.search_documents.search_excel_workbook",
                return_value={
                    "items": [
                        {
                            "source_type": "cell",
                            "sheet_name": "Checklist",
                            "row_index": 12,
                            "column_index": 4,
                            "column_letter": "D",
                            "cell_ref": "D12",
                            "column_header": "Verdict",
                            "row_text": "5.1 | Marking is durable | OK | P",
                            "match_text": "P",
                            "text": "P",
                            "context_before": "5.0 | General | OK | P",
                            "context_after": "5.2 | Rating | OK | P",
                        }
                    ]
                },
            ):
                result = await SearchDocumentsTool().execute(
                    tool_call_id="search-8",
                    workspace_path=temp_dir,
                    query="P",
                    path="records.xlsx",
                )

            self.assertTrue(result.success)
            self.assertEqual("xlsx", result.output["results"][0]["document_type"])
            self.assertEqual("Checklist", result.output["results"][0]["locator"]["sheet_name"])
            self.assertEqual(12, result.output["results"][0]["locator"]["row_index"])
            self.assertEqual(4, result.output["results"][0]["locator"]["column_index"])
            self.assertEqual("D12", result.output["results"][0]["cell_ref"])

    async def test_searches_pptx_slide_text_with_structured_locators(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pptx_path = root / "slides.pptx"
            pptx_path.write_bytes(b"fake-pptx")

            with patch(
                "tools.search_documents.search_pptx_document",
                return_value={
                    "items": [
                        {
                            "source_type": "slide_text",
                            "slide_number": 2,
                            "slide_title": "Test flow",
                            "shape_index": 3,
                            "match_text": "IEC 60335",
                            "text": "IEC 60335 checklist overview",
                            "context_before": "",
                            "context_after": "",
                        }
                    ]
                },
            ):
                result = await SearchDocumentsTool().execute(
                    tool_call_id="search-9",
                    workspace_path=temp_dir,
                    query="IEC 60335",
                    path="slides.pptx",
                )

            self.assertTrue(result.success)
            self.assertEqual("pptx", result.output["results"][0]["document_type"])
            self.assertEqual(2, result.output["results"][0]["locator"]["slide_number"])
            self.assertEqual(3, result.output["results"][0]["locator"]["shape_index"])
            self.assertEqual("Test flow", result.output["results"][0]["slide_title"])

    async def test_invalid_regex_returns_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = await SearchDocumentsTool().execute(
                tool_call_id="search-10",
                workspace_path=temp_dir,
                query="(",
                mode="regex",
            )

            self.assertFalse(result.success)
            self.assertIn("Invalid regular expression", result.error or "")

    async def test_search_supports_reference_library_roots_with_absolute_follow_up_paths(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_dir, tempfile.TemporaryDirectory() as ref_dir:
            reference_root = Path(ref_dir)
            target = reference_root / "iec-62368.md"
            target.write_text("Clause 4.1\nThe enclosure shall resist impact.\n", encoding="utf-8")

            result = await SearchDocumentsTool().execute(
                tool_call_id="search-11",
                workspace_path=workspace_dir,
                reference_library_roots=[ref_dir],
                query="impact",
                path=ref_dir,
            )

            self.assertTrue(result.success)
            self.assertEqual(str(reference_root.resolve()), result.output["resolved_root_path"])
            self.assertEqual(str(target.resolve()), result.output["results"][0]["absolute_path"])
            self.assertEqual(str(reference_root.resolve()), result.output["results"][0]["resolved_root_path"])
            self.assertEqual("iec-62368.md", result.output["results"][0]["path"])


if __name__ == "__main__":
    unittest.main()
