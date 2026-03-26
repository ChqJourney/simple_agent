import uuid
from typing import Any, Dict, List, Optional

from .base import BaseTool, ToolResult

ALLOWED_ACTIONS = {"create", "update", "complete", "remove"}
ALLOWED_STATUS = {"pending", "in_progress", "completed", "failed"}


def _normalize_task(candidate: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(candidate.get("id") or uuid.uuid4()),
        "content": str(candidate.get("content") or ""),
        "status": str(candidate.get("status") or "pending"),
    }


class TodoTaskTool(BaseTool):
    name = "todo_task"
    description = "Create or update a task entry that matches the workspace task list UI"
    display_name = "Todo Task"
    category = "task"
    read_only = True
    risk_level = "low"
    preferred_order = 60
    use_when = "Use when you need to reflect plan progress in the task list UI."
    avoid_when = "Avoid when the action does not change user-visible task state."
    user_summary_template = "Updating task list"
    result_preview_fields = ["event", "action", "task"]
    tags = ["task", "ui-state"]
    parameters = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["create", "update", "complete", "remove"],
                "description": "Task operation to perform",
            },
            "task_id": {
                "type": "string",
                "description": "Existing task identifier when updating or removing",
            },
            "content": {
                "type": "string",
                "description": "Primary task content",
            },
            "status": {
                "type": "string",
                "enum": ["pending", "in_progress", "completed", "failed"],
                "description": "Task status to display",
                "default": "pending",
            },
            "sub_tasks": {
                "type": "array",
                "items": {"type": "object"},
                "description": "Optional nested tasks",
            },
        },
        "required": ["action"],
    }

    async def execute(
        self,
        action: str,
        tool_call_id: str = "",
        task_id: Optional[str] = None,
        content: str = "",
        status: str = "pending",
        sub_tasks: Optional[List[Dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> ToolResult:
        if action not in ALLOWED_ACTIONS:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Invalid value for 'action': {action}",
            )

        if status not in ALLOWED_STATUS:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Invalid value for 'status': {status}",
            )

        task = {
            "id": task_id or str(uuid.uuid4()),
            "content": content,
            "status": status,
            "subTasks": [_normalize_task(item) for item in (sub_tasks or [])],
        }
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "todo_task",
                "action": action,
                "task": task,
            },
            metadata={"ui_target": "task_list"},
        )
