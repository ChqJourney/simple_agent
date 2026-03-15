import asyncio
from pathlib import Path
from typing import Any, Optional

from runtime.embedded_runtime import get_python_executable

from .base import BaseTool, ToolResult
from .policies import ToolExecutionPolicy


class PythonExecuteTool(BaseTool):
    name = "python_execute"
    description = "Execute a Python snippet with the current Python runtime"
    display_name = "Python Execute"
    category = "execution"
    require_confirmation = True
    policy = ToolExecutionPolicy(timeout_seconds=30)
    parameters = {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "Python code to execute",
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Maximum execution time in seconds",
                "default": 30,
            },
        },
        "required": ["code"],
    }

    async def execute(
        self,
        code: str,
        tool_call_id: str = "",
        timeout_seconds: int = 30,
        workspace_path: Optional[str] = None,
        **kwargs: Any,
    ) -> ToolResult:
        if not code.strip():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Code is empty",
            )

        cwd = str(Path(workspace_path).resolve()) if workspace_path else None
        python_executable = str(get_python_executable())
        process = await asyncio.create_subprocess_exec(
            python_executable,
            "-c",
            code,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Python execution timed out after {timeout_seconds} seconds",
            )

        exit_code = process.returncode or 0
        output = {
            "exit_code": exit_code,
            "stdout": stdout.decode("utf-8", errors="replace").strip(),
            "stderr": stderr.decode("utf-8", errors="replace").strip(),
        }
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=exit_code == 0,
            output=output,
            error=None if exit_code == 0 else f"Python exited with code {exit_code}",
        )
