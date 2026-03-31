import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.config import normalize_runtime_config


class ContextProviderRegistryTests(unittest.TestCase):
    def test_registry_builds_skill_provider_from_config(self) -> None:
        from runtime.provider_registry import ContextProviderRegistry

        registry = ContextProviderRegistry(
            skill_search_roots=[
                Path("C:/Users/patri/AppData/Roaming/tauri_agent/skills"),
            ]
        )
        config = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "context_providers": {
                    "skills": {"local": {"enabled": False}},
                },
            }
        )

        bundle = registry.build_bundle(config)

        self.assertIsNone(bundle.skill_provider)
        self.assertEqual([Path("C:/Users/patri/AppData/Roaming/tauri_agent/skills")], registry.skill_search_roots)

    def test_registry_filters_disabled_system_skills_from_app_provider(self) -> None:
        from runtime.provider_registry import ContextProviderRegistry

        with tempfile.TemporaryDirectory() as temp_dir:
            skill_root = Path(temp_dir) / "skills"
            enabled_dir = skill_root / "enabled-skill"
            disabled_dir = skill_root / "deploy-checks"
            enabled_dir.mkdir(parents=True)
            disabled_dir.mkdir(parents=True)
            (enabled_dir / "SKILL.md").write_text(
                "---\nname: enabled-skill\ndescription: Enabled\n---\nEnabled content\n",
                encoding="utf-8",
            )
            (disabled_dir / "SKILL.md").write_text(
                "---\nname: deploy-checks\ndescription: Disabled\n---\nDisabled content\n",
                encoding="utf-8",
            )

            registry = ContextProviderRegistry(skill_search_roots=[skill_root])
            config = normalize_runtime_config(
                {
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "api_key": "test-key",
                    "context_providers": {
                        "skills": {
                            "local": {"enabled": True},
                            "system": {"disabled": ["deploy-checks"]},
                        },
                    },
                }
            )

            bundle = registry.build_bundle(config)
            self.assertIsNotNone(bundle.skill_provider)
            listed_skills = bundle.skill_provider.list_skills(workspace_path="")

            self.assertEqual(["enabled-skill"], [skill.name for skill in listed_skills])


if __name__ == "__main__":
    unittest.main()
