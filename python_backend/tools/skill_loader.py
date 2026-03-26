from __future__ import annotations

from typing import Optional

from skills.base import SkillProvider
from tools.base import BaseTool, ToolResult


class SkillLoaderTool(BaseTool):
    name = "skill_loader"
    description = "Load the full instructions for a local skill from the scanned skill catalog."
    category = "general"
    read_only = True
    risk_level = "low"
    preferred_order = 30
    use_when = "Use when a local skill may provide better workflow instructions for the task."
    avoid_when = "Avoid when the task can already be completed with the active instructions and tools."
    user_summary_template = "Loading skill {skill_name}"
    result_preview_fields = ["event", "skill"]
    tags = ["skill", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "skill_name": {
                "type": "string",
                "description": "The skill name from the local skill catalog metadata.",
            },
            "source": {
                "type": "string",
                "description": "Optional scope when the same skill exists in both app and workspace skill roots.",
                "enum": ["app", "workspace"],
            },
        },
        "required": ["skill_name"],
        "additionalProperties": False,
    }

    def __init__(self, skill_provider: SkillProvider) -> None:
        super().__init__()
        self.skill_provider = skill_provider

    async def execute(
        self,
        skill_name: str,
        workspace_path: str = "",
        source: Optional[str] = None,
        tool_call_id: str = "",
        **_: object,
    ) -> ToolResult:
        normalized_source = source if source in {"app", "workspace"} else None
        skill = self.skill_provider.load(
            skill_name=skill_name,
            workspace_path=workspace_path,
            source=normalized_source,
        )

        if skill is None:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Skill not found: {skill_name}",
            )

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "skill_loader",
                "skill": {
                    "name": skill.name,
                    "description": skill.description,
                    "source": skill.source,
                    "source_path": skill.source_path,
                    "frontmatter": skill.frontmatter,
                    "content": skill.content,
                },
            },
            error=None,
            metadata={"ui_target": "skill_loader"},
        )
