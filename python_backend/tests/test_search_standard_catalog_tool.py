import json
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.reference_index import reference_root_catalog_path
from tools.search_standard_catalog import SearchStandardCatalogTool


def _write_catalog(root_path: Path, documents: list[dict]) -> Path:
    catalog_path = reference_root_catalog_path(root_path)
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "root_id": "root-1",
        "root_path": str(root_path.resolve()),
        "generated_at": "2026-04-18T00:00:00Z",
        "documents": documents,
    }
    with catalog_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return catalog_path


class SearchStandardCatalogToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_searches_catalog_and_returns_ranked_standard_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root_path = Path(temp_dir)
            pdf_a = root_path / "IEC-60335-1.pdf"
            pdf_b = root_path / "IEC-60598-1.pdf"
            pdf_a.write_bytes(b"%PDF-1.7")
            pdf_b.write_bytes(b"%PDF-1.7")
            catalog_path = _write_catalog(
                root_path,
                [
                    {
                        "path": str(pdf_a.resolve()),
                        "relative_path": "IEC-60335-1.pdf",
                        "file_name": "IEC-60335-1.pdf",
                        "title": "Household and similar electrical appliances - Safety - Part 1",
                        "standard_code": "IEC 60335-1",
                        "scope_summary": "Safety requirements for household and similar electrical appliances.",
                        "topics": ["household appliance", "safety"],
                        "outline_titles": ["Scope", "Definitions"],
                        "scope_source": {"type": "outline_section", "label": "Scope", "page_start": 5, "page_end": 6},
                    },
                    {
                        "path": str(pdf_b.resolve()),
                        "relative_path": "IEC-60598-1.pdf",
                        "file_name": "IEC-60598-1.pdf",
                        "title": "Luminaires - Part 1",
                        "standard_code": "IEC 60598-1",
                        "scope_summary": "Safety requirements for luminaires.",
                        "topics": ["lighting", "luminaire"],
                        "outline_titles": ["Scope", "General"],
                        "scope_source": {"type": "outline_section", "label": "Scope", "page_start": 3, "page_end": 4},
                    },
                ],
            )

            result = await SearchStandardCatalogTool().execute(
                tool_call_id="catalog-1",
                query="household appliance safety",
                reference_library_roots=[str(root_path)],
            )

            self.assertTrue(result.success)
            self.assertEqual("standard_catalog_search_results", result.output["event"])
            self.assertEqual(1, result.output["summary"]["indexed_root_count"])
            self.assertEqual(str(catalog_path), result.output["results"][0]["catalog_path"])
            self.assertEqual("IEC 60335-1", result.output["results"][0]["standard_code"])
            self.assertEqual(str(pdf_a.resolve()), result.output["results"][0]["path"])
            self.assertEqual("pdf_read_pages", result.output["results"][0]["recommended_follow_up"]["tool"])
            self.assertEqual(5, result.output["results"][0]["recommended_follow_up"]["page_start"])
            self.assertEqual(str(pdf_a.resolve()), result.output["recommended_next_actions"][0]["path"])
            self.assertEqual("pdf_read_pages", result.output["recommended_next_actions"][0]["tool"])

    async def test_returns_error_when_catalog_has_not_been_built(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = await SearchStandardCatalogTool().execute(
                tool_call_id="catalog-2",
                query="household appliance safety",
                reference_library_roots=[temp_dir],
            )

            self.assertFalse(result.success)
            self.assertIn("No standard catalog is available", result.error)

    async def test_recommends_outline_when_scope_pages_are_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root_path = Path(temp_dir)
            pdf_path = root_path / "IEC-60730-1.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")
            _write_catalog(
                root_path,
                [
                    {
                        "path": str(pdf_path.resolve()),
                        "relative_path": "IEC-60730-1.pdf",
                        "file_name": "IEC-60730-1.pdf",
                        "title": "Automatic electrical controls for household and similar use",
                        "standard_code": "IEC 60730-1",
                        "scope_summary": "Requirements for automatic electrical controls.",
                        "topics": ["automatic controls"],
                        "outline_titles": ["Foreword", "Scope", "Definitions"],
                        "scope_source": {"type": "outline_section", "label": "Scope"},
                    }
                ],
            )

            result = await SearchStandardCatalogTool().execute(
                tool_call_id="catalog-3",
                query="automatic controls",
                reference_library_roots=[str(root_path)],
            )

            self.assertTrue(result.success)
            self.assertEqual("pdf_get_outline", result.output["results"][0]["recommended_follow_up"]["tool"])
            self.assertIn("Inspect the PDF outline first", result.output["results"][0]["recommended_follow_up"]["reason"])


if __name__ == "__main__":
    unittest.main()
