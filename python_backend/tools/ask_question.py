from typing import Any, List, Optional

from .base import BaseTool, ToolResult


class AskQuestionTool(BaseTool):
    name = "ask_question"
    description = "Pause execution to request clarification or approval from the user"
    display_name = "Ask Question"
    category = "interaction"
    parameters = {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "Question to present to the user",
            },
            "details": {
                "type": "string",
                "description": "Extra context shown beneath the question",
            },
            "options": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Suggested user choices",
            },
        },
        "required": ["question"],
    }

    async def execute(
        self,
        question: str,
        tool_call_id: str = "",
        details: Optional[str] = None,
        options: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> ToolResult:
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "pending_question",
                "question": question,
                "details": details or "",
                "options": options or [],
            },
            metadata={"ui_target": "question_prompt"},
        )
