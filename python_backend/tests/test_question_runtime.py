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
from tools.ask_question import AskQuestionTool
from tools.base import ToolRegistry


class AskQuestionLLM:
    def __init__(self) -> None:
        self.calls = 0
        self.message_snapshots = []

    async def stream(self, messages, _tools):
        self.calls += 1
        self.message_snapshots.append(messages)

        if self.calls == 1:
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "question-1",
                                    "function": {
                                        "name": "ask_question",
                                        "arguments": json.dumps(
                                            {
                                                "question": "Continue deployment?",
                                                "details": "Traffic is low right now.",
                                                "options": ["continue", "wait"],
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
                        "content": "Acknowledged",
                    }
                }
            ]
        }


class QuestionRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.frontend_messages = []
        self.user_manager = UserManager()

        async def send_callback(message):
            self.frontend_messages.append(message)

        await self.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_ask_question_waits_for_structured_response_and_resumes_run(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-1")
        await self.user_manager.bind_session_to_connection("session-1", "conn-1")

        registry = ToolRegistry()
        registry.register(AskQuestionTool())
        llm = AskQuestionLLM()
        agent = Agent(llm, registry, self.user_manager)

        run_task = asyncio.create_task(agent.run("hello", session))

        for _ in range(20):
            if any(message.get("type") == "question_request" for message in self.frontend_messages):
                break
            await asyncio.sleep(0.01)

        self.assertTrue(any(message.get("type") == "question_request" for message in self.frontend_messages))

        await self.user_manager.handle_question_response(
            tool_call_id="question-1",
            answer="continue",
            action="submit",
        )

        await asyncio.wait_for(run_task, timeout=1)

        question_request = next(
            message for message in self.frontend_messages if message.get("type") == "question_request"
        )
        self.assertEqual("Continue deployment?", question_request["question"])

        tool_result = next(
            message
            for message in self.frontend_messages
            if message.get("type") == "tool_result" and message.get("tool_name") == "ask_question"
        )
        self.assertEqual("question_response", tool_result["output"]["event"])
        self.assertEqual("continue", tool_result["output"]["answer"])
        self.assertEqual("submit", tool_result["output"]["action"])

        self.assertEqual(2, llm.calls)
        self.assertEqual("tool", llm.message_snapshots[1][-1]["role"])
        self.assertIn("continue", llm.message_snapshots[1][-1]["content"])


if __name__ == "__main__":
    unittest.main()
