import logging
from pathlib import Path
from typing import Any, Optional

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


class FileReadTool(BaseTool):
    name: str = "file_read"
    description: str = "Read content from a local file"
    category: str = "workspace"
    read_only: bool = True
    risk_level: str = "low"
    preferred_order: int = 20
    use_when: str = "Use when you already know the exact file path and need the full text of a reasonably small file."
    avoid_when: str = "Avoid when you first need to inspect folder structure, search across files, or read only a narrow excerpt."
    user_summary_template: str = "Reading file {path}"
    result_preview_fields = ["output"]
    tags = ["document", "filesystem", "safe-read"]
    parameters: dict = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace"
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

    async def execute(
        self,
        path: str,
        tool_call_id: str = "",
        encoding: str = "utf-8",
        workspace_path: Optional[str] = None,
        **kwargs: Any,
    ) -> ToolResult:
        try:
            file_path, resolve_error = resolve_workspace_path(path, workspace_path)
            if resolve_error or file_path is None:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=resolve_error or "Invalid path",
                )

            if not file_path.exists():
                workspace_hint = f" Workspace: {workspace_path}" if workspace_path else ""
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"File not found: {path}.{workspace_hint}",
                )

            if not file_path.is_file():
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Path is not a file: {file_path}",
                )

            file_size = file_path.stat().st_size
            if file_size > MAX_FILE_SIZE:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"File too large: {file_size} bytes (max: {MAX_FILE_SIZE} bytes)",
                )

            try:
                content = file_path.read_text(encoding=encoding)
            except UnicodeDecodeError as e:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Failed to decode file with encoding '{encoding}': {str(e)}",
                )

            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=True,
                output=content,
            )

        except Exception as e:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(e),
            )

