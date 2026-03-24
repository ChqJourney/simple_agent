import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.node_execute import NodeExecuteTool


class FakeProcess:
    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode

    async def communicate(self):
        return self._stdout, self._stderr

    def kill(self) -> None:
        return None


class NodeExecuteToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_node_tool_returns_structured_output(self) -> None:
        result = await NodeExecuteTool().execute(
            tool_call_id="node-1",
            code="console.log('hello-from-node')",
        )

        self.assertTrue(result.success)
        self.assertEqual("node_execute", result.tool_name)
        self.assertEqual(0, result.output["exit_code"])
        self.assertIn("hello-from-node", result.output["stdout"])
        self.assertEqual("", result.output["stderr"])

    async def test_node_tool_prefers_embedded_node_when_configured(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"embedded-node", stderr=b"", returncode=0)
        )

        with patch.dict(
            "os.environ",
            {"TAURI_AGENT_EMBEDDED_NODE": r"C:\runtime\node"},
            clear=False,
        ):
            with patch("pathlib.Path.is_dir", return_value=True), patch("pathlib.Path.exists", return_value=True):
                with patch("tools.node_execute.asyncio.create_subprocess_exec", fake_subprocess):
                    result = await NodeExecuteTool().execute(
                        tool_call_id="node-embedded",
                        code="console.log('x')",
                    )

        self.assertTrue(result.success)
        self.assertEqual(
            r"C:\runtime\node\node.exe",
            fake_subprocess.await_args.args[0],
        )

    async def test_node_tool_falls_back_to_system_node_without_embedded_runtime(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"system-node", stderr=b"", returncode=0)
        )

        with patch.dict("os.environ", {}, clear=False):
            with patch("tools.node_execute.asyncio.create_subprocess_exec", fake_subprocess):
                result = await NodeExecuteTool().execute(
                    tool_call_id="node-system",
                    code="console.log('x')",
                )

        self.assertTrue(result.success)
        self.assertEqual("node", fake_subprocess.await_args.args[0])

    async def test_node_tool_truncates_large_outputs(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=(b"x" * 80000), stderr=b"", returncode=0)
        )

        with patch("tools.node_execute.asyncio.create_subprocess_exec", fake_subprocess):
            result = await NodeExecuteTool().execute(
                tool_call_id="node-large-output",
                code="console.log('x'.repeat(80000))",
            )

        self.assertTrue(result.success)
        self.assertTrue(result.output["stdout_truncated"])
        self.assertFalse(result.output["stderr_truncated"])
        self.assertLessEqual(
            len(result.output["stdout"].encode("utf-8")),
            result.output["output_max_bytes"],
        )

    async def test_node_tool_respects_capture_output_policy(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"secret", stderr=b"warn", returncode=0)
        )
        tool = NodeExecuteTool()
        tool.policy.capture_output = False

        with patch("tools.node_execute.asyncio.create_subprocess_exec", fake_subprocess):
            result = await tool.execute(
                tool_call_id="node-no-capture",
                code="console.log('secret')",
            )

        self.assertTrue(result.success)
        self.assertEqual("", result.output["stdout"])
        self.assertEqual("", result.output["stderr"])
        self.assertFalse(result.output["stdout_truncated"])
        self.assertFalse(result.output["stderr_truncated"])
        self.assertFalse(result.output["captured_output"])


if __name__ == "__main__":
    unittest.main()
