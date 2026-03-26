import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.agent import Agent
from core.user import Message, Session, UserManager
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


class UsageReportingLLM:
    def __init__(self) -> None:
        self.latest_usage = {
            "prompt_tokens": 4096,
            "completion_tokens": 256,
            "total_tokens": 4352,
            "context_length": 128000,
        }

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

    def get_latest_usage(self):
        return dict(self.latest_usage)


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

    async def test_run_completed_log_persists_usage_when_available(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-usage")
        await self.user_manager.bind_session_to_connection("session-usage", "conn-1")

        agent = Agent(UsageReportingLLM(), ToolRegistry(), self.user_manager)
        await agent.run("hello", session)

        log_path = Path(self.temp_dir.name) / ".agent" / "logs" / "session-usage.jsonl"
        log_entries = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

        completed_entry = next(entry for entry in log_entries if entry["event_type"] == "run_completed")
        self.assertEqual(4096, completed_entry["payload"]["usage"]["prompt_tokens"])
        self.assertEqual(128000, completed_entry["payload"]["usage"]["context_length"])

    async def test_logs_and_session_history_preserve_unicode_text(self) -> None:
        session = Session("session-unicode", self.temp_dir.name)
        session.add_message(Message(role="user", content="帮我计算125的3次方"))

        await append_run_event(
            self.temp_dir.name,
            "session-unicode",
            RunEvent(
                event_type="run_started",
                session_id="session-unicode",
                run_id="run-1",
                payload={"prompt": "帮我计算125的3次方"},
            ),
        )

        session_path = Path(self.temp_dir.name) / ".agent" / "sessions" / "session-unicode.jsonl"
        log_path = Path(self.temp_dir.name) / ".agent" / "logs" / "session-unicode.jsonl"

        session_raw = session_path.read_text(encoding="utf-8")
        log_raw = log_path.read_text(encoding="utf-8")

        self.assertIn("帮我计算125的3次方", session_raw)
        self.assertNotIn("\\u5e2e", session_raw)
        self.assertIn("帮我计算125的3次方", log_raw)
        self.assertNotIn("\\u5e2e", log_raw)

    async def test_session_rejects_path_traversal_session_ids(self) -> None:
        with self.assertRaises(ValueError):
            Session("../escape", self.temp_dir.name)

    async def test_run_logging_rejects_path_traversal_session_ids(self) -> None:
        with self.assertRaises(ValueError):
            await append_run_event(
                self.temp_dir.name,
                "../escape",
                RunEvent(
                    event_type="run_started",
                    session_id="session-1",
                    run_id="run-1",
                    payload={},
                ),
            )

    async def test_append_run_event_retries_transient_failures(self) -> None:
        event = RunEvent(
            event_type="run_started",
            session_id="session-retry",
            run_id="run-1",
            payload={},
        )
        log_path = Path(self.temp_dir.name) / ".agent" / "logs" / "session-retry.jsonl"
        original_open = Path.open
        attempts = {"count": 0}

        def flaky_open(path_obj, *args, **kwargs):
            if path_obj == log_path and attempts["count"] < 2:
                attempts["count"] += 1
                raise OSError("temporary write failure")
            return original_open(path_obj, *args, **kwargs)

        with patch("runtime.logs.Path.open", autospec=True, side_effect=flaky_open), patch(
            "runtime.logs.asyncio.sleep",
            autospec=True,
        ) as sleep_mock:
            await append_run_event(self.temp_dir.name, "session-retry", event)

        self.assertEqual(2, attempts["count"])
        self.assertEqual(2, sleep_mock.call_count)
        log_entries = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual(1, len(log_entries))
        self.assertEqual("run_started", log_entries[0]["event_type"])

    async def test_append_run_event_gives_up_without_raising_after_retries(self) -> None:
        event = RunEvent(
            event_type="run_started",
            session_id="session-failure",
            run_id="run-1",
            payload={},
        )
        log_path = Path(self.temp_dir.name) / ".agent" / "logs" / "session-failure.jsonl"

        with patch("runtime.logs.Path.open", autospec=True, side_effect=OSError("disk full")), patch(
            "runtime.logs.asyncio.sleep",
            autospec=True,
        ) as sleep_mock:
            await append_run_event(self.temp_dir.name, "session-failure", event)

        self.assertFalse(log_path.exists())
        self.assertEqual(2, sleep_mock.call_count)


if __name__ == "__main__":
    unittest.main()
