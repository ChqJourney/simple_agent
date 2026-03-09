import logging
from pathlib import Path
from typing import Optional
from .base import BaseTool, ToolResult

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 10 * 1024 * 1024


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
                error="Path traversal not allowed"
            )

        try:
            if not Path(path).is_absolute():
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Path must be absolute: {path}"
                )

            file_path = Path(path).resolve()

            content_size = len(content.encode('utf-8'))
            if content_size > MAX_FILE_SIZE:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Content too large: {content_size} bytes (max: {MAX_FILE_SIZE} bytes)"
                )

            file_path.parent.mkdir(parents=True, exist_ok=True)

            if content and not content.endswith('\n'):
                content = content + '\n'

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