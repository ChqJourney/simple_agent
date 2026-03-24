import asyncio
from pathlib import Path
from typing import Any, Optional

from runtime.embedded_runtime import get_node_executable

from .base import BaseTool, ToolResult
from .execution_common import MAX_OUTPUT_BYTES, format_process_output, normalize_timeout
from .policies import ToolExecutionPolicy


class NodeExecuteTool(BaseTool):
    name = "node_execute"
    description = "Execute a Node.js snippet using the built-in Node runtime"
    display_name = "Node Execute"
    category = "execution"
    require_confirmation = True
    policy = ToolExecutionPolicy(timeout_seconds=30)
    parameters = {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "JavaScript code to execute",
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

        normalized_timeout = normalize_timeout(timeout_seconds, self.policy.timeout_seconds)
        cwd = str(Path(workspace_path).resolve()) if workspace_path else None
        node_executable = str(get_node_executable())
        process = await asyncio.create_subprocess_exec(
            node_executable,
            "-e",
            code,
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
                error=f"Node execution timed out after {normalized_timeout} seconds",
            )
        except asyncio.CancelledError:
            process.kill()
            await process.communicate()
            raise

        exit_code = process.returncode or 0
        capture_output = bool(getattr(self.policy, "capture_output", True))

        output = {
            "exit_code": exit_code,
            **format_process_output(
                stdout=stdout,
                stderr=stderr,
                capture_output=capture_output,
                max_bytes=MAX_OUTPUT_BYTES,
            ),
        }
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=exit_code == 0,
            output=output,
            error=None if exit_code == 0 else f"Node exited with code {exit_code}",
        )
