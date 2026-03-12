import importlib
import sys
import unittest
import warnings
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class UserModelWarningTests(unittest.TestCase):
    def test_importing_message_model_does_not_emit_protected_namespace_warning(self) -> None:
        existing_module = sys.modules.pop("core.user", None)

        try:
            with warnings.catch_warnings(record=True) as captured:
                warnings.simplefilter("always")
                importlib.import_module("core.user")

            protected_namespace_warnings = [
                warning
                for warning in captured
                if "protected namespace" in str(warning.message)
            ]
            self.assertEqual([], protected_namespace_warnings)
        finally:
            sys.modules.pop("core.user", None)
            if existing_module is not None:
                sys.modules["core.user"] = existing_module


if __name__ == "__main__":
    unittest.main()
