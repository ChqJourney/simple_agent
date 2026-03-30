import asyncio
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.agent import Agent, RunInterrupted
from core.user import UserManager
from tools.base import BaseTool, ToolResult, ToolRegistry


class DummyLLM:
    pass


class SlowCancelTool(BaseTool):
    name = "slow_cancel"
    description = "Tool that delays cleanup after cancellation."
    parameters = {
        "type": "object",
        "properties": {},
    }

    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()
        self.release = asyncio.Event()

    async def execute(self, tool_call_id: str = "", **kwargs):
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            await self.release.wait()
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="cancelled",
            )


class InterruptRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_tool_interrupt_does_not_wait_indefinitely_for_slow_cancel_cleanup(self) -> None:
        tool = SlowCancelTool()
        agent = Agent(DummyLLM(), ToolRegistry(), UserManager())

        task = asyncio.create_task(
            agent._execute_tool_with_interrupt_timeout(
                tool=tool,
                tool_call_id="slow-1",
                workspace_path=self.temp_dir.name,
                timeout_seconds=30,
                arguments={},
            )
        )

        await asyncio.wait_for(tool.started.wait(), timeout=1)
        agent.interrupt()

        with self.assertRaises(RunInterrupted):
            await asyncio.wait_for(task, timeout=1)

        self.assertTrue(tool.cancelled.is_set())
        tool.release.set()
        await asyncio.sleep(0)


if __name__ == "__main__":
    unittest.main()
