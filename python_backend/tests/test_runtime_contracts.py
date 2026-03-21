import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.config import normalize_runtime_config
from runtime.contracts import LockedModelRef, SessionMetadata
from runtime.events import RunEvent


class RuntimeContractTests(unittest.TestCase):
    def test_normalize_runtime_config_promotes_flat_config_to_primary_profile(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "base_url": "   ",
                "enable_reasoning": False,
            }
        )

        self.assertEqual("openai", normalized["provider"])
        self.assertIn("profiles", normalized)
        self.assertIn("primary", normalized["profiles"])
        self.assertEqual("gpt-4o-mini", normalized["profiles"]["primary"]["model"])
        self.assertEqual("primary", normalized["profiles"]["primary"]["profile_name"])
        self.assertEqual("https://api.openai.com/v1", normalized["profiles"]["primary"]["base_url"])
        self.assertIn("runtime", normalized)
        self.assertEqual(
            {
                "context_length": 64000,
                "max_output_tokens": 4000,
                "max_tool_rounds": 20,
                "max_retries": 3,
            },
            normalized["runtime"],
        )
        self.assertEqual({"base_font_size": 16}, normalized["appearance"])
        self.assertEqual(
            {
                "skills": {"local": {"enabled": True}},
                "retrieval": {
                    "workspace": {
                        "enabled": True,
                        "max_hits": 3,
                        "extensions": [".md", ".txt", ".json"],
                    }
                },
            },
            normalized["context_providers"],
        )

    def test_normalize_runtime_config_supports_deepseek(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "deepseek",
                "model": "deepseek-chat",
                "api_key": "test-key",
                "base_url": "   ",
                "enable_reasoning": False,
            }
        )

        self.assertEqual("deepseek", normalized["provider"])
        self.assertEqual("deepseek", normalized["profiles"]["primary"]["provider"])
        self.assertEqual("https://api.deepseek.com", normalized["profiles"]["primary"]["base_url"])

    def test_normalize_runtime_config_supports_kimi(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "kimi",
                "model": "kimi-k2.5",
                "api_key": "test-key",
                "base_url": "   ",
                "enable_reasoning": True,
            }
        )

        self.assertEqual("kimi", normalized["provider"])
        self.assertEqual("kimi", normalized["profiles"]["primary"]["provider"])
        self.assertEqual("https://api.moonshot.cn/v1", normalized["profiles"]["primary"]["base_url"])
        self.assertTrue(normalized["profiles"]["primary"]["enable_reasoning"])

    def test_normalize_runtime_config_supports_glm(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "glm",
                "model": "glm-4.6v",
                "api_key": "test-key",
                "base_url": "   ",
                "enable_reasoning": True,
            }
        )

        self.assertEqual("glm", normalized["provider"])
        self.assertEqual("glm", normalized["profiles"]["primary"]["provider"])
        self.assertEqual("https://open.bigmodel.cn/api/paas/v4", normalized["profiles"]["primary"]["base_url"])
        self.assertEqual("text", normalized["profiles"]["primary"]["input_type"])

    def test_normalize_runtime_config_supports_minimax(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "minimax",
                "model": "MiniMax-M2.7",
                "api_key": "test-key",
                "base_url": "   ",
                "enable_reasoning": True,
            }
        )

        self.assertEqual("minimax", normalized["provider"])
        self.assertEqual("minimax", normalized["profiles"]["primary"]["provider"])
        self.assertEqual("https://api.minimaxi.com/v1", normalized["profiles"]["primary"]["base_url"])
        self.assertFalse(normalized["profiles"]["primary"]["enable_reasoning"])

    def test_normalize_runtime_config_preserves_custom_appearance_font_size(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "base_url": "https://api.openai.com/v1",
                "enable_reasoning": False,
                "appearance": {
                    "base_font_size": 18,
                },
            }
        )

        self.assertEqual({"base_font_size": 18}, normalized["appearance"])

    def test_run_event_serializes_stable_fields(self) -> None:
        event = RunEvent(
            event_type="run_started",
            session_id="session-1",
            run_id="run-1",
            payload={"step": "planning"},
        )

        serialized = event.model_dump(mode="json")

        self.assertEqual("run_started", serialized["event_type"])
        self.assertEqual("session-1", serialized["session_id"])
        self.assertEqual("run-1", serialized["run_id"])
        self.assertEqual({"step": "planning"}, serialized["payload"])
        self.assertIn("timestamp", serialized)

    def test_session_metadata_preserves_title_and_locked_model_placeholders(self) -> None:
        metadata = SessionMetadata(
            session_id="session-1",
            workspace_path="/workspace",
            title="Investigate routing",
            locked_model=LockedModelRef(
                profile_name="primary",
                provider="openai",
                model="gpt-4o-mini",
            ),
        )

        serialized = metadata.model_dump(mode="json")

        self.assertEqual("Investigate routing", serialized["title"])
        self.assertEqual("primary", serialized["locked_model"]["profile_name"])
        self.assertEqual("gpt-4o-mini", serialized["locked_model"]["model"])


if __name__ == "__main__":
    unittest.main()
