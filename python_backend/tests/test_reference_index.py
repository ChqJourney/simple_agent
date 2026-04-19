import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime import reference_index


def _fake_document_payload(file_path: Path, root_path: Path) -> dict:
    stat_result = file_path.stat()
    relative_path = str(file_path.relative_to(root_path)).replace("\\", "/")
    return {
        "doc_id": reference_index._doc_id(relative_path),
        "relative_path": relative_path,
        "path": str(file_path.resolve()),
        "file_name": file_path.name,
        "title": file_path.stem,
        "standard_code": file_path.stem.upper(),
        "page_count": 10,
        "outline_titles": ["Scope", "Requirements"],
        "outline_count": 2,
        "scope_excerpt": f"Scope excerpt for {file_path.stem}",
        "scope_source": {"type": "outline_section", "label": "Scope", "page_start": 1, "page_end": 2},
        "size_bytes": stat_result.st_size,
        "modified_at": reference_index._modified_iso(stat_result),
        "modified_at_ns": stat_result.st_mtime_ns,
        "sha256": f"sha-{file_path.stem}",
    }


async def _fake_summary(document: dict, llm=None) -> dict:
    return {
        "scope_summary": f"Summary for {document['file_name']}",
        "topics": ["scope", "requirements"],
        "summary_source": "test",
    }


class ReferenceIndexTests(unittest.IsolatedAsyncioTestCase):
    async def test_build_reference_index_creates_and_updates_catalog_incrementally(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root_path = Path(temp_dir)
            first = root_path / "IEC-60335-1.pdf"
            second = root_path / "IEC-60335-2.pdf"
            first.write_bytes(b"first")
            second.write_bytes(b"second")

            with (
                patch("runtime.reference_index._extract_document_data_sync", side_effect=_fake_document_payload),
                patch("runtime.reference_index.summarize_document_scope", side_effect=_fake_summary),
            ):
                initial = await reference_index.build_reference_index("root-a", str(root_path))

            self.assertEqual(2, initial["counts"]["created"])
            self.assertEqual(0, initial["counts"]["updated"])
            self.assertEqual(0, initial["counts"]["removed"])
            self.assertEqual(0, initial["counts"]["unchanged"])

            second.unlink()
            first.write_bytes(b"first-updated")
            third = root_path / "IEC-60335-3.pdf"
            third.write_bytes(b"third")

            stale_status = reference_index.compute_reference_index_status("root-a", str(root_path))
            self.assertEqual("stale", stale_status["status"])
            self.assertEqual(1, stale_status["pending"]["new"])
            self.assertEqual(1, stale_status["pending"]["updated"])
            self.assertEqual(1, stale_status["pending"]["removed"])

            with (
                patch("runtime.reference_index._extract_document_data_sync", side_effect=_fake_document_payload),
                patch("runtime.reference_index.summarize_document_scope", side_effect=_fake_summary),
            ):
                updated = await reference_index.build_reference_index("root-a", str(root_path))

            self.assertEqual(1, updated["counts"]["created"])
            self.assertEqual(1, updated["counts"]["updated"])
            self.assertEqual(1, updated["counts"]["removed"])
            self.assertEqual(0, updated["counts"]["unchanged"])

            ready_status = reference_index.compute_reference_index_status("root-a", str(root_path))
            self.assertEqual("ready", ready_status["status"])
            self.assertEqual(2, ready_status["document_count"])
            self.assertEqual(2, ready_status["indexed_document_count"])

            catalog_path = reference_index.reference_root_catalog_path(str(root_path))
            payload = reference_index._load_catalog(catalog_path)
            self.assertIsNotNone(payload)
            documents = payload["documents"]
            self.assertEqual(
                ["IEC-60335-1.pdf", "IEC-60335-3.pdf"],
                sorted(document["file_name"] for document in documents),
            )

    async def test_build_reference_index_reports_progress_updates(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root_path = Path(temp_dir)
            first = root_path / "IEC-60335-1.pdf"
            second = root_path / "IEC-60335-2.pdf"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            progress_events: list[dict] = []

            async def capture_progress(payload: dict) -> None:
                progress_events.append(payload)

            with (
                patch("runtime.reference_index._extract_document_data_sync", side_effect=_fake_document_payload),
                patch("runtime.reference_index.summarize_document_scope", side_effect=_fake_summary),
            ):
                result = await reference_index.build_reference_index(
                    "root-progress",
                    str(root_path),
                    progress_callback=capture_progress,
                )

            self.assertEqual("ready", result["status"])
            self.assertGreaterEqual(len(progress_events), 4)
            self.assertEqual("scanning", progress_events[0]["phase"])
            self.assertIn(progress_events[-1]["phase"], {"completed"})
            self.assertEqual(100, progress_events[-1]["progress_percent"])
            self.assertTrue(
                any(event["phase"] == "summarizing" for event in progress_events),
                "expected at least one summarizing progress event",
            )

    def test_status_reports_missing_root(self) -> None:
        status = reference_index.compute_reference_index_status("root-missing", "/tmp/does-not-exist-reference-index")
        self.assertEqual("missing_root", status["status"])
        self.assertFalse(status["exists"])


if __name__ == "__main__":
    unittest.main()
