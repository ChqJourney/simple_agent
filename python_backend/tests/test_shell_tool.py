import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.shell_execute import ShellExecuteTool


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


if __name__ == "__main__":
    unittest.main()
