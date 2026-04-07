from __future__ import annotations

import re
import unittest
from pathlib import Path


SPEC_PATH = Path(__file__).resolve().parents[1] / "ocr_sidecar.spec"
REQUIREMENTS_PATH = Path(__file__).resolve().parents[1] / "requirements.txt"


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
        self.assertRegex(source, re.compile(r'requires\((["\'])paddlex\1\)'))
        self.assertRegex(source, re.compile(r'(["\'])ocr-core\1'))
        self.assertRegex(source, re.compile(r'def _copy_metadata_if_installed'))
        self.assertRegex(source, re.compile(r'Skipping metadata for missing distribution'))

    def test_requires_paddlex_ocr_extra(self) -> None:
        requirements = REQUIREMENTS_PATH.read_text(encoding="utf-8")
        self.assertRegex(requirements, re.compile(r'^paddlex\[ocr-core\].*$', re.MULTILINE))


if __name__ == "__main__":
    unittest.main()
