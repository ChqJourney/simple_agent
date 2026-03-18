import asyncio
from pathlib import Path
from typing import Any, Optional

from .base import BaseTool, ToolResult
from .policies import ToolExecutionPolicy

MIN_TIMEOUT_SECONDS = 1
MAX_TIMEOUT_SECONDS = 120


def _normalize_timeout(timeout_seconds: Any, default_timeout: int = 30) -> int:
    try:
        parsed = int(timeout_seconds)
    except (TypeError, ValueError):
        parsed = default_timeout
    if parsed < MIN_TIMEOUT_SECONDS:
        return default_timeout
    return min(parsed, MAX_TIMEOUT_SECONDS)


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

        normalized_timeout = _normalize_timeout(timeout_seconds, self.policy.timeout_seconds)
        cwd = str(Path(workspace_path).resolve()) if workspace_path else None
        process = await asyncio.create_subprocess_shell(
            command,
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
        output = {
            "command": command,
            "exit_code": exit_code,
            "stdout": stdout.decode("utf-8", errors="replace").strip(),
            "stderr": stderr.decode("utf-8", errors="replace").strip(),
        }
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=exit_code == 0,
            output=output,
            error=None if exit_code == 0 else f"Command exited with code {exit_code}",
        )
