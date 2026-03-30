from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "prepare_models.py"
MODULE_SPEC = importlib.util.spec_from_file_location("ocr_prepare_models", MODULE_PATH)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError(f"Unable to load OCR prepare_models module from {MODULE_PATH}")

prepare_models = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(prepare_models)


class _FakeModel:
    def __init__(self, model_dir: Path) -> None:
        self.model_dir = str(model_dir)


class _FakeEngine:
    def __init__(self, det_dir: Path, rec_dir: Path) -> None:
        self.text_detector = _FakeModel(det_dir)
        self.text_recognizer = _FakeModel(rec_dir)


class PrepareModelsTests(unittest.TestCase):
    def test_discover_model_dirs_from_engine_uses_cache_backed_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_root = Path(temp_dir) / ".paddlex" / "official_models"
            det_dir = cache_root / "PP-OCRv5_server_det"
            rec_dir = cache_root / "PP-OCRv5_server_rec"
            det_dir.mkdir(parents=True, exist_ok=True)
            rec_dir.mkdir(parents=True, exist_ok=True)
            (det_dir / "inference.yml").write_text("stub", encoding="utf-8")
            (rec_dir / "inference.yml").write_text("stub", encoding="utf-8")

            engine = _FakeEngine(det_dir, rec_dir)

            with patch.object(prepare_models, "_cache_roots", return_value=[cache_root]):
                self.assertEqual(
                    (det_dir.resolve(), rec_dir.resolve()),
                    prepare_models._discover_model_dirs_from_engine(engine),
                )

    def test_find_latest_cache_model_falls_back_to_most_recent_matching_dir(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_root = Path(temp_dir) / ".paddlex" / "official_models"
            older = cache_root / "old_det"
            newer = cache_root / "new_det"
            older.mkdir(parents=True, exist_ok=True)
            newer.mkdir(parents=True, exist_ok=True)
            (older / "inference.yml").write_text("stub", encoding="utf-8")
            (newer / "inference.yml").write_text("stub", encoding="utf-8")
            os.utime(older, (1, 1))
            os.utime(newer, (2, 2))

            with patch.object(prepare_models, "_cache_roots", return_value=[cache_root]):
                self.assertEqual(newer, prepare_models._find_latest_cache_model("det"))


if __name__ == "__main__":
    unittest.main()
