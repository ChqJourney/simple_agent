import asyncio
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.user import UserManager


class ToolPolicyPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_workspace_tool_policy_persists_and_reloads(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            policy_path = Path(temp_dir) / "tool-policies.json"
            user_manager = UserManager(policy_store_path=policy_path)

            async def callback(_message):
                return None

            await user_manager.register_connection("conn-1", callback)
            await user_manager.bind_session_to_connection("session-a", "conn-1")

            confirmation_task = asyncio.create_task(
                user_manager.request_tool_confirmation(
                    session_id="session-a",
                    tool_call_id="tool-1",
                    tool_name="shell_execute",
                    workspace_path="C:/workspace-a",
                    arguments={"command": "echo ok"},
                )
            )
            await asyncio.sleep(0)

            handled = await user_manager.handle_tool_confirmation(
                tool_call_id="tool-1",
                decision="approve_always",
                scope="workspace",
            )
            self.assertTrue(handled)
            await confirmation_task

            self.assertTrue(policy_path.exists())

            reloaded = UserManager(policy_store_path=policy_path)
            self.assertTrue(
                reloaded.is_tool_auto_approved("another-session", "C:/workspace-a", "shell_execute")
            )


if __name__ == "__main__":
    unittest.main()
