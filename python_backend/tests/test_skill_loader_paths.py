import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main as backend_main
from skills.local_loader import LocalSkillLoader


class SkillLoaderPathTests(unittest.TestCase):
    def test_backend_runtime_uses_only_system_agent_skill_root(self) -> None:
        self.assertEqual(
            [Path.home() / ".agent" / "skills"],
            backend_main.context_provider_registry.skill_search_roots,
        )

    def test_local_skill_loader_scans_workspace_agent_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace_path = Path(temp_dir)
            skill_dir = workspace_path / ".agent" / "skills" / "deploy-checks"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: deploy-checks\ndescription: Deployment checklist\n---\nAlways verify traffic before deploy.\n",
                encoding="utf-8",
            )

            loader = LocalSkillLoader(search_roots=[])
            resolved = loader.resolve("please use $deploy-checks", workspace_path=str(workspace_path))

            self.assertEqual(["deploy-checks"], [skill.name for skill in resolved])


if __name__ == "__main__":
    unittest.main()
