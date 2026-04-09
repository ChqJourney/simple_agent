import asyncio
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


class PlainTextDelegatedLLM:
    def __init__(self, content: str) -> None:
        self.content = content
        self.closed = False

    async def complete(self, messages, tools=None):
        return {
            "choices": [
                {
                    "message": {
                        "content": self.content,
                    }
                }
            ]
        }

    async def aclose(self):
        self.closed = True


class JsonDelegatedLLM:
    def __init__(self, payload) -> None:
        self.payload = payload

    async def complete(self, messages, tools=None):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(self.payload, ensure_ascii=False),
                    }
                }
            ]
        }

    async def aclose(self):
        return None


class SlowCancelableDelegatedLLM:
    def __init__(self) -> None:
        self.started = False
        self.closed = False
        self._close_gate = asyncio.Event()

    async def complete(self, messages, tools=None):
        self.started = True
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            current_task = asyncio.current_task()
            if current_task is not None:
                current_task.uncancel()
            await self._close_gate.wait()
            raise

    async def aclose(self):
        self.closed = True
        self._close_gate.set()


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

    async def test_runner_closes_llm_when_cancelled_mid_request(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
            }
        )
        fake_llm = SlowCancelableDelegatedLLM()
        runner = DelegatedTaskRunner(
            config_getter=lambda: normalized,
            llm_factory=lambda execution_spec: fake_llm,
        )

        task = asyncio.create_task(
            runner.execute(
                task="Summarize unresolved risks",
                expected_output="text",
            )
        )

        while not fake_llm.started:
            await asyncio.sleep(0.01)

        task.cancel()
        started = asyncio.get_running_loop().time()
        while not task.done() and asyncio.get_running_loop().time() - started < 1:
            await asyncio.sleep(0.01)

        self.assertTrue(task.done())
        self.assertTrue(fake_llm.closed)
        with self.assertRaises(asyncio.CancelledError):
            await task

    async def test_runner_falls_back_to_plain_text_summary_when_text_output_is_expected(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
            }
        )
        fake_llm = PlainTextDelegatedLLM("Summarize the unresolved risks in one sentence.")
        runner = DelegatedTaskRunner(
            config_getter=lambda: normalized,
            llm_factory=lambda execution_spec: fake_llm,
        )

        result = await runner.execute(
            task="Summarize unresolved risks",
            expected_output="text",
            context={
                "messages": [
                    {"role": "user", "content": "  keep this  "},
                    {"role": "", "content": "drop missing role"},
                    {"role": "assistant", "content": "   "},
                ],
                "notes": "  Keep it brief.  ",
            },
        )

        self.assertEqual("Summarize the unresolved risks in one sentence.", result["summary"])
        self.assertIsNone(result["data"])
        self.assertEqual(
            {
                "messages": [{"role": "user", "content": "keep this"}],
                "notes": "Keep it brief.",
            },
            result["context"],
        )
        self.assertTrue(fake_llm.closed)

    async def test_runner_rejects_empty_delegated_responses(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
            }
        )
        runner = DelegatedTaskRunner(
            config_getter=lambda: normalized,
            llm_factory=lambda execution_spec: PlainTextDelegatedLLM("   "),
        )

        with self.assertRaisesRegex(ValueError, "empty response"):
            await runner.execute(
                task="Summarize unresolved risks",
                expected_output="text",
            )

    async def test_runner_rejects_json_without_summary(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
            }
        )
        runner = DelegatedTaskRunner(
            config_getter=lambda: normalized,
            llm_factory=lambda execution_spec: JsonDelegatedLLM({"data": {"risks": []}}),
        )

        with self.assertRaisesRegex(ValueError, "non-empty `summary`"):
            await runner.execute(
                task="Summarize unresolved risks",
                expected_output="json",
            )

    async def test_runner_rejects_json_without_data_field(self) -> None:
        normalized = normalize_runtime_config(
            {
                "provider": "openai",
                "model": "gpt-4o",
                "api_key": "test-key",
            }
        )
        runner = DelegatedTaskRunner(
            config_getter=lambda: normalized,
            llm_factory=lambda execution_spec: JsonDelegatedLLM({"summary": "Done"}),
        )

        with self.assertRaisesRegex(ValueError, "include a `data` field"):
            await runner.execute(
                task="Summarize unresolved risks",
                expected_output="json",
            )
