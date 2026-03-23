import asyncio
import copy
import os
import shutil
from pathlib import Path
from typing import Any, Optional

from .base import BaseTool, ToolResult
from .execution_common import MAX_OUTPUT_BYTES, format_process_output, normalize_timeout
from .policies import ToolExecutionPolicy


class ShellExecuteTool(BaseTool):
    name = "shell_execute"
    description = "Execute a shell command in the current workspace"
    display_name = "Shell Execute"
    category = "execution"
    require_confirmation = True
    policy = ToolExecutionPolicy(timeout_seconds=30)
    parameters = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Shell command to execute",
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Maximum execution time in seconds",
                "default": 30,
            },
        },
        "required": ["command"],
    }

    def __init__(self) -> None:
        super().__init__()
        self.description = self._build_description()
        self.parameters = copy.deepcopy(self.__class__.parameters)
        self.parameters["properties"]["command"]["description"] = self._build_command_description()

    @classmethod
    def _build_description(cls) -> str:
        shell_runner = cls._resolve_shell_runner("")
        runner_name = str(shell_runner.get("runner") or "shell")

        if os.name != "nt":
            return (
                "Execute a shell command in the current workspace. "
                f"Commands run in the current {runner_name} shell."
            )

        if runner_name in {"pwsh", "powershell"}:
            return (
                "Execute a shell command in the current workspace. "
                f"This backend is running on Windows and commands execute in {runner_name}. "
                "Use Windows-native commands only and prefer PowerShell syntax. "
                "For example, use `Get-ChildItem` or `dir` instead of `ls`, "
                "`Get-Content` instead of `cat`, `Get-Location` instead of `pwd`, "
                "`Copy-Item` instead of `cp`, `Move-Item` instead of `mv`, and "
                "`Remove-Item` instead of `rm`."
            )

        return (
            "Execute a shell command in the current workspace. "
            "This backend is running on Windows and commands execute in `cmd`. "
            "Use Windows-native commands only. "
            "For example, use `dir` instead of `ls`, `type` instead of `cat`, "
            "`cd` instead of `pwd`, `copy` instead of `cp`, `move` instead of `mv`, "
            "and `del` or `rmdir` instead of `rm`."
        )

    @classmethod
    def _build_command_description(cls) -> str:
        if os.name != "nt":
            return "Shell command to execute"

        runner_name = str(cls._resolve_shell_runner("").get("runner") or "cmd")
        if runner_name in {"pwsh", "powershell"}:
            return (
                "Windows shell command to execute. Prefer PowerShell syntax and cmdlets; "
                "do not assume bash utilities are available."
            )

        return (
            "Windows cmd command to execute. Use cmd/Windows-native commands only; "
            "do not assume bash utilities are available."
        )

    @staticmethod
    def _find_windows_shell_executable() -> Optional[tuple[str, str]]:
        for candidate in ("pwsh.exe", "pwsh", "powershell.exe", "powershell"):
            resolved = shutil.which(candidate)
            if resolved:
                runner = "pwsh" if "pwsh" in candidate.lower() else "powershell"
                return runner, resolved

        path_candidates: list[tuple[str, str]] = []
        for base in (
            os.environ.get("ProgramFiles"),
            os.environ.get("ProgramW6432"),
            os.environ.get("ProgramFiles(x86)"),
        ):
            if base:
                path_candidates.append(("pwsh", os.path.join(base, "PowerShell", "7", "pwsh.exe")))

        for base in (os.environ.get("SystemRoot"), os.environ.get("WINDIR")):
            if base:
                path_candidates.append(
                    (
                        "powershell",
                        os.path.join(base, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
                    )
                )

        seen: set[str] = set()
        for runner, candidate_path in path_candidates:
            normalized = os.path.normpath(candidate_path)
            if normalized in seen:
                continue
            seen.add(normalized)
            if os.path.isfile(normalized):
                return runner, normalized

        return None

    @staticmethod
    def _build_windows_command_hint(command: str, runner: str) -> Optional[str]:
        if os.name != "nt":
            return None

        stripped = command.strip()
        if not stripped:
            return None

        first_token = stripped.split(None, 1)[0].lower()
        replacements = {
            "ls": {"pwsh": "`Get-ChildItem` or `dir`", "powershell": "`Get-ChildItem` or `dir`", "cmd": "`dir`"},
            "cat": {"pwsh": "`Get-Content`", "powershell": "`Get-Content`", "cmd": "`type`"},
            "pwd": {"pwsh": "`Get-Location`", "powershell": "`Get-Location`", "cmd": "`cd`"},
            "cp": {"pwsh": "`Copy-Item`", "powershell": "`Copy-Item`", "cmd": "`copy`"},
            "mv": {"pwsh": "`Move-Item`", "powershell": "`Move-Item`", "cmd": "`move`"},
            "rm": {"pwsh": "`Remove-Item`", "powershell": "`Remove-Item`", "cmd": "`del` or `rmdir`"},
            "which": {"pwsh": "`Get-Command`", "powershell": "`Get-Command`", "cmd": "`where`"},
            "grep": {"pwsh": "`Select-String`", "powershell": "`Select-String`", "cmd": "`findstr`"},
        }
        replacement = replacements.get(first_token, {}).get(runner)
        if not replacement:
            return None

        return (
            f"Windows shell detected. `{first_token}` may not exist in {runner}; "
            f"try {replacement} instead."
        )

    @staticmethod
    def _resolve_shell_runner(command: str) -> dict[str, Any]:
        if os.name != "nt":
            shell_path = os.environ.get("SHELL", "")
            shell_name = Path(shell_path).name if shell_path else "default_shell"
            return {
                "mode": "shell",
                "runner": shell_name,
                "command": command,
            }

        resolved_shell = ShellExecuteTool._find_windows_shell_executable()
        if resolved_shell:
            runner_name, shell_path = resolved_shell
            return {
                "mode": "exec",
                "runner": runner_name,
                "argv": [
                    shell_path,
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    command,
                ],
            }

        return {
            "mode": "shell",
            "runner": "cmd",
            "command": command,
        }

    async def execute(
        self,
        command: str,
        tool_call_id: str = "",
        timeout_seconds: int = 30,
        workspace_path: Optional[str] = None,
        **kwargs: Any,
    ) -> ToolResult:
        if not command.strip():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Command is empty",
            )

        normalized_timeout = normalize_timeout(timeout_seconds, self.policy.timeout_seconds)
        cwd = str(Path(workspace_path).resolve()) if workspace_path else None
        shell_runner = self._resolve_shell_runner(command)

        if shell_runner["mode"] == "exec":
            process = await asyncio.create_subprocess_exec(
                *shell_runner["argv"],
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            process = await asyncio.create_subprocess_shell(
                shell_runner["command"],
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=normalized_timeout)
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Command timed out after {normalized_timeout} seconds",
            )
        except asyncio.CancelledError:
            process.kill()
            await process.communicate()
            raise

        exit_code = process.returncode or 0
        capture_output = bool(getattr(self.policy, "capture_output", True))

        output = {
            "command": command,
            "runner": shell_runner["runner"],
            "exit_code": exit_code,
            **format_process_output(
                stdout=stdout,
                stderr=stderr,
                capture_output=capture_output,
                max_bytes=MAX_OUTPUT_BYTES,
            ),
        }
        hint = self._build_windows_command_hint(command, str(shell_runner["runner"]))
        if hint:
            output["hint"] = hint
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=exit_code == 0,
            output=output,
            error=None if exit_code == 0 else (
                f"Command exited with code {exit_code}. Hint: {hint}" if hint else f"Command exited with code {exit_code}"
            ),
        )
