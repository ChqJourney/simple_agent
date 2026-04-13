import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.extract_checklist_rows import ExtractChecklistRowsTool


class ExtractChecklistRowsToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_extracts_word_checklist_rows_from_trf_table(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = root / "trf.docx"
            docx_path.write_bytes(b"fake-docx")

            fake_reader = SimpleNamespace(
                tables=[
                    {
                        "table_index": 2,
                        "title": "Table 2: Clause verification",
                        "table_type": "trf_checklist",
                        "header_row_index": 1,
                        "column_headers": ["Clause", "Requirement", "Evidence", "Verdict"],
                        "rows": [
                            {
                                "row_index": 1,
                                "cells": [
                                    {"column_index": 1, "text": "Clause"},
                                    {"column_index": 2, "text": "Requirement"},
                                    {"column_index": 3, "text": "Evidence"},
                                    {"column_index": 4, "text": "Verdict"},
                                ],
                            },
                            {
                                "row_index": 10,
                                "cells": [
                                    {"column_index": 1, "text": "5.1"},
                                    {"column_index": 2, "text": "Marking is durable"},
                                    {"column_index": 3, "text": "Label fixed after rub test"},
                                    {"column_index": 4, "text": "P"},
                                ],
                            },
                        ],
                    }
                ]
            )

            with patch("tools.extract_checklist_rows.WordReader", return_value=fake_reader):
                result = await ExtractChecklistRowsTool(lambda: None).execute(
                    tool_call_id="checklist-1",
                    workspace_path=temp_dir,
                    path="trf.docx",
                )

            self.assertTrue(result.success)
            self.assertEqual("checklist_rows", result.output["event"])
            self.assertEqual("docx", result.output["document_type"])
            self.assertEqual(1, result.output["summary"]["row_count"])
            self.assertEqual("5.1", result.output["rows"][0]["clause_id"])
            self.assertEqual("Marking is durable", result.output["rows"][0]["requirement"])
            self.assertEqual("Label fixed after rub test", result.output["rows"][0]["raw_evidence"])
            self.assertEqual("P", result.output["rows"][0]["raw_judgement"])
            self.assertEqual("word_table_row", result.output["rows"][0]["locator"]["type"])

    async def test_extracts_excel_checklist_rows_from_matching_sheet(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            xlsx_path = root / "checklist.xlsx"
            xlsx_path.write_bytes(b"fake-xlsx")

            fake_reader = SimpleNamespace(
                sheets=[
                    {
                        "sheet_name": "Checklist",
                        "header_row_index": 1,
                        "column_headers": ["Clause", "Requirement", "Observation", "Result"],
                        "rows": [
                            {
                                "row_index": 1,
                                "cells": [
                                    {"column_index": 1, "text": "Clause"},
                                    {"column_index": 2, "text": "Requirement"},
                                    {"column_index": 3, "text": "Observation"},
                                    {"column_index": 4, "text": "Result"},
                                ],
                            },
                            {
                                "row_index": 12,
                                "cells": [
                                    {"column_index": 1, "text": "7.2"},
                                    {"column_index": 2, "text": "Warning label present"},
                                    {"column_index": 3, "text": "Observed on rear panel"},
                                    {"column_index": 4, "text": "Pass"},
                                ],
                            },
                        ],
                    }
                ]
            )

            with patch("tools.extract_checklist_rows.ExcelReader", return_value=fake_reader):
                result = await ExtractChecklistRowsTool(lambda: None).execute(
                    tool_call_id="checklist-2",
                    workspace_path=temp_dir,
                    path="checklist.xlsx",
                    sheet_name="Checklist",
                )

            self.assertTrue(result.success)
            self.assertEqual("xlsx", result.output["document_type"])
            self.assertEqual("7.2", result.output["rows"][0]["clause_id"])
            self.assertEqual("Warning label present", result.output["rows"][0]["requirement"])
            self.assertEqual("Observed on rear panel", result.output["rows"][0]["raw_evidence"])
            self.assertEqual("Pass", result.output["rows"][0]["raw_judgement"])
            self.assertEqual("Checklist", result.output["rows"][0]["sheet_name"])

    async def test_extracts_reference_library_checklist_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            checklist_root = root / "checklists"
            checklist_root.mkdir()
            csv_path = checklist_root / "ul-checklist.csv"
            csv_path.write_text(
                "Clause,Requirement,Evidence,Result\n8.1,Guard present,Visual inspection,Pass\n",
                encoding="utf-8",
            )

            config = {
                "reference_library": {
                    "roots": [
                        {
                            "id": "checklist-root",
                            "label": "UL Checklists",
                            "path": str(checklist_root),
                            "enabled": True,
                            "kinds": ["checklist"],
                        }
                    ]
                }
            }

            result = await ExtractChecklistRowsTool(lambda: config).execute(
                tool_call_id="checklist-3",
                path="ul-checklist.csv",
                reference_root_id="checklist-root",
            )

            self.assertTrue(result.success)
            self.assertEqual("reference_library", result.output["source"])
            self.assertEqual("checklist-root", result.output["reference_root_id"])
            self.assertEqual("UL Checklists", result.output["reference_root_label"])
            self.assertEqual("8.1", result.output["rows"][0]["clause_id"])
            self.assertEqual("Guard present", result.output["rows"][0]["requirement"])


if __name__ == "__main__":
    unittest.main()
