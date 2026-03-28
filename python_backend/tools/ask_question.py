from typing import Any, List, Optional

from .base import BaseTool, ToolResult


class AskQuestionTool(BaseTool):
    name = "ask_question"
    description = (
        "Pause execution to request clarification or approval from the user. "
        "Ask one short, concrete question. Use `details` for brief supporting context. "
        "If you provide `options`, the UI renders them as quick-reply buttons; when you omit `options`, "
        "the user can answer with free text. Prefer 2-5 distinct options when the next step is a choice."
    )
    display_name = "Ask Question"
    category = "interaction"
    read_only = True
    risk_level = "low"
    preferred_order = 70
    use_when = "Use when the assistant genuinely needs a user answer or choice to continue."
    avoid_when = "Avoid when the answer can be inferred from the workspace or prior conversation."
    user_summary_template = "Asking the user a follow-up question"
    result_preview_fields = ["event", "question", "options"]
    tags = ["interaction", "user-input"]
    parameters = {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": (
                    "A single, user-facing question. Keep it short, specific, and directly tied to the next decision."
                ),
            },
            "details": {
                "type": "string",
                "description": (
                    "Optional brief context shown beneath the question, such as tradeoffs, assumptions, or why the answer matters."
                ),
            },
            "options": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional suggested choices. These render as clickable quick-reply buttons in the UI. "
                    "Omit this field when you need an open-ended free-text answer."
                ),
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
