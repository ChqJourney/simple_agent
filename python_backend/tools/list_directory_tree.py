from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import BaseTool, ToolResult
from .path_utils import is_within_workspace, resolve_workspace_path


class ListDirectoryTreeTool(BaseTool):
    name = "list_directory_tree"
    description = (
        "List files and folders in a workspace directory as structured metadata. "
        "Prefer this before broad file reads or fallback shell commands when you need to understand the workspace layout."
    )
    display_name = "List Directory Tree"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 10
    use_when = "Use when you first need to understand which files and directories exist in the workspace."
    avoid_when = "Avoid when you already know the exact file path or only need file content."
    user_summary_template = "Scanning directory {path}"
    result_preview_fields = ["summary", "entries"]
    tags = ["document", "filesystem", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
                "default": ".",
            },
            "max_depth": {
                "type": "integer",
                "description": "Maximum directory depth to traverse",
                "default": 3,
            },
            "include_hidden": {
                "type": "boolean",
                "description": "Whether to include hidden files and directories",
                "default": False,
            },
            "file_glob": {
                "type": "string",
                "description": "Optional glob pattern such as '*.pdf' or '*.md'",
            },
            "max_entries": {
                "type": "integer",
                "description": "Maximum number of entries to return",
                "default": 500,
            },
        },
        "required": [],
        "additionalProperties": False,
    }

    async def execute(
        self,
        path: str = ".",
        max_depth: int = 3,
        include_hidden: bool = False,
        file_glob: Optional[str] = None,
        max_entries: int = 500,
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

        if not root_path.exists():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Path not found: {path}",
            )

        if not root_path.is_dir():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Path is not a directory: {root_path}",
            )

        try:
            normalized_depth = max(0, int(max_depth))
        except (TypeError, ValueError):
            normalized_depth = 3
        try:
            normalized_max_entries = max(1, min(5000, int(max_entries)))
        except (TypeError, ValueError):
            normalized_max_entries = 500

        entries: List[Dict[str, Any]] = []
        extension_counter: Counter[str] = Counter()
        directory_count = 0
        file_count = 0
        truncated = False

        def should_include(entry_path: Path) -> bool:
            if include_hidden:
                return True
            return not any(part.startswith(".") for part in entry_path.relative_to(root_path).parts)

        def walk(current_path: Path) -> None:
            nonlocal directory_count, file_count, truncated
            if truncated:
                return

            try:
                children = sorted(current_path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
            except OSError:
                return

            for child in children:
                if truncated:
                    return
                if child == root_path:
                    continue
                try:
                    child_resolved = child.resolve()
                except (OSError, RuntimeError):
                    continue
                if not is_within_workspace(child_resolved, root_path):
                    continue
                if not should_include(child):
                    continue

                rel_path = child.relative_to(root_path)
                child_depth = len(rel_path.parts)
                if child_depth > normalized_depth:
                    continue

                if child.is_file() and file_glob and not child.match(file_glob):
                    continue

                try:
                    stat = child.stat()
                except OSError:
                    continue

                entry_type = "directory" if child.is_dir() else "file"
                if child.is_dir():
                    directory_count += 1
                else:
                    file_count += 1
                    extension_counter[child.suffix.lower() or "(none)"] += 1

                entries.append(
                    {
                        "path": str(rel_path).replace("\\", "/"),
                        "type": entry_type,
                        "extension": child.suffix.lower() if child.is_file() else "",
                        "size_bytes": stat.st_size if child.is_file() else None,
                        "modified_at": stat.st_mtime_ns,
                        "depth": child_depth,
                    }
                )

                if len(entries) >= normalized_max_entries:
                    truncated = True
                    return

                if child.is_dir() and child_depth < normalized_depth:
                    walk(child)

        walk(root_path)

        normalized_entries: List[Dict[str, Any]] = []
        for entry in entries:
            modified_at_ns = entry.pop("modified_at", None)
            modified_at = None
            if isinstance(modified_at_ns, int):
                modified_at = datetime.fromtimestamp(
                    modified_at_ns / 1_000_000_000,
                    tz=timezone.utc,
                ).isoformat().replace("+00:00", "Z")
            normalized_entries.append({**entry, "modified_at": modified_at})

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "directory_tree",
                "root": str(root_path),
                "truncated": truncated,
                "entries": normalized_entries,
                "summary": {
                    "file_count": file_count,
                    "directory_count": directory_count,
                    "top_extensions": [[ext, count] for ext, count in extension_counter.most_common(10)],
                },
            },
        )
