import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.config import normalize_runtime_config
from runtime.contracts import (
    LockedModelRef,
    ReplayPlan,
    SessionCompactionRecord,
    SessionMemorySnapshot,
    SessionMetadata,
)
from runtime.events import RunEvent
from runtime.router import build_execution_spec


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
                "shared": {
                    "context_length": 64000,
                    "max_output_tokens": 4000,
                    "max_tool_rounds": 20,
                    "max_retries": 3,
                    "timeout_seconds": 120,
                },
            },
            normalized["runtime"],
        )
        self.assertEqual({"base_font_size": 16}, normalized["appearance"])
        self.assertEqual(
            {
                "skills": {"local": {"enabled": True}},
            },
            normalized["context_providers"],
        )
        self.assertEqual("", normalized["system_prompt"])

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

    def test_normalize_runtime_config_trims_custom_system_prompt(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "base_url": "https://api.openai.com/v1",
                "enable_reasoning": False,
                "system_prompt": "  Prefer concise answers.  ",
            }
        )

        self.assertEqual("Prefer concise answers.", normalized["system_prompt"])

    def test_build_execution_spec_merges_shared_and_role_runtime(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "runtime": {
                    "shared": {
                        "context_length": 64000,
                        "max_output_tokens": 4000,
                        "max_tool_rounds": 20,
                        "max_retries": 3,
                        "timeout_seconds": 120,
                    },
                    "background": {
                        "max_output_tokens": 512,
                    },
                },
                "profiles": {
                    "primary": {
                        "provider": "openai",
                        "model": "gpt-4o-mini",
                        "api_key": "test-key",
                        "base_url": "https://api.openai.com/v1",
                        "enable_reasoning": False,
                    },
                    "background": {
                        "provider": "deepseek",
                        "model": "deepseek-chat",
                        "api_key": "test-key",
                        "base_url": "https://api.deepseek.com",
                        "enable_reasoning": False,
                    },
                },
            }
        )

        execution_spec = build_execution_spec(normalized, "background")

        self.assertEqual("background", execution_spec["role"])
        self.assertEqual("deepseek", execution_spec["profile"]["provider"])
        self.assertEqual(512, execution_spec["runtime"]["max_output_tokens"])
        self.assertEqual(20, execution_spec["runtime"]["max_tool_rounds"])
        self.assertEqual(120, execution_spec["runtime"]["timeout_seconds"])
        self.assertEqual(["text"], execution_spec["capability_summary"]["supported_input_types"])
        self.assertFalse(execution_spec["capability_summary"]["reasoning_supported"])

    def test_build_execution_spec_clamps_runtime_when_it_exceeds_known_model_limits(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
                "runtime": {
                    "shared": {
                        "context_length": 256000,
                        "max_output_tokens": 200000,
                        "max_tool_rounds": 20,
                        "max_retries": 3,
                        "timeout_seconds": 120,
                    },
                },
                "profiles": {
                    "primary": {
                        "provider": "openai",
                        "model": "gpt-4o",
                        "api_key": "test-key",
                        "base_url": "https://api.openai.com/v1",
                        "enable_reasoning": False,
                    },
                },
            }
        )

        execution_spec = build_execution_spec(normalized, "conversation")

        self.assertEqual(128000, execution_spec["runtime"]["context_length"])
        self.assertEqual(128000, execution_spec["runtime"]["max_output_tokens"])
        self.assertEqual(256000, execution_spec["guardrails"]["requested_runtime"]["context_length"])
        self.assertEqual(200000, execution_spec["guardrails"]["requested_runtime"]["max_output_tokens"])
        self.assertEqual(128000, execution_spec["guardrails"]["model_context_limit"])
        self.assertEqual(
            [
                "context_length 256000 exceeds known model window 128000",
                "max_output_tokens 200000 exceeds effective context_length 128000",
            ],
            execution_spec["guardrails"]["warnings"],
        )

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

    def test_session_memory_snapshot_serializes_structured_memory_fields(self) -> None:
        snapshot = SessionMemorySnapshot(
            session_id="session-1",
            covered_until_message_index=12,
            current_task="Plan session compaction",
            completed_milestones=["Agreed on thresholds"],
            open_loops=["Implement phase 1"],
            estimated_tokens=320,
        )

        serialized = snapshot.model_dump(mode="json")

        self.assertEqual("session-1", serialized["session_id"])
        self.assertEqual(12, serialized["covered_until_message_index"])
        self.assertEqual("Plan session compaction", serialized["current_task"])
        self.assertEqual(["Agreed on thresholds"], serialized["completed_milestones"])
        self.assertEqual(["Implement phase 1"], serialized["open_loops"])
        self.assertEqual(320, serialized["estimated_tokens"])
        self.assertIn("updated_at", serialized)

    def test_session_compaction_record_serializes_model_metadata(self) -> None:
        record = SessionCompactionRecord(
            compaction_id="compact-1",
            strategy="background",
            source_start_index=0,
            source_end_index=15,
            pre_tokens_estimate=9000,
            post_tokens_estimate=500,
            model={
                "profile_name": "background",
                "provider": "openai",
                "model": "gpt-4o-mini",
            },
        )

        serialized = record.model_dump(mode="json")

        self.assertEqual("compact-1", serialized["compaction_id"])
        self.assertEqual("background", serialized["strategy"])
        self.assertEqual(15, serialized["source_end_index"])
        self.assertEqual("background", serialized["model"]["profile_name"])
        self.assertEqual("gpt-4o-mini", serialized["model"]["model"])
        self.assertIn("created_at", serialized)

    def test_replay_plan_defaults_history_messages_to_empty_list(self) -> None:
        plan = ReplayPlan()

        self.assertEqual([], plan.history_messages)
        self.assertFalse(plan.forced_compaction_required)
        self.assertFalse(plan.background_compaction_recommended)


if __name__ == "__main__":
    unittest.main()
