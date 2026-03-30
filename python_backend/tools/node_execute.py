import asyncio
from pathlib import Path
from typing import Any, Optional

from runtime.embedded_runtime import build_runtime_environment, get_node_executable

from .base import BaseTool, ToolResult
from .execution_common import (
    MAX_OUTPUT_BYTES,
    build_subprocess_kwargs,
    format_process_output,
    normalize_timeout,
    terminate_process_tree,
)
from .policies import ToolExecutionPolicy


class NodeExecuteTool(BaseTool):
    name = "node_execute"
    description = "Execute a Node.js snippet with the app-managed Node runtime"
    display_name = "Node Execute"
    category = "execution"
    require_confirmation = True
    read_only = False
    risk_level = "high"
    preferred_order = 92
    use_when = "Use only as an advanced fallback when specialized tools are insufficient and JavaScript is the most direct way to complete the step."
    avoid_when = "Avoid for routine document inspection, search, or excerpt reading when dedicated tools can answer the task."
    user_summary_template = "Using advanced Node.js execution"
    result_preview_fields = ["exit_code", "stdout", "stderr"]
    tags = ["execution", "fallback"]
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
        env = build_runtime_environment()
        process = await asyncio.create_subprocess_exec(
            node_executable,
            "-e",
            code,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            **build_subprocess_kwargs(),
        )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=normalized_timeout)
        except asyncio.TimeoutError:
            await terminate_process_tree(process)
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Node execution timed out after {normalized_timeout} seconds",
            )
        except asyncio.CancelledError:
            await terminate_process_tree(process)
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
