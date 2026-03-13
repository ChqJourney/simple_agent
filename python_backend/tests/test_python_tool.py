import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.python_execute import PythonExecuteTool


class PythonExecuteToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_python_tool_returns_structured_output(self) -> None:
        result = await PythonExecuteTool().execute(
            tool_call_id="python-1",
            code="print('hello-from-python')",
        )

        self.assertTrue(result.success)
        self.assertEqual("python_execute", result.tool_name)
        self.assertEqual(0, result.output["exit_code"])
        self.assertIn("hello-from-python", result.output["stdout"])
        self.assertEqual("", result.output["stderr"])


if __name__ == "__main__":
    unittest.main()
