from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
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

    def test_create_engine_falls_back_when_newer_paddle_kwargs_are_rejected(self) -> None:
        observed_kwargs: list[dict[str, object]] = []

        class FakePaddleOCR:
            def __init__(self, **kwargs: object) -> None:
                observed_kwargs.append(dict(kwargs))
                if "use_doc_preprocessor" in kwargs:
                    raise RuntimeError("Unknown argument: use_doc_preprocessor")
                self.kwargs = kwargs

        with patch.dict(sys.modules, {"paddleocr": types.SimpleNamespace(PaddleOCR=FakePaddleOCR)}):
            with patch.object(server, "_find_local_model_dirs", return_value=(None, None)):
                engine = server.PaddleOcrEngineCache._create_engine("ch")

        self.assertIsInstance(engine, FakePaddleOCR)
        self.assertEqual("ch", engine.kwargs["lang"])
        self.assertNotIn("use_doc_preprocessor", engine.kwargs)
        self.assertEqual("cpu", engine.kwargs["device"])
        self.assertGreaterEqual(len(observed_kwargs), 2)

    def test_create_engine_does_not_swallow_non_compat_errors(self) -> None:
        class FakePaddleOCR:
            def __init__(self, **kwargs: object) -> None:
                raise RuntimeError("model files are missing")

        with patch.dict(sys.modules, {"paddleocr": types.SimpleNamespace(PaddleOCR=FakePaddleOCR)}):
            with patch.object(server, "_find_local_model_dirs", return_value=(None, None)):
                with self.assertRaisesRegex(RuntimeError, "model files are missing"):
                    server.PaddleOcrEngineCache._create_engine("ch")

    def test_format_exception_detail_includes_exception_chain(self) -> None:
        root = RuntimeError("missing shapely")
        wrapped = RuntimeError("pipeline creation failed")
        wrapped.__cause__ = root

        self.assertEqual(
            "RuntimeError: pipeline creation failed <- RuntimeError: missing shapely",
            server._format_exception_detail(wrapped),
        )

    def test_create_engine_disables_pir_api_by_default(self) -> None:
        class FakePaddleOCR:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        with patch.dict(sys.modules, {"paddleocr": types.SimpleNamespace(PaddleOCR=FakePaddleOCR)}):
            with patch.object(server, "_find_local_model_dirs", return_value=(None, None)):
                with patch.dict(server.os.environ, {}, clear=True):
                    engine = server.PaddleOcrEngineCache._create_engine("ch")
                    self.assertEqual("0", server.os.environ["FLAGS_enable_pir_api"])
                    self.assertEqual("cpu", engine.kwargs["device"])


if __name__ == "__main__":
    unittest.main()
