import logging
from pathlib import Path
from typing import Any
from .base import BaseTool, ToolResult

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


class FileReadTool(BaseTool):
    name: str = "file_read"
    description: str = "Read content from a local file"
    parameters: dict = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The absolute path to the file to read"
            },
            "encoding": {
                "type": "string",
                "description": "The encoding to use when reading the file (default: utf-8)",
                "default": "utf-8"
            }
        },
        "required": ["path"]
    }
    require_confirmation: bool = False

    async def execute(self, path: str, tool_call_id: str = "", encoding: str = "utf-8", **kwargs) -> ToolResult:
        try:
            if ".." in path:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error="Path traversal not allowed"
                )

            file_path = Path(path).resolve()

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

            file_size = file_path.stat().st_size
            if file_size > MAX_FILE_SIZE:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"File too large: {file_size} bytes (max: {MAX_FILE_SIZE} bytes)"
                )

            try:
                content = file_path.read_text(encoding=encoding)
            except UnicodeDecodeError as e:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Failed to decode file with encoding '{encoding}': {str(e)}"
                )

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
