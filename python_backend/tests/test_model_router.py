import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main as backend_main
from core.user import Session, UserManager
from runtime.contracts import LockedModelRef
from runtime.router import resolve_background_profile, resolve_conversation_profile


class ModelRouterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.messages = []
        self.created_llm_configs = []
        self.created_agents = []

        self.original_user_manager = backend_main.user_manager
        self.original_runtime_state = backend_main.runtime_state
        self.original_run_agent_task = backend_main.run_agent_task
        self.original_run_session_title_task = backend_main.run_session_title_task
        self.original_create_llm = backend_main.create_llm
        self.original_create_llm_for_profile = backend_main.create_llm_for_profile
        self.original_agent_class = backend_main.Agent
        self.title_task_calls = []

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
                "secondary": {
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "api_key": "test-key",
                    "base_url": "https://api.openai.com/v1",
                    "enable_reasoning": False,
                    "profile_name": "secondary",
                },
            },
            "runtime": {
                "max_tool_rounds": 2,
                "max_retries": 5,
                "max_output_tokens": 256,
            },
        }
        backend_main.runtime_state.default_workspace = self.temp_dir.name

        async def fake_run_agent_task(_agent, _content, _session, _send_callback, attachments=None):
            return None

        async def fake_run_session_title_task(_session, llm, first_message, _send_callback):
            self.title_task_calls.append(
                {
                    "llm": llm,
                    "first_message": first_message,
                }
            )
            return None

        def fake_create_llm(config, runtime_policy=None):
            merged_config = {
                **config,
                **(runtime_policy or {}),
            }
            self.created_llm_configs.append(merged_config)
            class FakeLLM(dict):
                async def complete(self, _messages):
                    return {
                        "choices": [
                            {
                                "message": {
                                    "content": "Generated title",
                                }
                            }
                        ]
                    }

            return FakeLLM({
                "provider": merged_config["provider"],
                "model": merged_config["model"],
                "profile_name": merged_config.get("profile_name"),
                "max_output_tokens": merged_config.get("max_output_tokens"),
            })

        class CapturingAgent:
            def __init__(
                agent_self,
                llm,
                tool_registry,
                user_manager,
                skill_provider=None,
                retrieval_provider=None,
                max_tool_rounds=10,
                max_retries=3,
            ) -> None:
                agent_self.llm = llm
                agent_self.tool_registry = tool_registry
                agent_self.user_manager = user_manager
                agent_self.skill_provider = skill_provider
                agent_self.retrieval_provider = retrieval_provider
                agent_self.max_tool_rounds = max_tool_rounds
                agent_self.max_retries = max_retries
                self.created_agents.append(agent_self)

            def reset_interrupt(agent_self) -> None:
                return None

            def interrupt(agent_self) -> None:
                return None

        backend_main.run_agent_task = fake_run_agent_task
        backend_main.run_session_title_task = fake_run_session_title_task
        backend_main.create_llm = fake_create_llm
        backend_main.create_llm_for_profile = fake_create_llm
        backend_main.Agent = CapturingAgent

        async def send_callback(message):
            self.messages.append(message)

        self.send_callback = send_callback
        await backend_main.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        if backend_main.runtime_state.pending_tasks:
            await asyncio.gather(*backend_main.runtime_state.pending_tasks, return_exceptions=True)
        backend_main.user_manager = self.original_user_manager
        backend_main.runtime_state = self.original_runtime_state
        backend_main.run_agent_task = self.original_run_agent_task
        backend_main.run_session_title_task = self.original_run_session_title_task
        backend_main.create_llm = self.original_create_llm
        backend_main.create_llm_for_profile = self.original_create_llm_for_profile
        backend_main.Agent = self.original_agent_class
        self.temp_dir.cleanup()

    def test_resolve_conversation_profile_returns_primary(self) -> None:
        selected = resolve_conversation_profile(backend_main.runtime_state.current_config)

        self.assertEqual("primary", selected["profile_name"])
        self.assertEqual("gpt-4o", selected["model"])

    def test_resolve_background_profile_prefers_secondary(self) -> None:
        selected = resolve_background_profile(backend_main.runtime_state.current_config)

        self.assertEqual("secondary", selected["profile_name"])
        self.assertEqual("gpt-4o-mini", selected["model"])

    def test_resolve_background_profile_falls_back_to_primary(self) -> None:
        config_without_secondary = {
            **backend_main.runtime_state.current_config,
            "profiles": {
                "primary": backend_main.runtime_state.current_config["profiles"]["primary"],
            },
        }

        selected = resolve_background_profile(config_without_secondary)

        self.assertEqual("primary", selected["profile_name"])
        self.assertEqual("gpt-4o", selected["model"])

    async def test_handle_user_message_rejects_session_when_locked_model_mismatches_active_profile(self) -> None:
        session = Session(
            "session-locked",
            self.temp_dir.name,
            locked_model=LockedModelRef(
                profile_name="primary",
                provider="openai",
                model="gpt-4o-mini",
            ),
        )
        backend_main.user_manager.sessions["session-locked"] = session

        await backend_main.handle_user_message(
            {
                "session_id": "session-locked",
                "content": "hello",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-1",
        )

        self.assertTrue(
            any(
                message.get("type") == "error"
                and "locked to" in message.get("error", "")
                for message in self.messages
            )
        )

    async def test_handle_user_message_routes_short_prompt_to_primary_conversation_profile_and_applies_runtime_limits(self) -> None:
        await backend_main.handle_user_message(
            {
                "session_id": "session-simple",
                "content": "Ping?",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-1",
        )

        session = backend_main.user_manager.get_session("session-simple")
        self.assertIsNotNone(session)
        self.assertEqual("primary", session.locked_model.profile_name)
        self.assertEqual("gpt-4o", session.locked_model.model)

        self.assertTrue(self.created_agents)
        agent = self.created_agents[0]
        self.assertEqual("primary", agent.llm["profile_name"])
        self.assertEqual("gpt-4o", agent.llm["model"])
        self.assertEqual(256, agent.llm["max_output_tokens"])
        self.assertEqual(2, agent.max_tool_rounds)
        self.assertEqual(5, agent.max_retries)

    async def test_session_title_uses_background_profile(self) -> None:
        await backend_main.handle_user_message(
            {
                "session_id": "session-title",
                "content": "Name this session",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-1",
        )
        if backend_main.runtime_state.pending_tasks:
            await asyncio.gather(*backend_main.runtime_state.pending_tasks, return_exceptions=True)

        self.assertTrue(self.title_task_calls)
        title_llm = self.title_task_calls[0]["llm"]
        self.assertEqual("secondary", title_llm["profile_name"])
        self.assertEqual("gpt-4o-mini", title_llm["model"])

        session = backend_main.user_manager.get_session("session-title")
        self.assertEqual("primary", session.locked_model.profile_name)
        self.assertEqual("gpt-4o", session.locked_model.model)

    async def test_session_title_falls_back_to_primary_when_background_missing(self) -> None:
        backend_main.runtime_state.current_config = {
            **backend_main.runtime_state.current_config,
            "profiles": {
                "primary": backend_main.runtime_state.current_config["profiles"]["primary"],
            },
        }

        await backend_main.handle_user_message(
            {
                "session_id": "session-title-fallback",
                "content": "Name this session",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-1",
        )
        if backend_main.runtime_state.pending_tasks:
            await asyncio.gather(*backend_main.runtime_state.pending_tasks, return_exceptions=True)

        self.assertTrue(self.title_task_calls)
        title_llm = self.title_task_calls[0]["llm"]
        self.assertEqual("primary", title_llm["profile_name"])
        self.assertEqual("gpt-4o", title_llm["model"])


if __name__ == "__main__":
    unittest.main()
