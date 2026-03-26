from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

MAX_EXCERPT_CHARS = 64 * 1024
MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024


class ReadFileExcerptTool(BaseTool):
    name = "read_file_excerpt"
    description = (
        "Read a narrow excerpt from a workspace file by line, character, or page range. "
        "Prefer this when you need only a relevant section instead of the full file."
    )
    display_name = "Read File Excerpt"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 12
    use_when = "Use when you know the target file and only need a limited region of its content."
    avoid_when = "Avoid when you need the entire file or need to locate relevant content first."
    user_summary_template = "Reading excerpt from {path}"
    result_preview_fields = ["summary", "content"]
    tags = ["document", "safe-read", "excerpt"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "unit": {
                "type": "string",
                "enum": ["line", "char", "page"],
                "default": "line",
            },
            "start": {
                "type": "integer",
                "description": "Inclusive start offset",
            },
            "end": {
                "type": "integer",
                "description": "Inclusive end offset",
            },
            "encoding": {
                "type": "string",
                "default": "utf-8",
            },
        },
        "required": ["path", "start", "end"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        path: str,
        start: int,
        end: int,
        unit: str = "line",
        encoding: str = "utf-8",
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        **_: Any,
    ) -> ToolResult:
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
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"File not found: {path}",
            )

        if not file_path.is_file():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Path is not a file: {file_path}",
            )

        try:
            start_value = int(start)
            end_value = int(end)
        except (TypeError, ValueError):
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Start and end must be integers",
            )

        if start_value < 1 or end_value < start_value:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Invalid range: start must be >= 1 and end must be >= start",
            )

        if unit == "page":
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Page-based excerpts are not supported for this file type in the current implementation",
            )

        try:
            file_size = file_path.stat().st_size
        except OSError as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )

        if file_size > MAX_TEXT_FILE_BYTES:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"File too large: {file_size} bytes (max: {MAX_TEXT_FILE_BYTES} bytes)",
            )

        try:
            content = file_path.read_text(encoding=encoding)
        except UnicodeDecodeError as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Failed to decode file with encoding '{encoding}': {exc}",
            )
        except OSError as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )

        truncated = False
        summary: dict[str, Any]
        if unit == "char":
            excerpt = content[start_value - 1:end_value]
            if len(excerpt) > MAX_EXCERPT_CHARS:
                excerpt = excerpt[:MAX_EXCERPT_CHARS]
                truncated = True
            summary = {"char_count": len(excerpt)}
        else:
            lines = content.splitlines()
            excerpt_lines = lines[start_value - 1:end_value]
            excerpt = "\n".join(excerpt_lines)
            if len(excerpt) > MAX_EXCERPT_CHARS:
                excerpt = excerpt[:MAX_EXCERPT_CHARS]
                truncated = True
            summary = {"line_count": len(excerpt_lines)}

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "file_excerpt",
                "path": str(file_path),
                "unit": unit,
                "start": start_value,
                "end": end_value,
                "truncated": truncated,
                "content": excerpt,
                "summary": summary,
            },
        )
