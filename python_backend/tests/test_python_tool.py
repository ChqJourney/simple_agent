import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.python_execute import PythonExecuteTool


class FakeProcess:
    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode

    async def communicate(self):
        return self._stdout, self._stderr

    def kill(self) -> None:
        return None


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

    async def test_python_tool_prefers_embedded_python_when_configured(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"embedded-python", stderr=b"", returncode=0)
        )

        with patch.dict(
            "os.environ",
            {"TAURI_AGENT_EMBEDDED_PYTHON": r"C:\runtime\python"},
            clear=False,
        ):
            with patch("pathlib.Path.exists", return_value=True), patch("pathlib.Path.is_dir", return_value=True):
                with patch("tools.python_execute.asyncio.create_subprocess_exec", fake_subprocess):
                    result = await PythonExecuteTool().execute(
                        tool_call_id="python-embedded",
                        code="print('x')",
                    )

        self.assertTrue(result.success)
        self.assertEqual(
            r"C:\runtime\python\python.exe",
            fake_subprocess.await_args.args[0],
        )

    async def test_python_tool_passes_runtime_environment_to_subprocess(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"ok", stderr=b"", returncode=0)
        )

        with patch.dict(
            "os.environ",
            {
                "PATH": r"C:\Windows\System32",
                "TAURI_AGENT_EMBEDDED_PYTHON": r"C:\runtime\python",
            },
            clear=False,
        ):
            with patch("pathlib.Path.exists", return_value=True), patch("pathlib.Path.is_dir", return_value=True):
                with patch("tools.python_execute.asyncio.create_subprocess_exec", fake_subprocess):
                    result = await PythonExecuteTool().execute(
                        tool_call_id="python-env",
                        code="print('x')",
                    )

        self.assertTrue(result.success)
        env = fake_subprocess.await_args.kwargs["env"]
        self.assertIn("env", fake_subprocess.await_args.kwargs)
        self.assertTrue(env["PATH"].startswith(r"C:\runtime\python" + os.pathsep))

    async def test_python_tool_falls_back_to_current_interpreter_without_embedded_runtime(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"system-python", stderr=b"", returncode=0)
        )

        with patch.dict("os.environ", {}, clear=False):
            with patch("tools.python_execute.asyncio.create_subprocess_exec", fake_subprocess):
                result = await PythonExecuteTool().execute(
                    tool_call_id="python-system",
                    code="print('x')",
                )

        self.assertTrue(result.success)
        self.assertEqual(sys.executable, fake_subprocess.await_args.args[0])

    async def test_python_tool_truncates_large_outputs(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=(b"x" * 80000), stderr=b"", returncode=0)
        )

        with patch("tools.python_execute.asyncio.create_subprocess_exec", fake_subprocess):
            result = await PythonExecuteTool().execute(
                tool_call_id="python-large-output",
                code="print('x' * 80000)",
            )

        self.assertTrue(result.success)
        self.assertTrue(result.output["stdout_truncated"])
        self.assertFalse(result.output["stderr_truncated"])
        self.assertLessEqual(
            len(result.output["stdout"].encode("utf-8")),
            result.output["output_max_bytes"],
        )

    async def test_python_tool_respects_capture_output_policy(self) -> None:
        fake_subprocess = AsyncMock(
            return_value=FakeProcess(stdout=b"secret", stderr=b"warn", returncode=0)
        )
        tool = PythonExecuteTool()
        tool.policy.capture_output = False

        with patch("tools.python_execute.asyncio.create_subprocess_exec", fake_subprocess):
            result = await tool.execute(
                tool_call_id="python-no-capture",
                code="print('secret')",
            )

        self.assertTrue(result.success)
        self.assertEqual("", result.output["stdout"])
        self.assertEqual("", result.output["stderr"])
        self.assertFalse(result.output["stdout_truncated"])
        self.assertFalse(result.output["stderr_truncated"])
        self.assertFalse(result.output["captured_output"])


if __name__ == "__main__":
    unittest.main()
