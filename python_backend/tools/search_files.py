from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024
TEXT_EXTENSIONS = {
    ".md",
    ".txt",
    ".rst",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".csv",
    ".log",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".sql",
}


class SearchFilesTool(BaseTool):
    name = "search_files"
    description = (
        "Search across workspace files and return structured matches with context. "
        "Prefer this over shell search commands when locating terms, clause numbers, or identifiers."
    )
    display_name = "Search Files"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 11
    use_when = "Use when you need to locate keywords, clause numbers, identifiers, or repeated phrases across files."
    avoid_when = "Avoid when you already know the exact file and range you want to read."
    user_summary_template = "Searching files for {query}"
    result_preview_fields = ["summary", "results"]
    tags = ["document", "search", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search term or regular expression",
            },
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
                "default": ".",
            },
            "mode": {
                "type": "string",
                "enum": ["plain", "regex"],
                "default": "plain",
            },
            "file_glob": {
                "type": "string",
                "description": "Optional glob pattern such as '*.md'",
            },
            "case_sensitive": {
                "type": "boolean",
                "default": False,
            },
            "max_results": {
                "type": "integer",
                "default": 50,
            },
            "context_lines": {
                "type": "integer",
                "default": 2,
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    @staticmethod
    def _is_text_candidate(path: Path) -> bool:
        return path.suffix.lower() in TEXT_EXTENSIONS

    async def execute(
        self,
        query: str,
        path: str = ".",
        mode: str = "plain",
        file_glob: Optional[str] = None,
        case_sensitive: bool = False,
        max_results: int = 50,
        context_lines: int = 2,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        **_: Any,
    ) -> ToolResult:
        root_path, resolve_error = resolve_workspace_path(path, workspace_path)
        if resolve_error or root_path is None:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=resolve_error or "Invalid path",
            )

        if not query.strip():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Query is empty",
            )

        if not root_path.exists():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Path not found: {path}",
            )

        search_root = root_path if root_path.is_dir() else root_path.parent
        candidate_files: List[Path] = []
        if root_path.is_file():
            candidate_files = [root_path]
        else:
            for candidate in search_root.rglob("*"):
                if not candidate.is_file():
                    continue
                if file_glob and not candidate.match(file_glob):
                    continue
                candidate_files.append(candidate)

        try:
            normalized_max_results = max(1, min(500, int(max_results)))
        except (TypeError, ValueError):
            normalized_max_results = 50
        try:
            normalized_context_lines = max(0, min(10, int(context_lines)))
        except (TypeError, ValueError):
            normalized_context_lines = 2

        flags = 0 if case_sensitive else re.IGNORECASE
        if mode == "regex":
            try:
                pattern = re.compile(query, flags)
            except re.error as exc:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Invalid regular expression: {exc}",
                )
        else:
            pattern = re.compile(re.escape(query), flags)

        results: List[Dict[str, Any]] = []
        matched_files: set[str] = set()
        skipped_binary = 0
        skipped_large = 0
        skipped_decode = 0
        truncated = False

        for candidate in sorted(candidate_files):
            if len(results) >= normalized_max_results:
                truncated = True
                break
            if not self._is_text_candidate(candidate):
                skipped_binary += 1
                continue
            try:
                stat = candidate.stat()
            except OSError:
                continue
            if stat.st_size > MAX_SEARCH_FILE_BYTES:
                skipped_large += 1
                continue
            try:
                lines = candidate.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            except UnicodeDecodeError:
                skipped_decode += 1
                continue

            for line_index, line in enumerate(lines, start=1):
                if len(results) >= normalized_max_results:
                    truncated = True
                    break
                match = pattern.search(line)
                if not match:
                    continue
                rel_path = (
                    candidate.relative_to(search_root if search_root.is_dir() else candidate.parent)
                    if root_path.is_dir()
                    else candidate.name
                )
                path_str = str(rel_path).replace("\\", "/")
                matched_files.add(path_str)
                context_before = "\n".join(lines[max(0, line_index - 1 - normalized_context_lines): line_index - 1])
                context_after = "\n".join(lines[line_index: line_index + normalized_context_lines])
                results.append(
                    {
                        "path": path_str,
                        "line": line_index,
                        "column": match.start() + 1,
                        "match_text": match.group(0),
                        "context_before": context_before,
                        "context_after": context_after,
                    }
                )

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "search_results",
                "query": query,
                "mode": mode,
                "truncated": truncated,
                "results": results,
                "summary": {
                    "hit_count": len(results),
                    "file_count": len(matched_files),
                    "skipped_binary_or_unsupported": skipped_binary,
                    "skipped_large": skipped_large,
                    "skipped_decode_errors": skipped_decode,
                },
            },
        )
