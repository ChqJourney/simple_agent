import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from skills.local_loader import LocalSkillLoader, default_skill_search_roots


class SkillLoaderPathTests(unittest.TestCase):
    def test_backend_runtime_uses_app_data_skill_root(self) -> None:
        with patch.dict("os.environ", {"TAURI_AGENT_APP_DATA_DIR": "/tmp/work-agent-data"}, clear=False):
            roots = default_skill_search_roots()

        self.assertEqual(
            [Path("/tmp/work-agent-data") / "skills"],
            roots,
        )

    def test_backend_runtime_prefers_user_skill_root_over_portable_app_skill_root(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "TAURI_AGENT_APP_DIR": "/opt/simple-agent",
                "TAURI_AGENT_APP_DATA_DIR": "/tmp/work-agent-data",
            },
            clear=False,
        ):
            roots = default_skill_search_roots()

        self.assertEqual(
            [
                Path("/opt/simple-agent") / "skills",
                Path("/tmp/work-agent-data") / "skills",
            ],
            roots,
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
            resolved = loader.list_skills(workspace_path=str(workspace_path))

            self.assertEqual(["deploy-checks"], [skill.name for skill in resolved])
            self.assertEqual("workspace", resolved[0].source)


if __name__ == "__main__":
    unittest.main()
