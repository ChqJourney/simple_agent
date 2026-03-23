import sys
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


if __name__ == "__main__":
    unittest.main()
