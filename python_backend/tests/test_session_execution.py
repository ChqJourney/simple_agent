import asyncio
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main as backend_main
from core.user import UserManager


class FakeAgent:
    def __init__(self) -> None:
        self.interrupted = False

    def reset_interrupt(self) -> None:
        return None

    def interrupt(self) -> None:
        self.interrupted = True


class SessionExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.messages = []
        self.run_invocations = []
        self.blocker = asyncio.Event()
        self.agent_a = FakeAgent()
        self.agent_b = FakeAgent()

        self.original_user_manager = backend_main.user_manager
        self.original_current_llm = backend_main.current_llm
        self.original_current_config = backend_main.current_config
        self.original_run_agent_task = backend_main.run_agent_task
        self.original_create_llm = backend_main.create_llm
        self.original_pending_tasks = backend_main.pending_tasks
        self.original_active_agents = backend_main.active_agents
        self.original_active_session_tasks = backend_main.active_session_tasks
        self.original_task_connections = backend_main.task_connections
        self.original_task_sessions = backend_main.task_sessions

        backend_main.user_manager = UserManager()
        backend_main.current_llm = object()
        backend_main.current_config = None
        backend_main.pending_tasks = set()
        backend_main.active_agents = {
            "session-a": self.agent_a,
            "session-b": self.agent_b,
        }
        backend_main.active_session_tasks = {}
        backend_main.task_connections = {}
        backend_main.task_sessions = {}
        backend_main.create_llm = lambda config: {"provider": config["provider"], "model": config["model"]}

        async def fake_run_agent_task(agent, content, session, send_callback):
            self.run_invocations.append((session.session_id, content))
            await self.blocker.wait()

        backend_main.run_agent_task = fake_run_agent_task

        async def send_callback(message):
            self.messages.append(message)

        self.send_callback = send_callback
        await backend_main.user_manager.register_connection("conn-a", send_callback)
        await backend_main.user_manager.register_connection("conn-b", send_callback)

    async def asyncTearDown(self) -> None:
        self.blocker.set()
        if backend_main.pending_tasks:
            await asyncio.gather(*backend_main.pending_tasks, return_exceptions=True)

        backend_main.user_manager = self.original_user_manager
        backend_main.current_llm = self.original_current_llm
        backend_main.current_config = self.original_current_config
        backend_main.run_agent_task = self.original_run_agent_task
        backend_main.create_llm = self.original_create_llm
        backend_main.pending_tasks = self.original_pending_tasks
        backend_main.active_agents = self.original_active_agents
        backend_main.active_session_tasks = self.original_active_session_tasks
        backend_main.task_connections = self.original_task_connections
        backend_main.task_sessions = self.original_task_sessions
        self.temp_dir.cleanup()

    async def test_rejects_second_message_while_session_run_is_active(self) -> None:
        payload = {
            "session_id": "session-a",
            "content": "first",
            "workspace_path": self.temp_dir.name,
        }

        await backend_main.handle_user_message(payload, self.send_callback, "conn-a")
        await asyncio.sleep(0)

        await backend_main.handle_user_message(
            {**payload, "content": "second"},
            self.send_callback,
            "conn-a",
        )
        await asyncio.sleep(0)

        self.assertEqual(
            [("session-a", "first")],
            self.run_invocations,
        )
        self.assertTrue(
            any(
                message.get("type") == "error"
                and "active run" in message.get("error", "")
                for message in self.messages
            )
        )

    async def test_cleanup_connection_tasks_only_cancels_owned_session_runs(self) -> None:
        await backend_main.handle_user_message(
            {
                "session_id": "session-a",
                "content": "alpha",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-a",
        )
        await backend_main.handle_user_message(
            {
                "session_id": "session-b",
                "content": "beta",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-b",
        )
        await asyncio.sleep(0)

        await backend_main.cleanup_connection_tasks("conn-a")
        await asyncio.sleep(0)

        self.assertEqual(2, len(self.run_invocations))
        self.assertEqual(1, len(backend_main.pending_tasks))
        self.assertTrue(self.agent_a.interrupted)
        self.assertFalse(self.agent_b.interrupted)

    async def test_handle_config_cancels_active_tasks_and_clears_task_registries(self) -> None:
        await backend_main.handle_user_message(
            {
                "session_id": "session-a",
                "content": "alpha",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-a",
        )
        await backend_main.handle_user_message(
            {
                "session_id": "session-b",
                "content": "beta",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-b",
        )
        await asyncio.sleep(0)

        await backend_main.handle_config(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "base_url": "https://api.openai.com/v1",
                "enable_reasoning": False,
            },
            self.send_callback,
        )
        await asyncio.sleep(0)

        self.assertEqual(0, len(backend_main.pending_tasks))
        self.assertEqual({}, backend_main.active_session_tasks)
        self.assertEqual({}, backend_main.task_connections)
        self.assertEqual({}, backend_main.task_sessions)
        self.assertEqual({}, backend_main.active_agents)
        self.assertTrue(self.agent_a.interrupted)
        self.assertTrue(self.agent_b.interrupted)
        self.assertIn(
            {
                "type": "config_updated",
                "provider": "openai",
                "model": "gpt-4o-mini",
            },
            self.messages,
        )


if __name__ == "__main__":
    unittest.main()
