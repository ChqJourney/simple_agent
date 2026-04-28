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
from runtime.router import (
    build_execution_spec,
    resolve_background_profile,
    resolve_compaction_profile,
    resolve_conversation_profile,
    resolve_runtime_policy,
)


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
                "background": {
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "api_key": "test-key",
                    "base_url": "https://api.openai.com/v1",
                    "enable_reasoning": False,
                    "profile_name": "background",
                },
            },
            "runtime": {
                "shared": {
                    "max_tool_rounds": 2,
                    "max_retries": 5,
                    "max_output_tokens": 256,
                    "timeout_seconds": 120,
                },
                "background": {
                    "max_output_tokens": 128,
                },
                "compaction": {
                    "max_output_tokens": 64,
                },
                "delegated_task": {
                    "max_output_tokens": 96,
                    "timeout_seconds": 90,
                },
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
                def __init__(self, payload):
                    super().__init__(payload)
                    self.closed = False

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

                async def aclose(self):
                    self.closed = True

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
                custom_system_prompt="",
                scenario_system_prompt="",
                compaction_llm_factory=None,
                background_compaction_scheduler=None,
                tool_filter=None,
                max_tool_rounds=10,
                max_retries=3,
                **_kwargs,
            ) -> None:
                agent_self.llm = llm
                agent_self.tool_registry = tool_registry
                agent_self.user_manager = user_manager
                agent_self.skill_provider = skill_provider
                agent_self.custom_system_prompt = custom_system_prompt
                agent_self.scenario_system_prompt = scenario_system_prompt
                agent_self.compaction_llm_factory = compaction_llm_factory
                agent_self.background_compaction_scheduler = background_compaction_scheduler
                agent_self.tool_filter = tool_filter
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

    def test_resolve_background_profile_prefers_background(self) -> None:
        selected = resolve_background_profile(backend_main.runtime_state.current_config)

        self.assertEqual("background", selected["profile_name"])
        self.assertEqual("gpt-4o-mini", selected["model"])

    def test_resolve_background_profile_falls_back_to_primary(self) -> None:
        config_without_background = {
            **backend_main.runtime_state.current_config,
            "profiles": {
                "primary": backend_main.runtime_state.current_config["profiles"]["primary"],
            },
        }

        selected = resolve_background_profile(config_without_background)

        self.assertEqual("primary", selected["profile_name"])
        self.assertEqual("gpt-4o", selected["model"])

    def test_resolve_compaction_profile_prefers_background(self) -> None:
        selected = resolve_compaction_profile(backend_main.runtime_state.current_config)

        self.assertEqual("background", selected["profile_name"])
        self.assertEqual("gpt-4o-mini", selected["model"])

    def test_resolve_compaction_profile_falls_back_to_primary(self) -> None:
        config_without_background = {
            **backend_main.runtime_state.current_config,
            "profiles": {
                "primary": backend_main.runtime_state.current_config["profiles"]["primary"],
            },
        }

        selected = resolve_compaction_profile(config_without_background)

        self.assertEqual("primary", selected["profile_name"])
        self.assertEqual("gpt-4o", selected["model"])

    def test_resolve_runtime_policy_applies_shared_then_role_overrides(self) -> None:
        background_runtime = resolve_runtime_policy(backend_main.runtime_state.current_config, "background")
        compaction_runtime = resolve_runtime_policy(backend_main.runtime_state.current_config, "compaction")

        self.assertEqual(128, background_runtime["max_output_tokens"])
        self.assertEqual(64, compaction_runtime["max_output_tokens"])
        self.assertEqual(2, background_runtime["max_tool_rounds"])
        self.assertEqual(5, compaction_runtime["max_retries"])
        self.assertEqual(120, background_runtime["timeout_seconds"])

    def test_build_execution_spec_returns_profile_runtime_and_capabilities_for_role(self) -> None:
        execution_spec = build_execution_spec(backend_main.runtime_state.current_config, "background")

        self.assertEqual("background", execution_spec["role"])
        self.assertEqual("background", execution_spec["profile"]["profile_name"])
        self.assertEqual(128, execution_spec["runtime"]["max_output_tokens"])
        self.assertEqual(["text"], execution_spec["capability_summary"]["supported_input_types"])
        self.assertEqual("unknown", execution_spec["capability_summary"]["reasoning_support"])

    def test_build_execution_spec_supports_dedicated_runtime_for_delegated_task_role(self) -> None:
        execution_spec = build_execution_spec(backend_main.runtime_state.current_config, "delegated_task")

        self.assertEqual("delegated_task", execution_spec["role"])
        self.assertEqual("background", execution_spec["profile"]["profile_name"])
        self.assertEqual(96, execution_spec["runtime"]["max_output_tokens"])
        self.assertEqual(90, execution_spec["runtime"]["timeout_seconds"])

    def test_build_execution_spec_clamps_context_length_and_output_tokens(self) -> None:
        config = {
            **backend_main.runtime_state.current_config,
            "runtime": {
                "shared": {
                    "context_length": 256000,
                    "max_output_tokens": 200000,
                    "max_tool_rounds": 2,
                    "max_retries": 5,
                },
            },
        }

        execution_spec = build_execution_spec(config, "conversation")

        self.assertEqual(128000, execution_spec["runtime"]["context_length"])
        self.assertEqual(128000, execution_spec["runtime"]["max_output_tokens"])
        self.assertEqual(
            [
                "context_length 256000 exceeds known model window 128000",
                "max_output_tokens 200000 exceeds effective context_length 128000",
            ],
            execution_spec["guardrails"]["warnings"],
        )

    def test_build_execution_spec_prefers_provider_catalog_metadata(self) -> None:
        config = {
            **backend_main.runtime_state.current_config,
            "profiles": {
                "primary": {
                    "provider": "openai",
                    "model": "gpt-4.1-nano",
                    "api_key": "test-key",
                    "base_url": "https://api.openai.com/v1",
                    "enable_reasoning": False,
                    "profile_name": "primary",
                },
            },
            "provider_catalog": {
                "openai": [
                    {
                        "id": "gpt-4.1-nano",
                        "context_length": 200000,
                        "image_support": "supported",
                        "supports_image_in": True,
                    },
                ],
            },
            "runtime": {
                "shared": {
                    "context_length": 256000,
                    "max_output_tokens": 220000,
                    "max_tool_rounds": 2,
                    "max_retries": 5,
                },
            },
        }

        execution_spec = build_execution_spec(config, "conversation")

        self.assertEqual(["text", "image"], execution_spec["capability_summary"]["supported_input_types"])
        self.assertEqual(200000, execution_spec["runtime"]["context_length"])
        self.assertEqual(200000, execution_spec["runtime"]["max_output_tokens"])
        self.assertEqual(
            [
                "context_length 256000 exceeds known model window 200000",
                "max_output_tokens 220000 exceeds effective context_length 200000",
            ],
            execution_spec["guardrails"]["warnings"],
        )

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
        self.assertEqual("background", title_llm["profile_name"])
        self.assertEqual("gpt-4o-mini", title_llm["model"])
        self.assertEqual(128, title_llm["max_output_tokens"])

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

    async def test_agent_compaction_factory_uses_compaction_role_runtime(self) -> None:
        await backend_main.handle_user_message(
            {
                "session_id": "session-compaction",
                "content": "Ping?",
                "workspace_path": self.temp_dir.name,
            },
            self.send_callback,
            "conn-1",
        )

        self.assertTrue(self.created_agents)
        compaction_llm = self.created_agents[0].compaction_llm_factory()
        self.assertEqual("background", compaction_llm["profile_name"])
        self.assertEqual("gpt-4o-mini", compaction_llm["model"])
        self.assertEqual(64, compaction_llm["max_output_tokens"])

    async def test_session_title_closes_title_llm_after_task_finishes(self) -> None:
        await backend_main.handle_user_message(
            {
                "session_id": "session-title-close",
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
        self.assertTrue(title_llm.closed)


if __name__ == "__main__":
    unittest.main()
