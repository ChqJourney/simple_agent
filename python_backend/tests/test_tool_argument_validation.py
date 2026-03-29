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
from tools.base import BaseTool, ToolRegistry, ToolResult
from tools.delegate_task import DelegateTaskTool
from tools.todo_task import TodoTaskTool


class RequiredTextTool(BaseTool):
    name = "required_text_tool"
    description = "Tool requiring a text argument."
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
        },
        "required": ["text"],
    }

    def __init__(self) -> None:
        self.calls = 0

    async def execute(self, text: str, tool_call_id: str = "", **kwargs):
        self.calls += 1
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={"text": text},
        )


class ToolCallThenDoneLLM:
    def __init__(self, tool_name: str, arguments: dict) -> None:
        self.tool_name = tool_name
        self.arguments = arguments
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
                                    "id": "tool-1",
                                    "function": {
                                        "name": self.tool_name,
                                        "arguments": json.dumps(self.arguments),
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


class FakeDelegatedTaskExecutor:
    async def execute(self, *, task: str, expected_output: str = "text", context=None):
        return {
            "event": "delegated_task",
            "summary": task,
            "data": context,
            "expected_output": expected_output,
            "worker": {
                "profile_name": "background",
                "provider": "openai",
                "model": "gpt-4o-mini",
            },
        }


class ToolArgumentValidationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.frontend_messages = []
        self.user_manager = UserManager()

        async def send_callback(message):
            self.frontend_messages.append(message)

        await self.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_agent_rejects_missing_required_argument_before_tool_execution(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-missing-arg")
        await self.user_manager.bind_session_to_connection("session-missing-arg", "conn-1")

        tool = RequiredTextTool()
        registry = ToolRegistry()
        registry.register(tool)
        agent = Agent(
            ToolCallThenDoneLLM(tool_name="required_text_tool", arguments={}),
            registry,
            self.user_manager,
        )

        await agent.run("trigger required arg validation", session)

        self.assertEqual(0, tool.calls)
        self.assertTrue(
            any(
                message.get("type") == "tool_result"
                and message.get("tool_name") == "required_text_tool"
                and not message.get("success")
                and "Missing required argument" in str(message.get("error", ""))
                for message in self.frontend_messages
            )
        )

    async def test_agent_rejects_invalid_enum_argument(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-invalid-enum")
        await self.user_manager.bind_session_to_connection("session-invalid-enum", "conn-1")

        registry = ToolRegistry()
        registry.register(TodoTaskTool())
        agent = Agent(
            ToolCallThenDoneLLM(tool_name="todo_task", arguments={"action": "ship_now"}),
            registry,
            self.user_manager,
        )

        await agent.run("trigger enum validation", session)

        self.assertTrue(
            any(
                message.get("type") == "tool_result"
                and message.get("tool_name") == "todo_task"
                and not message.get("success")
                and "Invalid value" in str(message.get("error", ""))
                for message in self.frontend_messages
            )
        )

    async def test_agent_rejects_unexpected_argument_when_additional_properties_are_disallowed(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-unexpected-arg")
        await self.user_manager.bind_session_to_connection("session-unexpected-arg", "conn-1")

        registry = ToolRegistry()
        registry.register(DelegateTaskTool(FakeDelegatedTaskExecutor()))
        agent = Agent(
            ToolCallThenDoneLLM(
                tool_name="delegate_task",
                arguments={
                    "task": "Summarize risks",
                    "unexpected": "value",
                },
            ),
            registry,
            self.user_manager,
        )

        await agent.run("trigger additionalProperties validation", session)

        self.assertTrue(
            any(
                message.get("type") == "tool_result"
                and message.get("tool_name") == "delegate_task"
                and not message.get("success")
                and "Unexpected argument(s): unexpected" in str(message.get("error", ""))
                for message in self.frontend_messages
            )
        )


if __name__ == "__main__":
    unittest.main()
