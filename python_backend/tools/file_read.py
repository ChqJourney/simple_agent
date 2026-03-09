from pathlib import Path
from typing import Any
from .base import BaseTool, ToolResult


class FileReadTool(BaseTool):
    name: str = "file_read"
    description: str = "Read content from a local file"
    parameters: dict = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The absolute path to the file to read"
            }
        },
        "required": ["path"]
    }
    require_confirmation: bool = False

    async def execute(self, path: str, tool_call_id: str = "", **kwargs) -> ToolResult:
        try:
            file_path = Path(path)

            if not file_path.exists():
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"File not found: {path}"
                )

            if not file_path.is_file():
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Path is not a file: {path}"
                )

            content = file_path.read_text(encoding='utf-8')

            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=True,
                output=content
            )

        except Exception as e:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(e)
            )