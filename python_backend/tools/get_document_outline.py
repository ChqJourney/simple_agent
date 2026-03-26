from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

MAX_OUTLINE_FILE_BYTES = 5 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".md", ".txt", ".rst"}
MARKDOWN_HEADING_RE = re.compile(r"^(#{1,6})\s+(?P<title>.+?)\s*$")
NUMBERED_HEADING_RE = re.compile(r"^(?P<number>\d+(?:\.\d+){0,5})[\s.)-]+(?P<title>.+?)\s*$")


class GetDocumentOutlineTool(BaseTool):
    name = "get_document_outline"
    description = (
        "Extract a lightweight structural outline from a text-like document. "
        "Prefer this before clause-level reading when you need section structure."
    )
    display_name = "Get Document Outline"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 13
    use_when = "Use when you need heading structure, section anchors, or approximate clause boundaries."
    avoid_when = "Avoid when the file is unsupported or when you only need a simple keyword search."
    user_summary_template = "Extracting document outline from {path}"
    result_preview_fields = ["summary", "nodes"]
    tags = ["document", "outline", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "max_nodes": {
                "type": "integer",
                "default": 200,
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    @staticmethod
    def _make_anchor(text: str) -> str:
        anchor = re.sub(r"[^\w\s-]", "", text.lower()).strip()
        anchor = re.sub(r"[\s_]+", "-", anchor)
        return anchor

    async def execute(
        self,
        path: str,
        max_nodes: int = 200,
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

        if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Unsupported file type for outline extraction: {file_path.suffix or '(none)'}",
            )

        try:
            normalized_max_nodes = max(1, min(1000, int(max_nodes)))
        except (TypeError, ValueError):
            normalized_max_nodes = 200

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

        if file_size > MAX_OUTLINE_FILE_BYTES:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"File too large: {file_size} bytes (max: {MAX_OUTLINE_FILE_BYTES} bytes)",
            )

        try:
            lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )

        nodes: List[Dict[str, Any]] = []
        for line_number, line in enumerate(lines, start=1):
            markdown_match = MARKDOWN_HEADING_RE.match(line)
            if markdown_match:
                title = markdown_match.group("title").strip()
                nodes.append(
                    {
                        "title": title,
                        "level": len(markdown_match.group(1)),
                        "anchor": self._make_anchor(title),
                        "line_start": line_number,
                        "line_end": line_number,
                    }
                )
            else:
                numbered_match = NUMBERED_HEADING_RE.match(line)
                if numbered_match:
                    number = numbered_match.group("number")
                    title = numbered_match.group("title").strip()
                    nodes.append(
                        {
                            "title": f"{number} {title}".strip(),
                            "level": number.count(".") + 1,
                            "anchor": self._make_anchor(f"{number} {title}"),
                            "line_start": line_number,
                            "line_end": line_number,
                        }
                    )

            if len(nodes) >= normalized_max_nodes:
                break

        for index, node in enumerate(nodes):
            next_line_start = nodes[index + 1]["line_start"] if index + 1 < len(nodes) else len(lines) + 1
            node["line_end"] = max(node["line_start"], next_line_start - 1)

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "document_outline",
                "path": str(file_path),
                "truncated": len(nodes) >= normalized_max_nodes,
                "nodes": nodes[:normalized_max_nodes],
                "summary": {
                    "node_count": len(nodes[:normalized_max_nodes]),
                    "max_level": max((node["level"] for node in nodes[:normalized_max_nodes]), default=0),
                },
            },
        )
