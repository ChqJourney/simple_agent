import logging
from pathlib import Path
from typing import Any, Optional, Tuple

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

    @staticmethod
    def _is_within_workspace(target_path: Path, workspace_root: Path) -> bool:
        try:
            target_path.relative_to(workspace_root)
            return True
        except ValueError:
            return False

    @staticmethod
    def _linux_placeholder_candidate(path: str, workspace_root: Optional[Path]) -> Optional[Path]:
        if not workspace_root:
            return None

        normalized = path.replace("\\", "/")
        for prefix in ("/home/user/", "/workspace/"):
            if normalized.startswith(prefix):
                rel = normalized[len(prefix):].lstrip("/")
                if rel:
                    return (workspace_root / rel).resolve()
        return None

    def _resolve_path(self, path: str, workspace_path: Optional[str]) -> Tuple[Optional[Path], Optional[str]]:
        raw = path.strip()
        if not raw:
            return None, "Path is empty"

        if "\x00" in raw:
            return None, "Invalid path"

        workspace_root: Optional[Path] = Path(workspace_path).resolve() if workspace_path else None

        placeholder_candidate = self._linux_placeholder_candidate(raw, workspace_root)
        if placeholder_candidate is not None:
            if workspace_root and not self._is_within_workspace(placeholder_candidate, workspace_root):
                return None, f"Path must be inside workspace: {workspace_root}"
            return placeholder_candidate, None

        input_path = Path(raw)

        if workspace_root:
            if input_path.is_absolute():
                resolved = input_path.resolve()
            else:
                resolved = (workspace_root / input_path).resolve()

            if not self._is_within_workspace(resolved, workspace_root):
                return None, f"Path must be inside workspace: {workspace_root}"

            return resolved, None

        return input_path.resolve(), None

    async def execute(
        self,
        path: str,
        tool_call_id: str = "",
        encoding: str = "utf-8",
        workspace_path: Optional[str] = None,
        **kwargs: Any,
    ) -> ToolResult:
        try:
            file_path, resolve_error = self._resolve_path(path, workspace_path)
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


