import asyncio
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main as backend_main
from core.user import Message, UserManager
from runtime.contracts import LockedModelRef


class FakeAgent:
    def __init__(self) -> None:
        self.interrupted = False
        self.llm = None

    def reset_interrupt(self) -> None:
        return None

    def interrupt(self) -> None:
        self.interrupted = True


class TitleCapableLLM:
    def __init__(self, title: str) -> None:
        self.title = title
        self.complete_calls = 0

    async def complete(self, messages, tools=None):
        self.complete_calls += 1
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": self.title,
                    }
                }
            ]
        }


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
        self.original_create_llm_for_profile = backend_main.create_llm_for_profile

        backend_main.user_manager = UserManager()
        backend_main.runtime_state = backend_main.BackendRuntimeState()
        backend_main.runtime_state.current_llm = object()
        backend_main.runtime_state.current_config = {
            "provider": "openai",
            "model": "gpt-4o",
            "api_key": "test-key",
            "base_url": "https://api.openai.com/v1",
            "enable_reasoning": False,
            "profiles": {
                "primary": {
                    "provider": "openai",
                    "model": "gpt-4o",
                    "api_key": "test-key",
                    "base_url": "https://api.openai.com/v1",
                    "enable_reasoning": False,
                    "profile_name": "primary",
                },
            },
            "runtime": {},
        }
        backend_main.runtime_state.default_workspace = self.temp_dir.name
        backend_main.runtime_state.active_agents = {
            "session-a": self.agent_a,
            "session-b": self.agent_b,
        }
        backend_main.create_llm = lambda config: {"provider": config["provider"], "model": config["model"]}
        backend_main.create_llm_for_profile = (
            lambda profile, runtime_policy=None: backend_main.runtime_state.current_llm
        )

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
        backend_main.create_llm_for_profile = self.original_create_llm_for_profile
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

        async def delayed_get_or_create_agent(session_id, *args, **kwargs):
            first_call_started.set()
            await allow_first_call_to_continue.wait()
            return await original_get_or_create_agent(session_id, *args, **kwargs)

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

    async def test_handle_message_routes_structured_question_responses(self) -> None:
        await backend_main.user_manager.bind_session_to_connection("session-a", "conn-a")

        response_task = asyncio.create_task(
            backend_main.user_manager.request_question_response(
                session_id="session-a",
                tool_call_id="question-1",
                tool_name="ask_question",
                question="Continue deployment?",
                details="Traffic is low right now.",
                options=["continue", "wait"],
            )
        )

        await asyncio.sleep(0)

        await backend_main.handle_message(
            None,
            {
                "type": "question_response",
                "tool_call_id": "question-1",
                "answer": "continue",
                "action": "submit",
            },
            self.send_callback,
            "conn-a",
        )

        result = await asyncio.wait_for(response_task, timeout=1)
        self.assertEqual("continue", result["answer"])
        self.assertEqual("submit", result["action"])

    async def test_handle_message_updates_session_execution_mode(self) -> None:
        await backend_main.handle_message(
            None,
            {
                "type": "set_execution_mode",
                "session_id": "session-a",
                "execution_mode": "free",
            },
            self.send_callback,
            "conn-a",
        )

        self.assertEqual(
            "free",
            backend_main.user_manager.get_session_execution_mode("session-a"),
        )
        self.assertTrue(
            any(
                message.get("type") == "execution_mode_updated"
                and message.get("session_id") == "session-a"
                and message.get("execution_mode") == "free"
                for message in self.messages
            )
        )

    async def test_handle_message_falls_back_to_session_scope_for_invalid_tool_confirm_scope(self) -> None:
        await backend_main.user_manager.bind_session_to_connection("session-a", "conn-a")

        confirmation_task = asyncio.create_task(
            backend_main.user_manager.request_tool_confirmation(
                session_id="session-a",
                tool_call_id="tool-1",
                tool_name="shell_execute",
                workspace_path=self.temp_dir.name,
                arguments={"command": "echo hello"},
            )
        )
        await asyncio.sleep(0)

        await backend_main.handle_message(
            None,
            {
                "type": "tool_confirm",
                "tool_call_id": "tool-1",
                "decision": "approve_always",
                "scope": ["workspace"],
                "approved": True,
            },
            self.send_callback,
            "conn-a",
        )

        result = await asyncio.wait_for(confirmation_task, timeout=1)
        self.assertEqual("approve_always", result["decision"])
        self.assertEqual("session", result["scope"])

    async def test_handle_message_rejects_invalid_tool_confirm_decision_payload(self) -> None:
        await backend_main.user_manager.bind_session_to_connection("session-a", "conn-a")

        confirmation_task = asyncio.create_task(
            backend_main.user_manager.request_tool_confirmation(
                session_id="session-a",
                tool_call_id="tool-2",
                tool_name="shell_execute",
                workspace_path=self.temp_dir.name,
                arguments={"command": "echo hello"},
            )
        )
        await asyncio.sleep(0)

        await backend_main.handle_message(
            None,
            {
                "type": "tool_confirm",
                "tool_call_id": "tool-2",
                "decision": {"value": "approve_once"},
                "scope": "workspace",
                "approved": "true",
            },
            self.send_callback,
            "conn-a",
        )

        result = await asyncio.wait_for(confirmation_task, timeout=1)
        self.assertEqual("reject", result["decision"])
        self.assertEqual("workspace", result["scope"])

    async def test_existing_untitled_session_generates_title_on_next_text_message(self) -> None:
        title_llm = TitleCapableLLM("Friendly greeting")
        backend_main.runtime_state.current_llm = title_llm
        self.agent_a.llm = title_llm

        session = await backend_main.user_manager.create_session(self.temp_dir.name, "session-a")
        session.add_message(Message(role="user", content="old message"))

        await backend_main.handle_user_message(
            {
                "session_id": "session-a",
                "content": "hello",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-a",
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        self.assertEqual("Friendly greeting", session.title)
        self.assertEqual(1, title_llm.complete_calls)
        self.assertTrue(
            any(
                message.get("type") == "session_title_updated"
                and message.get("title") == "Friendly greeting"
                for message in self.messages
            )
        )

    async def test_releases_reserved_session_when_locked_model_rejects_request(self) -> None:
        session = await backend_main.user_manager.create_session(self.temp_dir.name, "session-a")
        session.locked_model = LockedModelRef(
            profile_name="primary",
            provider="openai",
            model="gpt-4o-mini",
        )

        await backend_main.handle_user_message(
            {
                "session_id": "session-a",
                "content": "hello",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-a",
        )

        self.assertNotIn("session-a", backend_main.runtime_state.active_session_tasks)
        self.assertTrue(
            any(
                message.get("type") == "error"
                and "locked to" in message.get("error", "")
                for message in self.messages
            )
        )


if __name__ == "__main__":
    unittest.main()
