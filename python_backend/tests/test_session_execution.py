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
        self.original_runtime_state = backend_main.runtime_state
        self.original_run_agent_task = backend_main.run_agent_task
        self.original_create_llm = backend_main.create_llm

        backend_main.user_manager = UserManager()
        backend_main.runtime_state = backend_main.BackendRuntimeState()
        backend_main.runtime_state.current_llm = object()
        backend_main.runtime_state.current_config = None
        backend_main.runtime_state.default_workspace = self.temp_dir.name
        backend_main.runtime_state.active_agents = {
            "session-a": self.agent_a,
            "session-b": self.agent_b,
        }
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
        if backend_main.runtime_state.pending_tasks:
            await asyncio.gather(*backend_main.runtime_state.pending_tasks, return_exceptions=True)

        backend_main.user_manager = self.original_user_manager
        backend_main.runtime_state = self.original_runtime_state
        backend_main.run_agent_task = self.original_run_agent_task
        backend_main.create_llm = self.original_create_llm
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
        self.assertEqual(1, len(backend_main.runtime_state.pending_tasks))
        self.assertTrue(self.agent_a.interrupted)
        self.assertFalse(self.agent_b.interrupted)

    async def test_rejects_concurrent_same_session_messages_atomically(self) -> None:
        original_get_or_create_agent = backend_main.get_or_create_agent
        first_call_started = asyncio.Event()
        allow_first_call_to_continue = asyncio.Event()

        async def delayed_get_or_create_agent(session_id):
            first_call_started.set()
            await allow_first_call_to_continue.wait()
            return await original_get_or_create_agent(session_id)

        backend_main.get_or_create_agent = delayed_get_or_create_agent

        try:
            payload_a = {
                "session_id": "session-a",
                "content": "alpha",
                "workspace_path": self.temp_dir.name,
            }
            payload_b = {
                "session_id": "session-a",
                "content": "beta",
                "workspace_path": self.temp_dir.name,
            }

            first_request = asyncio.create_task(
                backend_main.handle_user_message(payload_a, self.send_callback, "conn-a")
            )
            await asyncio.wait_for(first_call_started.wait(), timeout=1)

            await backend_main.handle_user_message(payload_b, self.send_callback, "conn-b")
            allow_first_call_to_continue.set()
            await asyncio.wait_for(first_request, timeout=1)
            await asyncio.sleep(0)

            self.assertEqual(1, len(self.run_invocations))
            self.assertTrue(
                any(
                    message.get("type") == "error"
                    and "active run" in message.get("error", "")
                    for message in self.messages
                )
            )
        finally:
            backend_main.get_or_create_agent = original_get_or_create_agent

    async def test_connection_workspace_fallback_is_isolated(self) -> None:
        workspace_a = Path(self.temp_dir.name) / "workspace-a"
        workspace_b = Path(self.temp_dir.name) / "workspace-b"
        workspace_a.mkdir()
        workspace_b.mkdir()

        await backend_main.handle_message(
            None,
            {"type": "set_workspace", "workspace_path": str(workspace_a)},
            self.send_callback,
            "conn-a",
        )
        await backend_main.handle_message(
            None,
            {"type": "set_workspace", "workspace_path": str(workspace_b)},
            self.send_callback,
            "conn-b",
        )

        await backend_main.handle_user_message(
            {
                "session_id": "session-a",
                "content": "alpha",
            },
            self.send_callback,
            "conn-a",
        )
        await backend_main.handle_user_message(
            {
                "session_id": "session-b",
                "content": "beta",
            },
            self.send_callback,
            "conn-b",
        )
        await asyncio.sleep(0)

        session_a = backend_main.user_manager.get_session("session-a")
        session_b = backend_main.user_manager.get_session("session-b")
        self.assertEqual(str(workspace_a.resolve()), session_a.workspace_path)
        self.assertEqual(str(workspace_b.resolve()), session_b.workspace_path)

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

        self.assertEqual(0, len(backend_main.runtime_state.pending_tasks))
        self.assertEqual({}, backend_main.runtime_state.active_session_tasks)
        self.assertEqual({}, backend_main.runtime_state.task_connections)
        self.assertEqual({}, backend_main.runtime_state.task_sessions)
        self.assertEqual({}, backend_main.runtime_state.active_agents)
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
