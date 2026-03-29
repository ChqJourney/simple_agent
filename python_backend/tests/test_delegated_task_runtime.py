import json
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.config import normalize_runtime_config
from runtime.delegation import DelegatedTaskRunner


class FakeDelegatedLLM:
    def __init__(self) -> None:
        self.messages = []
        self.closed = False

    async def complete(self, messages, tools=None):
        self.messages = messages
        return {
            "choices": [
                {
                    "message": {
                        "content": "```json\n"
                        + json.dumps(
                            {
                                "summary": "Found two unresolved risks.",
                                "data": {"risks": ["runtime mismatch", "missing delegate tool"]},
                            },
                            ensure_ascii=False,
                        )
                        + "\n```"
                    }
                }
            ]
        }

    async def aclose(self):
        self.closed = True


class InvalidDelegatedLLM:
    async def complete(self, messages, tools=None):
        return {
            "choices": [
                {
                    "message": {
                        "content": "not valid json",
                    }
                }
            ]
        }

    async def aclose(self):
        return None


class DelegatedTaskRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_runner_uses_delegated_task_role_and_returns_worker_metadata(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
                "profiles": {
                    "primary": {
                        "provider": "openai",
                        "model": "gpt-4o",
                        "api_key": "test-key",
                        "base_url": "https://api.openai.com/v1",
                        "enable_reasoning": False,
                    },
                    "background": {
                        "provider": "openai",
                        "model": "gpt-4o-mini",
                        "api_key": "test-key",
                        "base_url": "https://api.openai.com/v1",
                        "enable_reasoning": False,
                    },
                },
                "runtime": {
                    "shared": {
                        "context_length": 64000,
                        "max_output_tokens": 4000,
                        "max_tool_rounds": 20,
                        "max_retries": 3,
                    },
                    "delegated_task": {
                        "max_output_tokens": 512,
                    },
                },
            }
        )

        seen_execution_specs = []
        fake_llm = FakeDelegatedLLM()
        runner = DelegatedTaskRunner(
            config_getter=lambda: normalized,
            llm_factory=lambda execution_spec: seen_execution_specs.append(execution_spec) or fake_llm,
        )

        result = await runner.execute(
            task="Summarize unresolved risks",
            expected_output="json",
            context={
                "tool_results": [
                    {
                        "tool_name": "search_documents",
                        "summary": "runtime clamp pending",
                        "success": True,
                    }
                ],
                "constraints": ["Keep the answer brief"],
                "notes": "Focus on unresolved items only.",
                "ignored_key": "should be dropped",
            },
        )

        self.assertEqual(1, len(seen_execution_specs))
        self.assertEqual("delegated_task", seen_execution_specs[0]["role"])
        self.assertEqual("background", seen_execution_specs[0]["profile"]["profile_name"])
        self.assertEqual(512, seen_execution_specs[0]["runtime"]["max_output_tokens"])
        self.assertEqual("delegated_task", result["event"])
        self.assertEqual("Found two unresolved risks.", result["summary"])
        self.assertEqual(["runtime mismatch", "missing delegate tool"], result["data"]["risks"])
        self.assertEqual(
            {
                "tool_results": [
                    {
                        "tool_name": "search_documents",
                        "summary": "runtime clamp pending",
                        "success": True,
                    }
                ],
                "constraints": ["Keep the answer brief"],
                "notes": "Focus on unresolved items only.",
            },
            result["context"],
        )
        self.assertEqual("background", result["worker"]["profile_name"])
        self.assertEqual("gpt-4o-mini", result["worker"]["model"])
        self.assertTrue(fake_llm.closed)
        self.assertIn("Summarize unresolved risks", fake_llm.messages[1]["content"])
        self.assertIn("allowed_context_keys", fake_llm.messages[1]["content"])

    async def test_runner_rejects_non_json_response_for_json_expected_output(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
            }
        )
        runner = DelegatedTaskRunner(
            config_getter=lambda: normalized,
            llm_factory=lambda execution_spec: InvalidDelegatedLLM(),
        )

        with self.assertRaisesRegex(ValueError, "Delegated task must return a JSON object."):
            await runner.execute(
                task="Summarize unresolved risks",
                expected_output="json",
            )
