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
        self.assertIn("search_documents", spec["tool_allowlist"])
        self.assertIn("Conclusion, Evidence, Uncertainties, and Needed Information", spec["system_prompt_addendum"])
        self.assertIn("absolute_path", spec["system_prompt_addendum"])
        self.assertIn("Avoid hidden workspace metadata such as .agent", spec["system_prompt_addendum"])
        self.assertIn("Do not launch multiple expensive PDF searches or page reads in parallel", spec["system_prompt_addendum"])
        self.assertIn("pdf_get_info, pdf_get_outline, or get_document_structure", spec["system_prompt_addendum"])

    def test_returns_checklist_evaluation_spec(self) -> None:
        spec = get_scenario_spec("checklist_evaluation")
        self.assertEqual("checklist_evaluation", spec["scenario_id"])
        self.assertIn("extract_checklist_rows", spec["tool_allowlist"])
        self.assertIn("file_write", spec["tool_allowlist"])
        self.assertIn("search_documents", spec["tool_allowlist"])
        self.assertIn("Treat checklist extraction as an AI-first task", spec["system_prompt_addendum"])
        self.assertIn("Prioritize checklist files and evidence files that the user explicitly names", spec["system_prompt_addendum"])
        self.assertIn("must begin with a single ```json fenced block", spec["system_prompt_addendum"])
        self.assertIn("clause_id, requirement, evidence, judgement, confidence, and missing_info", spec["system_prompt_addendum"])
        self.assertIn("use file_write directly", spec["system_prompt_addendum"])
        self.assertIn("absolute_path", spec["system_prompt_addendum"])
        self.assertIn("Avoid hidden workspace metadata such as .agent", spec["system_prompt_addendum"])
        self.assertIn("Do not launch multiple expensive PDF searches or page reads in parallel", spec["system_prompt_addendum"])

    def test_unknown_scenario_falls_back_to_default(self) -> None:
        spec = get_scenario_spec("unknown")
        self.assertEqual("default", spec["scenario_id"])


if __name__ == "__main__":
    unittest.main()
