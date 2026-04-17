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


class ClosableLLM:
    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class BackgroundCompactionAgent:
    def __init__(self) -> None:
        self.calls = 0
        self.blocker = asyncio.Event()

    async def run_background_compaction(self, session, trigger_run_id) -> None:
        self.calls += 1
        await self.blocker.wait()


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
        default_scenario_key = backend_main._scenario_cache_key(
            backend_main.get_scenario_spec("default"),
            reference_library_signature=backend_main._build_reference_library_context(
                backend_main.runtime_state.current_config
            )[2],
        )
        setattr(self.agent_a, "_scenario_cache_key", default_scenario_key)
        setattr(self.agent_b, "_scenario_cache_key", default_scenario_key)
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

    async def test_completed_task_releases_active_agent_and_closes_agent_llm(self) -> None:
        closable_llm = ClosableLLM()
        self.agent_a.llm = closable_llm

        await backend_main.handle_user_message(
            {
                "session_id": "session-a",
                "content": "alpha",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-a",
        )
        await asyncio.sleep(0)

        self.assertIn("session-a", backend_main.runtime_state.active_agents)

        self.blocker.set()
        if backend_main.runtime_state.pending_tasks:
            await asyncio.gather(*backend_main.runtime_state.pending_tasks, return_exceptions=True)
        await asyncio.sleep(0)

        self.assertNotIn("session-a", backend_main.runtime_state.active_agents)
        self.assertTrue(closable_llm.closed)

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

    async def test_rejects_existing_session_from_different_workspace(self) -> None:
        workspace_a = Path(self.temp_dir.name) / "workspace-a"
        workspace_b = Path(self.temp_dir.name) / "workspace-b"
        workspace_a.mkdir()
        workspace_b.mkdir()

        await backend_main.user_manager.create_session(str(workspace_a), "shared-session")
        backend_main.runtime_state.connection_workspaces["conn-b"] = str(workspace_b.resolve())

        await backend_main.handle_user_message(
            {
                "session_id": "shared-session",
                "content": "beta",
            },
            self.send_callback,
            "conn-b",
        )

        self.assertEqual([], self.run_invocations)
        self.assertIsNone(
            backend_main.runtime_state.active_session_tasks.get("shared-session")
        )
        self.assertTrue(
            any(
                message.get("type") == "error"
                and message.get("session_id") == "shared-session"
                and "different workspace" in message.get("error", "")
                for message in self.messages
            )
        )

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
        config_updated = next(message for message in self.messages if message.get("type") == "config_updated")
        self.assertEqual("openai", config_updated["provider"])
        self.assertEqual("gpt-4o-mini", config_updated["model"])
        self.assertEqual(
            {
                "enabled": False,
                "installed": False,
                "status": "unavailable",
                "version": None,
                "engine": None,
                "api_version": None,
                "root_dir": None,
            },
            config_updated["ocr"],
        )

    async def test_background_compaction_task_is_deduplicated_per_session(self) -> None:
        agent = BackgroundCompactionAgent()
        session = await backend_main.user_manager.create_session(self.temp_dir.name, "session-bg")
        await backend_main.user_manager.bind_session_to_connection("session-bg", "conn-a")

        await backend_main._schedule_background_compaction_task(agent, session, "run-1")
        await backend_main._schedule_background_compaction_task(agent, session, "run-1")
        await asyncio.sleep(0)

        self.assertEqual(1, agent.calls)
        self.assertEqual(1, len(backend_main.runtime_state.active_session_compaction_tasks))

        agent.blocker.set()
        if backend_main.runtime_state.pending_tasks:
            await asyncio.gather(*backend_main.runtime_state.pending_tasks, return_exceptions=True)
        await asyncio.sleep(0)

        self.assertEqual({}, backend_main.runtime_state.active_session_compaction_tasks)

    async def test_interrupt_cancels_background_compaction_for_session(self) -> None:
        agent = BackgroundCompactionAgent()
        session = await backend_main.user_manager.create_session(self.temp_dir.name, "session-bg")
        await backend_main.user_manager.bind_session_to_connection("session-bg", "conn-a")

        await backend_main._schedule_background_compaction_task(agent, session, "run-1")
        await asyncio.sleep(0)

        self.assertIn("session-bg", backend_main.runtime_state.active_session_compaction_tasks)

        await backend_main.handle_interrupt({"session_id": "session-bg"})
        await asyncio.sleep(0)

        self.assertEqual({}, backend_main.runtime_state.active_session_compaction_tasks)

    async def test_interrupt_cancels_active_run_task_for_session(self) -> None:
        blocker = asyncio.Event()

        async def pending_run() -> None:
            await blocker.wait()

        task = asyncio.create_task(pending_run())
        backend_main.runtime_state.pending_tasks.add(task)
        backend_main.runtime_state.active_session_tasks["session-a"] = task
        backend_main.runtime_state.task_connections[task] = "conn-a"
        backend_main.runtime_state.task_sessions[task] = "session-a"

        await backend_main.handle_interrupt({"session_id": "session-a"})
        await asyncio.sleep(0)

        self.assertTrue(self.agent_a.interrupted)
        self.assertTrue(task.cancelled())

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

    async def test_update_session_scenario_rejects_non_empty_session(self) -> None:
        session = await backend_main.user_manager.create_session(self.temp_dir.name, "session-a")
        await session.add_message_async(Message(role="user", content="existing"))

        await backend_main.handle_update_session_scenario(
            {
                "session_id": "session-a",
                "scenario_id": "standard_qa",
                "scenario_version": 1,
                "scenario_label": "Standard QA",
            },
            self.send_callback,
            "conn-a",
        )

        self.assertEqual("default", session.scenario_id)
        self.assertEqual(1, session.scenario_version)
        self.assertIsNone(session.scenario_label)
        self.assertTrue(
            any(
                message.get("type") == "error"
                and message.get("session_id") == "session-a"
                and "non-empty session" in message.get("error", "")
                for message in self.messages
            )
        )
        self.assertFalse(
            any(message.get("type") == "session_scenario_updated" for message in self.messages)
        )

    async def test_create_session_rejects_existing_non_empty_session(self) -> None:
        session = await backend_main.user_manager.create_session(self.temp_dir.name, "session-a")
        await session.add_message_async(Message(role="user", content="existing"))

        await backend_main.handle_create_session(
            {
                "session_id": "session-a",
                "workspace_path": self.temp_dir.name,
                "scenario_id": "checklist_evaluation",
                "scenario_version": 1,
                "scenario_label": "Checklist Evaluation",
            },
            self.send_callback,
            "conn-a",
        )

        self.assertEqual("default", session.scenario_id)
        self.assertEqual(1, session.scenario_version)
        self.assertIsNone(session.scenario_label)
        self.assertTrue(
            any(
                message.get("type") == "error"
                and message.get("session_id") == "session-a"
                and "non-empty session" in message.get("error", "")
                for message in self.messages
            )
        )
        self.assertFalse(
            any(message.get("type") == "session_created" for message in self.messages)
        )

    async def test_get_or_create_agent_rebuilds_cached_agent_when_scenario_changes(self) -> None:
        first_llm = ClosableLLM()
        second_llm = ClosableLLM()
        llm_instances = iter([first_llm, second_llm])
        backend_main.create_llm_for_profile = lambda profile, runtime_policy=None: next(llm_instances)
        backend_main.runtime_state.active_agents.pop("session-a", None)
        execution_spec = backend_main.build_execution_spec(
            backend_main.runtime_state.current_config,
            "conversation",
        )

        first_agent = await backend_main.get_or_create_agent(
            "session-a",
            execution_spec,
            backend_main.get_scenario_spec("default"),
        )
        second_agent = await backend_main.get_or_create_agent(
            "session-a",
            execution_spec,
            backend_main.get_scenario_spec("standard_qa"),
        )

        self.assertIsNotNone(first_agent)
        self.assertIsNotNone(second_agent)
        self.assertIsNot(first_agent, second_agent)
        self.assertTrue(first_llm.closed)
        self.assertFalse(second_llm.closed)
        self.assertEqual(
            "standard_qa",
            getattr(second_agent, "_scenario_cache_key")[0],
        )

    async def test_get_or_create_agent_rebuilds_cached_agent_when_reference_library_changes(self) -> None:
        first_llm = ClosableLLM()
        second_llm = ClosableLLM()
        llm_instances = iter([first_llm, second_llm])
        backend_main.create_llm_for_profile = lambda profile, runtime_policy=None: next(llm_instances)
        backend_main.runtime_state.active_agents.pop("session-a", None)
        first_root = Path(self.temp_dir.name) / "reference-a"
        second_root = Path(self.temp_dir.name) / "reference-b"
        first_root.mkdir()
        second_root.mkdir()
        backend_main.runtime_state.current_config["reference_library"] = {
            "roots": [
                {
                    "id": "std-a",
                    "label": "Standards A",
                    "path": str(first_root),
                    "enabled": True,
                    "kinds": ["standard"],
                }
            ]
        }
        execution_spec = backend_main.build_execution_spec(
            backend_main.runtime_state.current_config,
            "conversation",
        )

        first_agent = await backend_main.get_or_create_agent(
            "session-a",
            execution_spec,
            backend_main.get_scenario_spec("standard_qa"),
        )

        backend_main.runtime_state.current_config["reference_library"] = {
            "roots": [
                {
                    "id": "std-b",
                    "label": "Standards B",
                    "path": str(second_root),
                    "enabled": True,
                    "kinds": ["standard"],
                }
            ]
        }
        second_agent = await backend_main.get_or_create_agent(
            "session-a",
            execution_spec,
            backend_main.get_scenario_spec("standard_qa"),
        )

        self.assertIsNotNone(first_agent)
        self.assertIsNotNone(second_agent)
        self.assertIsNot(first_agent, second_agent)
        self.assertTrue(first_llm.closed)
        self.assertFalse(second_llm.closed)
        self.assertEqual([str(second_root)], second_agent.reference_library_roots)
        self.assertIn(str(second_root), second_agent.scenario_system_prompt)
        self.assertIn("absolute_path", second_agent.scenario_system_prompt)

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
                "session_id": "session-a",
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
                "session_id": "session-a",
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

    async def test_handle_message_ignores_tool_confirm_for_mismatched_session(self) -> None:
        await backend_main.user_manager.bind_session_to_connection("session-a", "conn-a")

        confirmation_task = asyncio.create_task(
            backend_main.user_manager.request_tool_confirmation(
                session_id="session-a",
                tool_call_id="tool-3",
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
                "session_id": "session-b",
                "tool_call_id": "tool-3",
                "decision": "approve_once",
                "scope": "session",
                "approved": True,
            },
            self.send_callback,
            "conn-a",
        )

        self.assertFalse(confirmation_task.done())

        await backend_main.handle_message(
            None,
            {
                "type": "tool_confirm",
                "session_id": "session-a",
                "tool_call_id": "tool-3",
                "decision": "approve_once",
                "scope": "session",
                "approved": True,
            },
            self.send_callback,
            "conn-a",
        )

        result = await asyncio.wait_for(confirmation_task, timeout=1)
        self.assertEqual("approve_once", result["decision"])

    async def test_existing_untitled_session_generates_title_on_next_text_message(self) -> None:
        title_llm = TitleCapableLLM("Friendly greeting")
        backend_main.runtime_state.current_llm = title_llm
        self.agent_a.llm = title_llm

        session = await backend_main.user_manager.create_session(self.temp_dir.name, "session-a")
        await session.add_message_async(Message(role="user", content="old message"))

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

    async def test_lifespan_shutdown_cancels_pending_tasks_and_closes_llms(self) -> None:
        blocker = asyncio.Event()

        async def wait_forever() -> None:
            await blocker.wait()

        current_llm = ClosableLLM()
        agent_llm = ClosableLLM()
        pending_task = asyncio.create_task(wait_forever())

        self.agent_a.llm = agent_llm
        backend_main.runtime_state.current_llm = current_llm
        backend_main.runtime_state.pending_tasks = {pending_task}
        backend_main.runtime_state.task_sessions = {pending_task: "session-a"}
        backend_main.runtime_state.active_session_tasks = {"session-a": pending_task}
        backend_main.runtime_state.active_agents = {"session-a": self.agent_a}
        pending_task.add_done_callback(backend_main._forget_task)

        try:
            async with backend_main.lifespan(None):
                pass

            await asyncio.sleep(0)

            self.assertTrue(self.agent_a.interrupted)
            self.assertTrue(pending_task.cancelled())
            self.assertTrue(current_llm.closed)
            self.assertTrue(agent_llm.closed)
        finally:
            if not pending_task.done():
                pending_task.cancel()
                await asyncio.gather(pending_task, return_exceptions=True)
            backend_main.runtime_state.pending_tasks.clear()
            backend_main.runtime_state.task_sessions.clear()
            backend_main.runtime_state.active_session_tasks.clear()


if __name__ == "__main__":
    unittest.main()
