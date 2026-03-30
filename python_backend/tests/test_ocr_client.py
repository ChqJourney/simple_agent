from __future__ import annotations

import sys
import unittest
from pathlib import Path

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ocr.client import OcrSidecarClient


class OcrSidecarClientTests(unittest.TestCase):
    def test_raise_for_status_with_detail_uses_json_detail(self) -> None:
        request = httpx.Request("POST", "http://127.0.0.1:9999/ocr/image")
        response = httpx.Response(
            500,
            request=request,
            json={"detail": "Missing OCR model: textline orientation"},
        )

        with self.assertRaises(RuntimeError) as ctx:
            OcrSidecarClient._raise_for_status_with_detail(response)

        self.assertIn("HTTP 500", str(ctx.exception))
        self.assertIn("Missing OCR model", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
