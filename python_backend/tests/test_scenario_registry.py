import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.scenarios import get_scenario_spec


class ScenarioRegistryTests(unittest.TestCase):
    def test_defaults_to_default_scenario(self) -> None:
        spec = get_scenario_spec(None)
        self.assertEqual("default", spec["scenario_id"])

    def test_returns_standard_qa_spec(self) -> None:
        spec = get_scenario_spec("standard_qa")
        self.assertEqual("standard_qa", spec["scenario_id"])
        self.assertIn("Standard QA", spec["label"])
        self.assertIn("search_reference_library", spec["tool_allowlist"])
        self.assertIn("read_reference_segment", spec["tool_allowlist"])
        self.assertIn("Conclusion, Evidence, Uncertainties, and Needed Information", spec["system_prompt_addendum"])

    def test_unknown_scenario_falls_back_to_default(self) -> None:
        spec = get_scenario_spec("unknown")
        self.assertEqual("default", spec["scenario_id"])


if __name__ == "__main__":
    unittest.main()
