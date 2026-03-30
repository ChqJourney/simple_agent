from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SERVER_PATH = Path(__file__).resolve().parents[1] / "server.py"
SERVER_SPEC = importlib.util.spec_from_file_location("ocr_sidecar_server", SERVER_PATH)
if SERVER_SPEC is None or SERVER_SPEC.loader is None:
    raise RuntimeError(f"Unable to load OCR sidecar server module from {SERVER_PATH}")

server = importlib.util.module_from_spec(SERVER_SPEC)
SERVER_SPEC.loader.exec_module(server)


class OcrSidecarServerTests(unittest.TestCase):
    def test_runtime_root_defaults_to_script_directory(self) -> None:
        self.assertEqual(SERVER_PATH.parent, server._runtime_root())

    def test_find_local_model_dirs_prefers_bundled_models(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir)
            det_dir = runtime_root / "models" / "ch" / "text_detection"
            rec_dir = runtime_root / "models" / "ch" / "text_recognition"
            det_dir.mkdir(parents=True, exist_ok=True)
            rec_dir.mkdir(parents=True, exist_ok=True)
            (det_dir / "model.pdparams").write_text("stub", encoding="utf-8")
            (rec_dir / "model.pdparams").write_text("stub", encoding="utf-8")

            with patch.object(server, "_runtime_root", return_value=runtime_root):
                self.assertEqual((det_dir, rec_dir), server._find_local_model_dirs("ch"))

    def test_find_local_model_dirs_requires_both_model_roots(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir)
            det_dir = runtime_root / "models" / "en" / "text_detection"
            det_dir.mkdir(parents=True, exist_ok=True)
            (det_dir / "model.pdparams").write_text("stub", encoding="utf-8")

            with patch.object(server, "_runtime_root", return_value=runtime_root):
                self.assertEqual((None, None), server._find_local_model_dirs("en"))


if __name__ == "__main__":
    unittest.main()
