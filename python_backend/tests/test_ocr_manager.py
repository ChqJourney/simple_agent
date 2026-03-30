import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ocr.manager import OcrSidecarManager, OcrSidecarUnavailableError


class OcrSidecarManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolves_installation_from_override_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            exe_path = root / "ocr-server.exe"
            manifest_path = root / "manifest.json"
            exe_path.write_bytes(b"fake-exe")
            manifest_path.write_text(
                json.dumps(
                    {
                        "name": "work-agent-ocr-sidecar",
                        "version": "0.1.0",
                        "engine": "paddle",
                        "api_version": 1,
                        "entry": "ocr-server.exe",
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"TAURI_AGENT_OCR_SIDECAR_DIR": temp_dir}, clear=False):
                installation = OcrSidecarManager().resolve_installation()

            self.assertEqual(str(root.resolve()), str(installation.root_dir))
            self.assertEqual(str(exe_path.resolve()), str(installation.executable_path))
            self.assertEqual("0.1.0", installation.manifest.version)

    async def test_missing_installation_reports_expected_default_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            expected = Path(temp_dir).resolve() / "ocr-sidecar" / "current"
            with patch.dict(
                os.environ,
                {
                    "TAURI_AGENT_APP_DIR": temp_dir,
                },
                clear=False,
            ):
                manager = OcrSidecarManager()
                with self.assertRaises(OcrSidecarUnavailableError) as ctx:
                    manager.resolve_installation()

            self.assertIn(str(expected), str(ctx.exception))

    async def test_prepare_log_streams_creates_logs_directory_and_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = OcrSidecarManager()

            stdout_handle, stderr_handle = manager._prepare_log_streams(root)
            stdout_handle.close()
            stderr_handle.close()

            stdout_path = root / "logs" / "stdout.log"
            stderr_path = root / "logs" / "stderr.log"

            self.assertTrue(stdout_path.exists())
            self.assertTrue(stderr_path.exists())
            self.assertIn("OCR sidecar start", stdout_path.read_text(encoding="utf-8"))
            self.assertIn("OCR sidecar start", stderr_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
