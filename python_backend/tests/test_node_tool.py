import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.node_execute import NodeExecuteTool


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


if __name__ == "__main__":
    unittest.main()
