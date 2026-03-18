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
from tools.base import BaseTool, ToolRegistry, ToolResult


class ConfirmEchoTool(BaseTool):
    name = "confirm_echo"
    description = "Echo input text after confirmation."
    require_confirmation = True
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
        },
        "required": ["text"],
    }

    async def execute(self, text: str, tool_call_id: str = "", **kwargs):
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={"echo": text},
        )


class ConfirmEchoLLM:
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
                                    "id": "confirm-1",
                                    "function": {
                                        "name": "confirm_echo",
                                        "arguments": json.dumps({"text": "approved"}),
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


class ExecutionModeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.frontend_messages = []
        self.user_manager = UserManager()

        async def send_callback(message):
            self.frontend_messages.append(message)

        await self.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def _wait_for_message(self, msg_type: str, timeout: float = 1.0):
        started = asyncio.get_running_loop().time()
        while asyncio.get_running_loop().time() - started < timeout:
            for message in self.frontend_messages:
                if message.get("type") == msg_type:
                    return message
            await asyncio.sleep(0.01)
        raise TimeoutError(f"did not receive message type={msg_type}")

    async def test_regular_mode_requires_confirmation_for_confirmable_tool(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-regular")
        await self.user_manager.bind_session_to_connection("session-regular", "conn-1")

        registry = ToolRegistry()
        registry.register(ConfirmEchoTool())
        agent = Agent(ConfirmEchoLLM(), registry, self.user_manager)

        run_task = asyncio.create_task(agent.run("run with regular mode", session))
        await self._wait_for_message("tool_confirm_request")

        await self.user_manager.handle_tool_confirmation(
            tool_call_id="confirm-1",
            decision="approve_once",
            scope="session",
        )
        await asyncio.wait_for(run_task, timeout=1)

        self.assertTrue(
            any(message.get("type") == "tool_confirm_request" for message in self.frontend_messages)
        )
        self.assertTrue(
            any(
                message.get("type") == "tool_result"
                and message.get("tool_name") == "confirm_echo"
                and message.get("success")
                for message in self.frontend_messages
            )
        )
        tool_messages = [
            message
            for message in session.messages
            if message.role == "tool" and message.name == "confirm_echo"
        ]
        self.assertTrue(tool_messages)
        persisted_payload = json.loads(tool_messages[-1].content or "{}")
        self.assertEqual("approved", persisted_payload["echo"])

    async def test_free_mode_skips_confirmation_for_confirmable_tool(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-free")
        await self.user_manager.bind_session_to_connection("session-free", "conn-1")
        self.user_manager.set_session_execution_mode("session-free", "free")

        registry = ToolRegistry()
        registry.register(ConfirmEchoTool())
        agent = Agent(ConfirmEchoLLM(), registry, self.user_manager)

        await asyncio.wait_for(agent.run("run with free mode", session), timeout=1)

        self.assertFalse(
            any(message.get("type") == "tool_confirm_request" for message in self.frontend_messages)
        )
        self.assertTrue(
            any(
                message.get("type") == "run_event"
                and message.get("event", {}).get("event_type") == "tool_confirmation_skipped"
                for message in self.frontend_messages
            )
        )
        self.assertTrue(
            any(
                message.get("type") == "tool_result"
                and message.get("tool_name") == "confirm_echo"
                and message.get("success")
                for message in self.frontend_messages
            )
        )


if __name__ == "__main__":
    unittest.main()
