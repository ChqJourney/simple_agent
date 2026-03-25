import asyncio
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.user import UserManager


class ConnectionRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.user_manager = UserManager()
        self.client_a_messages = []
        self.client_b_messages = []

        async def client_a_callback(message):
            self.client_a_messages.append(message)

        async def client_b_callback(message):
            self.client_b_messages.append(message)

        await self.user_manager.register_connection("conn-a", client_a_callback)
        await self.user_manager.register_connection("conn-b", client_b_callback)

    async def test_routes_session_messages_to_bound_connection(self) -> None:
        await self.user_manager.bind_session_to_connection("session-a", "conn-a")
        await self.user_manager.bind_session_to_connection("session-b", "conn-b")

        await self.user_manager.send_to_frontend(
            {"type": "started", "session_id": "session-a"}
        )
        await self.user_manager.send_to_frontend(
            {"type": "started", "session_id": "session-b"}
        )

        self.assertEqual(
            [{"type": "started", "session_id": "session-a"}],
            self.client_a_messages,
        )
        self.assertEqual(
            [{"type": "started", "session_id": "session-b"}],
            self.client_b_messages,
        )

    async def test_does_not_broadcast_when_only_one_connection_exists_without_session_binding(self) -> None:
        single_connection_manager = UserManager()
        delivered_messages = []

        async def callback(message):
            delivered_messages.append(message)

        await single_connection_manager.register_connection("conn-only", callback)

        await single_connection_manager.send_to_frontend({"type": "started", "session_id": "session-missing"})

        self.assertEqual([], delivered_messages)

    async def test_unregister_connection_only_cancels_owned_confirmations(self) -> None:
        await self.user_manager.bind_session_to_connection("session-a", "conn-a")
        await self.user_manager.bind_session_to_connection("session-b", "conn-b")

        task_a = asyncio.create_task(
            self.user_manager.request_tool_confirmation(
                session_id="session-a",
                tool_call_id="tool-a",
                tool_name="file_write",
                workspace_path="C:/workspace-a",
                arguments={"path": "a.txt"},
            )
        )
        task_b = asyncio.create_task(
            self.user_manager.request_tool_confirmation(
                session_id="session-b",
                tool_call_id="tool-b",
                tool_name="file_write",
                workspace_path="C:/workspace-b",
                arguments={"path": "b.txt"},
            )
        )

        await asyncio.sleep(0)

        self.assertEqual(1, len(self.client_a_messages))
        self.assertEqual(1, len(self.client_b_messages))

        await self.user_manager.unregister_connection("conn-a")

        result_a = await asyncio.wait_for(task_a, timeout=1)
        self.assertEqual("reject", result_a["decision"])
        self.assertEqual("connection_closed", result_a["reason"])

        self.assertFalse(task_b.done())

        handled = await self.user_manager.handle_tool_confirmation(
            tool_call_id="tool-b",
            decision="approve_once",
            scope="session",
        )
        self.assertTrue(handled)

        result_b = await asyncio.wait_for(task_b, timeout=1)
        self.assertEqual("approve_once", result_b["decision"])
        self.assertEqual("user_action", result_b["reason"])


if __name__ == "__main__":
    unittest.main()
