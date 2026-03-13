import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from retrieval.simple_store import SimpleRetrievalStore
from runtime.config import normalize_runtime_config


class ContextProviderRegistryTests(unittest.TestCase):
    def test_registry_builds_enabled_context_providers_from_config(self) -> None:
        from runtime.provider_registry import ContextProviderRegistry

        registry = ContextProviderRegistry(
            skill_search_roots=[
                Path("C:/Users/patri/.agents/skills"),
                Path("C:/Users/patri/.codex/skills"),
            ]
        )
        config = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "context_providers": {
                    "skills": {"local": {"enabled": False}},
                    "retrieval": {
                        "workspace": {
                            "enabled": True,
                            "max_hits": 5,
                            "extensions": [".md", ".py"],
                        }
                    },
                },
            }
        )

        bundle = registry.build_bundle(config)

        self.assertIsNone(bundle.skill_provider)
        self.assertIsInstance(bundle.retrieval_provider, SimpleRetrievalStore)
        self.assertEqual(5, bundle.retrieval_provider.max_hits)
        self.assertEqual((".md", ".py"), bundle.retrieval_provider.extensions)


if __name__ == "__main__":
    unittest.main()
