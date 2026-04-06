from __future__ import annotations

import re
import unittest
from pathlib import Path


SPEC_PATH = Path(__file__).resolve().parents[1] / "ocr_sidecar.spec"


class OcrSidecarBuildSpecTests(unittest.TestCase):
    def test_collects_chardet_runtime_modules(self) -> None:
        source = SPEC_PATH.read_text(encoding="utf-8")

        self.assertRegex(source, re.compile(r'["\']chardet["\']'))
        self.assertRegex(source, re.compile(r'collect_submodules\((["\'])chardet\.pipeline\1\)'))
        self.assertRegex(
            source,
            re.compile(r'(["\'])chardet\.pipeline\.orchestrator__mypyc\1'),
        )
        self.assertRegex(source, re.compile(r'(["\'])paddleocr\1'))
        self.assertRegex(source, re.compile(r'(["\'])paddlex\1'))
        self.assertRegex(source, re.compile(r'(["\'])paddlepaddle\1'))


if __name__ == "__main__":
    unittest.main()
