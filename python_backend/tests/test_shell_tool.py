import sys
import unittest
import os
from contextlib import ExitStack
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
    def _patch_subprocess(self, command: str, fake_process: FakeProcess) -> ExitStack:
        stack = ExitStack()
        shell_runner = ShellExecuteTool._resolve_shell_runner(command)
        if shell_runner["mode"] == "exec":
            stack.enter_context(
                patch(
                    "tools.shell_execute.asyncio.create_subprocess_exec",
                    AsyncMock(return_value=fake_process),
                )
            )
        else:
            stack.enter_context(
                patch(
                    "tools.shell_execute.asyncio.create_subprocess_shell",
                    AsyncMock(return_value=fake_process),
                )
            )
        return stack

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
        self.assertIn("runner", result.output)

    async def test_shell_tool_truncates_large_outputs(self) -> None:
        with self._patch_subprocess(
            "echo long-output",
            FakeProcess(stdout=(b"x" * 80000), stderr=b"", returncode=0),
        ):
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
        tool = ShellExecuteTool()
        tool.policy.capture_output = False

        with self._patch_subprocess(
            "echo secret",
            FakeProcess(stdout=b"secret", stderr=b"warn", returncode=0),
        ):
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

    def test_prefers_powershell_on_windows_when_available(self) -> None:
        with patch("tools.shell_execute.os.name", "nt"), patch("tools.shell_execute.shutil.which") as which_mock:
            which_mock.side_effect = lambda command: command if command == "pwsh" else None

            runner = ShellExecuteTool._resolve_shell_runner("ls")

        self.assertEqual("exec", runner["mode"])
        self.assertEqual("pwsh", runner["runner"])
        self.assertEqual(
            ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "ls"],
            runner["argv"],
        )

    def test_finds_powershell_from_system_root_when_path_lookup_fails(self) -> None:
        with (
            patch("tools.shell_execute.os.name", "nt"),
            patch("tools.shell_execute.shutil.which", return_value=None),
            patch.dict("tools.shell_execute.os.environ", {"SystemRoot": "C:/Windows"}, clear=False),
            patch(
                "tools.shell_execute.os.path.isfile",
                side_effect=lambda path: str(path).replace("\\", "/").endswith(
                    "/System32/WindowsPowerShell/v1.0/powershell.exe"
                ),
            ),
        ):
            runner = ShellExecuteTool._resolve_shell_runner("ls")

        self.assertEqual("exec", runner["mode"])
        self.assertEqual("powershell", runner["runner"])
        self.assertEqual(
            "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
            runner["argv"][0].replace("\\", "/"),
        )

    def test_falls_back_to_cmd_shell_on_windows_when_powershell_is_unavailable(self) -> None:
        with (
            patch("tools.shell_execute.os.name", "nt"),
            patch("tools.shell_execute.ShellExecuteTool._find_windows_shell_executable", return_value=None),
        ):
            runner = ShellExecuteTool._resolve_shell_runner("dir")

        self.assertEqual("shell", runner["mode"])
        self.assertEqual("cmd", runner["runner"])
        self.assertEqual("dir", runner["command"])

    def test_windows_tool_description_includes_native_command_guidance(self) -> None:
        with patch("tools.shell_execute.os.name", "nt"), patch("tools.shell_execute.shutil.which", return_value="pwsh"):
            tool = ShellExecuteTool()

        self.assertIn("Windows", tool.description)
        self.assertIn("Get-ChildItem", tool.description)
        self.assertIn("PowerShell", tool.parameters["properties"]["command"]["description"])

    async def test_failure_includes_windows_command_hint(self) -> None:
        with (
            patch("tools.shell_execute.os.name", "nt"),
            patch("tools.shell_execute.ShellExecuteTool._find_windows_shell_executable", return_value=None),
            patch(
                "tools.shell_execute.asyncio.create_subprocess_shell",
                AsyncMock(return_value=FakeProcess(stdout=b"", stderr=b"'ls' is not recognized", returncode=1)),
            ),
        ):
            result = await ShellExecuteTool().execute(
                tool_call_id="shell-windows-hint",
                command="ls",
            )

        self.assertFalse(result.success)
        self.assertIn("Hint", result.error or "")
        self.assertIn("Windows shell detected", result.output.get("hint", ""))

    async def test_shell_tool_injects_embedded_runtime_directories_into_path(self) -> None:
        fake_shell_subprocess = AsyncMock(return_value=FakeProcess(stdout=b"ok", stderr=b"", returncode=0))
        fake_exec_subprocess = AsyncMock(return_value=FakeProcess(stdout=b"ok", stderr=b"", returncode=0))

        with (
            patch.dict(
                "tools.shell_execute.os.environ",
                {
                    "PATH": r"C:\Windows\System32",
                    "TAURI_AGENT_EMBEDDED_PYTHON": r"C:\runtime\python",
                    "TAURI_AGENT_EMBEDDED_NODE": r"C:\runtime\node",
                },
                clear=False,
            ),
            patch("pathlib.Path.is_dir", return_value=True),
            patch("tools.shell_execute.asyncio.create_subprocess_shell", fake_shell_subprocess),
            patch("tools.shell_execute.asyncio.create_subprocess_exec", fake_exec_subprocess),
        ):
            result = await ShellExecuteTool().execute(
                tool_call_id="shell-runtime-path",
                command="python --version",
            )

        self.assertTrue(result.success)
        called_mock = fake_exec_subprocess if fake_exec_subprocess.await_count else fake_shell_subprocess
        self.assertEqual(
            os.pathsep.join(
                [
                    r"C:\runtime\python",
                    r"C:\runtime\python\Scripts",
                    r"C:\runtime\node",
                    r"C:\Windows\System32",
                ]
            ),
            called_mock.await_args.kwargs["env"]["PATH"],
        )


if __name__ == "__main__":
    unittest.main()
