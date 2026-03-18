import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.shell_execute import ShellExecuteTool


class FakeProcess:
    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode

    async def communicate(self):
        return self._stdout, self._stderr

    def kill(self) -> None:
        return None


class ShellExecuteToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_shell_tool_returns_structured_output(self) -> None:
        result = await ShellExecuteTool().execute(
            tool_call_id="shell-1",
            command="echo hello-from-shell",
        )

        self.assertTrue(result.success)
        self.assertEqual("shell_execute", result.tool_name)
        self.assertEqual(0, result.output["exit_code"])
        self.assertIn("hello-from-shell", result.output["stdout"])
        self.assertEqual("", result.output["stderr"])

    async def test_shell_tool_truncates_large_outputs(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=(b"x" * 80000), stderr=b"", returncode=0)
        )

        with patch("tools.shell_execute.asyncio.create_subprocess_shell", fake_subprocess):
            result = await ShellExecuteTool().execute(
                tool_call_id="shell-large-output",
                command="echo long-output",
            )

        self.assertTrue(result.success)
        self.assertTrue(result.output["stdout_truncated"])
        self.assertFalse(result.output["stderr_truncated"])
        self.assertLessEqual(
            len(result.output["stdout"].encode("utf-8")),
            result.output["output_max_bytes"],
        )

    async def test_shell_tool_respects_capture_output_policy(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"secret", stderr=b"warn", returncode=0)
        )
        tool = ShellExecuteTool()
        tool.policy.capture_output = False

        with patch("tools.shell_execute.asyncio.create_subprocess_shell", fake_subprocess):
            result = await tool.execute(
                tool_call_id="shell-no-capture",
                command="echo secret",
            )

        self.assertTrue(result.success)
        self.assertEqual("", result.output["stdout"])
        self.assertEqual("", result.output["stderr"])
        self.assertFalse(result.output["stdout_truncated"])
        self.assertFalse(result.output["stderr_truncated"])
        self.assertFalse(result.output["captured_output"])


if __name__ == "__main__":
    unittest.main()
