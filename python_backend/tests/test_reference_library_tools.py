import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.reference_library import ReadReferenceSegmentTool, SearchReferenceLibraryTool


class ReferenceLibraryToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_reference_library_returns_root_metadata_and_skips_disabled_roots(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            standards_root = root / "standards"
            disabled_root = root / "disabled"
            standards_root.mkdir()
            disabled_root.mkdir()
            (standards_root / "iec-62368.md").write_text(
                "Clause 4.1\nThe enclosure shall resist impact.\n",
                encoding="utf-8",
            )
            (disabled_root / "hidden.md").write_text(
                "Clause 4.1\nThis text should not be searched.\n",
                encoding="utf-8",
            )

            config = {
                "reference_library": {
                    "roots": [
                        {
                            "id": "std-root",
                            "label": "Standards",
                            "path": str(standards_root),
                            "enabled": True,
                            "kinds": ["standard"],
                        },
                        {
                            "id": "disabled-root",
                            "label": "Disabled",
                            "path": str(disabled_root),
                            "enabled": False,
                            "kinds": ["standard"],
                        },
                    ]
                }
            }

            result = await SearchReferenceLibraryTool(lambda: config).execute(
                tool_call_id="search-1",
                query="impact",
                kind="standard",
            )

            self.assertTrue(result.success)
            self.assertEqual("reference_library_search_results", result.output["event"])
            self.assertEqual(1, result.output["summary"]["hit_count"])
            self.assertEqual("reference_library", result.output["results"][0]["source"])
            self.assertEqual("std-root", result.output["results"][0]["root_id"])
            self.assertEqual("Standards", result.output["results"][0]["root_label"])
            self.assertEqual("iec-62368.md", result.output["results"][0]["path"])

    async def test_read_reference_segment_reads_text_within_selected_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            standards_root = root / "standards"
            standards_root.mkdir()
            (standards_root / "ul-60335.txt").write_text(
                "line 1\nline 2\nline 3\n",
                encoding="utf-8",
            )

            config = {
                "reference_library": {
                    "roots": [
                        {
                            "id": "std-root",
                            "label": "UL",
                            "path": str(standards_root),
                            "enabled": True,
                            "kinds": ["standard"],
                        }
                    ]
                }
            }

            result = await ReadReferenceSegmentTool(lambda: config).execute(
                tool_call_id="read-1",
                root_id="std-root",
                path="ul-60335.txt",
                locator={
                    "type": "text_line_range",
                    "line_start": 2,
                    "line_end": 3,
                },
            )

            self.assertTrue(result.success)
            self.assertEqual("reference_segment", result.output["event"])
            self.assertEqual("reference_library", result.output["source"])
            self.assertEqual("std-root", result.output["root_id"])
            self.assertEqual("ul-60335.txt", result.output["path"])
            self.assertEqual("line 2\nline 3", result.output["content"])

    async def test_read_reference_segment_rejects_paths_outside_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            standards_root = root / "standards"
            standards_root.mkdir()
            outside_file = root / "outside.txt"
            outside_file.write_text("nope", encoding="utf-8")

            config = {
                "reference_library": {
                    "roots": [
                        {
                            "id": "std-root",
                            "label": "UL",
                            "path": str(standards_root),
                            "enabled": True,
                        }
                    ]
                }
            }

            result = await ReadReferenceSegmentTool(lambda: config).execute(
                tool_call_id="read-2",
                root_id="std-root",
                path="../outside.txt",
                locator={
                    "type": "text_line_range",
                    "line_start": 1,
                    "line_end": 1,
                },
            )

            self.assertFalse(result.success)
            self.assertIn("inside reference library root", result.error or "")


if __name__ == "__main__":
    unittest.main()
