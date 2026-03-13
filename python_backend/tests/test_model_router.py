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
from runtime.router import resolve_profile_for_task


class ModelRouterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.messages = []

        self.original_user_manager = backend_main.user_manager
        self.original_runtime_state = backend_main.runtime_state
        self.original_run_agent_task = backend_main.run_agent_task

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
            "runtime": {},
        }
        backend_main.runtime_state.default_workspace = self.temp_dir.name

        async def fake_run_agent_task(_agent, _content, _session, _send_callback):
            return None

        backend_main.run_agent_task = fake_run_agent_task

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
        self.temp_dir.cleanup()

    def test_resolve_profile_for_task_prefers_secondary_for_simple_tasks(self) -> None:
        selected = resolve_profile_for_task(backend_main.runtime_state.current_config, task_kind="simple")
        fallback = resolve_profile_for_task(backend_main.runtime_state.current_config, task_kind="default")

        self.assertEqual("secondary", selected["profile_name"])
        self.assertEqual("gpt-4o-mini", selected["model"])
        self.assertEqual("primary", fallback["profile_name"])

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


if __name__ == "__main__":
    unittest.main()
