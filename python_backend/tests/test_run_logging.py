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
from core.user import Session, UserManager
from runtime.events import RunEvent
from runtime.logs import append_run_event
from tools.base import ToolRegistry


class SuccessfulLLM:
    async def stream(self, _messages, _tools):
        yield {
            "choices": [
                {
                    "delta": {
                        "content": "done",
                    }
                }
            ]
        }


class RetryOnceLLM:
    def __init__(self) -> None:
        self.calls = 0

    async def stream(self, _messages, _tools):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("temporary failure")

        yield {
            "choices": [
                {
                    "delta": {
                        "content": "recovered",
                    }
                }
            ]
        }


class RunLoggingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.frontend_messages = []
        self.user_manager = UserManager()

        async def send_callback(message):
            self.frontend_messages.append(message)

        await self.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_agent_run_emits_run_events_and_persists_structured_log(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-1")
        await self.user_manager.bind_session_to_connection("session-1", "conn-1")

        agent = Agent(SuccessfulLLM(), ToolRegistry(), self.user_manager)
        await agent.run("hello", session)

        run_events = [message for message in self.frontend_messages if message.get("type") == "run_event"]
        self.assertGreaterEqual(len(run_events), 2)
        self.assertEqual("run_started", run_events[0]["event"]["event_type"])
        self.assertEqual("run_completed", run_events[-1]["event"]["event_type"])

        log_path = Path(self.temp_dir.name) / ".agent" / "logs" / "session-1.jsonl"
        self.assertTrue(log_path.exists())

        log_entries = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual("run_started", log_entries[0]["event_type"])
        self.assertEqual("run_completed", log_entries[-1]["event_type"])

        session_path = Path(self.temp_dir.name) / ".agent" / "sessions" / "session-1.jsonl"
        self.assertTrue(session_path.exists())

    async def test_retry_attempts_are_persisted_in_run_log(self) -> None:
        session = Session("session-2", self.temp_dir.name)
        await self.user_manager.bind_session_to_connection("session-2", "conn-1")

        agent = Agent(RetryOnceLLM(), ToolRegistry(), self.user_manager)
        await agent.run("retry", session)

        log_path = Path(self.temp_dir.name) / ".agent" / "logs" / "session-2.jsonl"
        self.assertTrue(log_path.exists())

        log_entries = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertTrue(any(entry["event_type"] == "retry_scheduled" for entry in log_entries))
        self.assertTrue(any(entry["event_type"] == "run_completed" for entry in log_entries))

    async def test_session_rejects_path_traversal_session_ids(self) -> None:
        with self.assertRaises(ValueError):
            Session("../escape", self.temp_dir.name)

    async def test_run_logging_rejects_path_traversal_session_ids(self) -> None:
        with self.assertRaises(ValueError):
            append_run_event(
                self.temp_dir.name,
                "../escape",
                RunEvent(
                    event_type="run_started",
                    session_id="session-1",
                    run_id="run-1",
                    payload={},
                ),
            )


if __name__ == "__main__":
    unittest.main()
