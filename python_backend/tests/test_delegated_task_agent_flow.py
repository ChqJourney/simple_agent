import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.agent import Agent
from core.user import UserManager
from tools.base import ToolRegistry
from tools.delegate_task import DelegateTaskTool


class FakeDelegatedTaskExecutor:
    async def execute(self, *, task: str, expected_output: str = "text", context=None):
        return {
            "event": "delegated_task",
            "summary": f"Background handled: {task}",
            "data": context or {},
            "expected_output": expected_output,
            "worker": {
                "profile_name": "background",
                "provider": "openai",
                "model": "gpt-4o-mini",
            },
        }


class DelegateTaskLLM:
    def __init__(self) -> None:
        self.calls = 0

    async def stream(self, _messages, _tools):
        self.calls += 1
        if self.calls == 1:
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "delegate-1",
                                    "function": {
                                        "name": "delegate_task",
                                        "arguments": json.dumps(
                                            {
                                                "task": "Summarize unresolved risks",
                                                "expected_output": "json",
                                                "context": {
                                                    "tool_results": ["runtime clamp pending"],
                                                },
                                            }
                                        ),
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
            return

        yield {
            "choices": [
                {
                    "delta": {
                        "content": "done",
                    }
                }
            ]
        }


class DelegatedTaskAgentFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.frontend_messages = []
        self.user_manager = UserManager()

        async def send_callback(message):
            self.frontend_messages.append(message)

        await self.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_delegate_task_emits_dedicated_run_events_and_structured_tool_result(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-delegate")
        await self.user_manager.bind_session_to_connection("session-delegate", "conn-1")

        registry = ToolRegistry()
        registry.register(DelegateTaskTool(FakeDelegatedTaskExecutor()))
        agent = Agent(DelegateTaskLLM(), registry, self.user_manager)

        await asyncio.wait_for(agent.run("Analyze risks", session), timeout=1)

        run_event_types = [
            message.get("event", {}).get("event_type")
            for message in self.frontend_messages
            if message.get("type") == "run_event"
        ]
        self.assertIn("delegated_task_started", run_event_types)
        self.assertIn("delegated_task_completed", run_event_types)

        delegated_completed = next(
            message["event"]
            for message in self.frontend_messages
            if message.get("type") == "run_event"
            and message.get("event", {}).get("event_type") == "delegated_task_completed"
        )
        self.assertEqual("openai", delegated_completed["payload"]["worker_provider"])
        self.assertEqual("gpt-4o-mini", delegated_completed["payload"]["worker_model"])

        tool_result = next(
            message
            for message in self.frontend_messages
            if message.get("type") == "tool_result" and message.get("tool_name") == "delegate_task"
        )
        self.assertTrue(tool_result["success"])
        self.assertEqual("delegated_task", tool_result["output"]["event"])
        self.assertEqual("Background handled: Summarize unresolved risks", tool_result["output"]["summary"])

        persisted_tool_messages = [
            message
            for message in session.messages
            if message.role == "tool" and message.name == "delegate_task"
        ]
        self.assertTrue(persisted_tool_messages)
        self.assertIn("gpt-4o-mini", persisted_tool_messages[-1].content or "")
