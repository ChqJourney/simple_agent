import logging
from pathlib import Path
from typing import Optional, Tuple

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
                "description": "Absolute path or path relative to current workspace"
            },
            "content": {
                "type": "string",
                "description": "The content to write to the file"
            }
        },
        "required": ["path", "content"]
    }
    require_confirmation: bool = True

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

        if not input_path.is_absolute():
            return None, f"Path must be absolute when workspace is unavailable: {path}"

        return input_path.resolve(), None

    async def execute(
        self,
        path: str,
        content: str,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        **kwargs,
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

            content_size = len(content.encode("utf-8"))
            if content_size > MAX_FILE_SIZE:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Content too large: {content_size} bytes (max: {MAX_FILE_SIZE} bytes)",
                )

            file_path.parent.mkdir(parents=True, exist_ok=True)

            if content and not content.endswith("\n"):
                content = content + "\n"

            file_path.write_text(content, encoding="utf-8")

            logger.info("Successfully wrote to file: %s", file_path)

            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=True,
                output=f"Successfully wrote to {file_path}",
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


