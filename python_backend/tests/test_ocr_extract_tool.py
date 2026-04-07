import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ocr.contracts import OcrImageLine, OcrImageResponse, OcrSidecarConnection
from ocr.manager import OcrSidecarUnavailableError
from tools.ocr_extract import OcrExtractTool


class FakeManager:
    def __init__(self, *, should_fail: bool = False) -> None:
        self.should_fail = should_fail

    async def ensure_ready(self) -> OcrSidecarConnection:
        if self.should_fail:
            raise OcrSidecarUnavailableError("OCR sidecar is not installed.")

        return OcrSidecarConnection(
            root_dir="C:/work-agent/ocr-sidecar/current",
            executable_path="C:/work-agent/ocr-sidecar/current/ocr-server.exe",
            base_url="http://127.0.0.1:8790",
            auth_token="token",
            version="0.1.0",
            engine="paddle",
            api_version=1,
        )

    def resolve_installation(self):
        class Installation:
            class Manifest:
                version = "0.1.0"

            manifest = Manifest()

        return Installation()


class FakeClient:
    def __init__(self) -> None:
        self.call_count = 0

    async def ocr_image(
        self,
        connection: OcrSidecarConnection,
        image_path: Path,
        *,
        lang: str,
        detail_level: str,
        timeout_seconds: int = 120,
    ) -> OcrImageResponse:
        self.call_count += 1
        return OcrImageResponse(
            success=True,
            text="hello world",
            lines=[
                OcrImageLine(text="hello", bbox=[0.0, 0.0, 40.0, 16.0], score=0.99),
                OcrImageLine(text="world", bbox=[42.0, 0.0, 90.0, 16.0], score=0.98),
            ],
            blocks=[],
            elapsed_ms=123,
            model={"engine": "paddle", "lang": lang},
        )


class OcrExtractToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_extended_tool_timeout_policy(self) -> None:
        tool = OcrExtractTool(manager=FakeManager(), client=FakeClient())
        self.assertEqual(120, tool.policy.timeout_seconds)

    async def test_extracts_text_from_image_via_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_path = root / "scan.png"
            image_path.write_bytes(b"fake-image")

            tool = OcrExtractTool(manager=FakeManager(), client=FakeClient())
            result = await tool.execute(
                tool_call_id="ocr-1",
                workspace_path=temp_dir,
                path="scan.png",
                detail_level="lines",
            )

            self.assertTrue(result.success)
            self.assertEqual("ocr_extract", result.output["event"])
            self.assertEqual("hello world", result.output["content"])
            self.assertEqual(2, result.output["summary"]["line_count"])
            self.assertEqual("0.1.0", result.output["metadata"]["sidecar_version"])

    async def test_reports_unavailable_sidecar_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_path = root / "scan.png"
            image_path.write_bytes(b"fake-image")

            tool = OcrExtractTool(manager=FakeManager(should_fail=True), client=FakeClient())
            result = await tool.execute(
                tool_call_id="ocr-2",
                workspace_path=temp_dir,
                path="scan.png",
            )

            self.assertFalse(result.success)
            self.assertIn("not installed", result.error or "")

    async def test_pdf_requests_are_deferred_to_phase_three(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "scan.pdf"
            pdf_path.write_bytes(b"%PDF-1.7")

            client = FakeClient()
            tool = OcrExtractTool(manager=FakeManager(), client=client)
            with patch(
                "tools.ocr_extract.render_pdf_pages_to_images",
                return_value={
                    "pdf_path": str(pdf_path),
                    "page_count": 2,
                    "pages": [1, 2],
                    "dpi": 144,
                    "image_format": "png",
                    "items": [
                        {"page_number": 1, "image_path": str(root / "page-1.png")},
                        {"page_number": 2, "image_path": str(root / "page-2.png")},
                    ],
                },
            ):
                result = await tool.execute(
                    tool_call_id="ocr-3",
                    workspace_path=temp_dir,
                    path="scan.pdf",
                    pages="1-2",
                )

            self.assertTrue(result.success)
            self.assertEqual("pdf", result.output["input_type"])
            self.assertEqual([1, 2], result.output["summary"]["requested_pages"])
            self.assertEqual(2, client.call_count)
            self.assertIn("[Page 1]", result.output["content"])

    async def test_uses_workspace_cache_for_repeated_image_requests(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_path = root / "cached.png"
            image_path.write_bytes(b"fake-image")

            client = FakeClient()
            tool = OcrExtractTool(manager=FakeManager(), client=client)
            first = await tool.execute(
                tool_call_id="ocr-4a",
                workspace_path=temp_dir,
                path="cached.png",
            )
            second = await tool.execute(
                tool_call_id="ocr-4b",
                workspace_path=temp_dir,
                path="cached.png",
            )

            self.assertTrue(first.success)
            self.assertTrue(second.success)
            self.assertEqual(1, client.call_count)
            self.assertFalse(first.output["metadata"]["cache_hit"])
            self.assertTrue(second.output["metadata"]["cache_hit"])


if __name__ == "__main__":
    unittest.main()
