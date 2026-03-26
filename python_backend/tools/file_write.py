import logging
from pathlib import Path
from typing import Optional

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 10 * 1024 * 1024


class FileWriteTool(BaseTool):
    name: str = "file_write"
    description: str = "Write content to a local file"
    category: str = "workspace"
    read_only: bool = False
    risk_level: str = "high"
    preferred_order: int = 80
    use_when: str = "Use when you need to create or overwrite a workspace file with explicit content."
    avoid_when: str = "Avoid for document inspection, searching, or when a read-only tool can answer the task."
    user_summary_template: str = "Writing file {path}"
    result_preview_fields = ["event", "path", "change"]
    tags = ["filesystem", "write"]
    parameters: dict = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace"
            },
            "content": {
                "type": "string",
                "description": "The content to write to the file"
            },
            "encoding": {
                "type": "string",
                "description": "The encoding to use when writing the file (default: utf-8)",
                "default": "utf-8",
            }
        },
        "required": ["path", "content"]
    }
    require_confirmation: bool = True

    async def execute(
        self,
        path: str,
        content: str,
        tool_call_id: str = "",
        encoding: str = "utf-8",
        workspace_path: Optional[str] = None,
        **kwargs,
    ) -> ToolResult:
        try:
            file_path, resolve_error = resolve_workspace_path(
                path,
                workspace_path,
                require_absolute_without_workspace=True,
            )
            if resolve_error or file_path is None:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=resolve_error or "Invalid path",
                )

            try:
                encoded_content = content.encode(encoding)
            except LookupError:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Unknown encoding: {encoding}",
                )
            except UnicodeEncodeError as e:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Failed to encode content with encoding '{encoding}': {str(e)}",
                )

            content_size = len(encoded_content)
            if content_size > MAX_FILE_SIZE:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Content too large: {content_size} bytes (max: {MAX_FILE_SIZE} bytes)",
                )

            existed_before_write = file_path.exists()
            file_path.parent.mkdir(parents=True, exist_ok=True)

            file_path.write_bytes(encoded_content)

            logger.info("Successfully wrote to file: %s", file_path)

            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=True,
                output={
                    "event": "file_write",
                    "path": str(file_path),
                    "change": "updated" if existed_before_write else "created",
                },
            )

        except Exception as e:
            logger.error("Failed to write file %s: %s", path, str(e))
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(e),
            )
