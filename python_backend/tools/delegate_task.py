from __future__ import annotations

from typing import Any, Dict, Optional, Protocol

from tools.base import BaseTool, ToolResult
from tools.policies import ToolExecutionPolicy


class DelegatedTaskExecutor(Protocol):
    async def execute(
        self,
        *,
        task: str,
        expected_output: str = "text",
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        ...


class DelegateTaskTool(BaseTool):
    name = "delegate_task"
    description = (
        "Delegate a bounded background subtask to the configured background execution model and "
        "return its structured result to the current conversation."
    )
    display_name = "Delegate Task"
    category = "task"
    read_only = True
    risk_level = "low"
    preferred_order = 80
    use_when = (
        "Use when a self-contained, read-only background analysis or transformation can be completed "
        "without switching the main conversation model."
    )
    avoid_when = (
        "Avoid when the task requires direct user interaction, file mutation, broad open-ended research, "
        "or image inputs not present in the provided context."
    )
    user_summary_template = "Delegating subtask to background model"
    result_preview_fields = ["event", "summary", "worker"]
    tags = ["delegation", "background", "read-only"]
    policy = ToolExecutionPolicy(timeout_seconds=120)
    parameters = {
        "type": "object",
        "properties": {
            "task": {
                "type": "string",
                "description": "The bounded background task to execute.",
            },
            "expected_output": {
                "type": "string",
                "enum": ["text", "json"],
                "description": "Whether the background result should primarily be plain-text or structured JSON.",
                "default": "text",
            },
            "context": {
                "type": "object",
                "description": (
                    "Optional structured context for the delegated task. "
                    "Supported keys are `messages`, `tool_results`, `constraints`, and `notes`."
                ),
                "properties": {
                    "messages": {
                        "type": "array",
                        "description": "Optional selected conversation snippets for the worker.",
                        "items": {
                            "type": "object",
                        },
                    },
                    "tool_results": {
                        "type": "array",
                        "description": "Optional summarized tool outcomes for the worker.",
                        "items": {
                            "type": "object",
                        },
                    },
                    "constraints": {
                        "type": "array",
                        "description": "Optional explicit constraints the worker must honor.",
                        "items": {
                            "type": "string",
                        },
                    },
                    "notes": {
                        "type": "string",
                        "description": "Optional brief notes or framing for the worker.",
                    },
                },
                "additionalProperties": False,
            },
        },
        "required": ["task"],
        "additionalProperties": False,
    }

    def __init__(self, executor: DelegatedTaskExecutor) -> None:
        super().__init__()
        self.executor = executor

    async def execute(
        self,
        task: str,
        tool_call_id: str = "",
        expected_output: str = "text",
        context: Optional[Dict[str, Any]] = None,
        **_: Any,
    ) -> ToolResult:
        normalized_expected_output = expected_output if expected_output in {"text", "json"} else "text"

        try:
            output = await self.executor.execute(
                task=task,
                expected_output=normalized_expected_output,
                context=context if isinstance(context, dict) else None,
            )
        except Exception as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )

        worker = output.get("worker") if isinstance(output, dict) else None
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output=output,
            metadata={
                "ui_target": "delegate_task",
                "worker": worker if isinstance(worker, dict) else {},
            },
        )
