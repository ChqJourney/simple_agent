import logging
from pathlib import Path
from typing import Optional
from .base import BaseTool, ToolResult

logger = logging.getLogger(__name__)


class FileWriteTool(BaseTool):
    name: str = "file_write"
    description: str = "Write content to a local file"
    parameters: dict = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The absolute path to the file to write"
            },
            "content": {
                "type": "string",
                "description": "The content to write to the file"
            }
        },
        "required": ["path", "content"]
    }
    require_confirmation: bool = True

    async def execute(self, path: str, content: str, tool_call_id: str = "", **kwargs) -> ToolResult:
        if ".." in path:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Path traversal not allowed: paths with '..' are not permitted"
            )

        try:
            file_path = Path(path).resolve()

            file_path.parent.mkdir(parents=True, exist_ok=True)

            file_path.write_text(content, encoding='utf-8')

            logger.info(f"Successfully wrote to file: {path}")

            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=True,
                output=f"Successfully wrote to {path}"
            )

        except Exception as e:
            logger.error(f"Failed to write file {path}: {str(e)}")
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(e)
            )