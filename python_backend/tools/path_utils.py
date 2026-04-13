from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional, Tuple


def is_within_workspace(target_path: Path, workspace_root: Path) -> bool:
    try:
        target_path.relative_to(workspace_root)
        return True
    except ValueError:
        return False


def find_containing_root(target_path: Path, roots: Iterable[Path]) -> Optional[Path]:
    for root in roots:
        if is_within_workspace(target_path, root):
            return root
    return None


def linux_placeholder_candidate(path: str, workspace_root: Optional[Path]) -> Optional[Path]:
    if not workspace_root:
        return None

    normalized = path.replace("\\", "/")
    for prefix in ("/home/user/", "/workspace/"):
        if normalized.startswith(prefix):
            rel = normalized[len(prefix):].lstrip("/")
            if rel:
                return (workspace_root / rel).resolve()
    return None


def resolve_workspace_path(
    path: str,
    workspace_path: Optional[str],
    *,
    require_absolute_without_workspace: bool = False,
) -> Tuple[Optional[Path], Optional[str]]:
    raw = path.strip()
    if not raw:
        return None, "Path is empty"

    if "\x00" in raw:
        return None, "Invalid path"

    workspace_root: Optional[Path] = Path(workspace_path).resolve() if workspace_path else None

    placeholder = linux_placeholder_candidate(raw, workspace_root)
    if placeholder is not None:
        if workspace_root and not is_within_workspace(placeholder, workspace_root):
            return None, f"Path must be inside workspace: {workspace_root}"
        return placeholder, None

    input_path = Path(raw)

    if workspace_root:
        resolved = input_path.resolve() if input_path.is_absolute() else (workspace_root / input_path).resolve()
        if not is_within_workspace(resolved, workspace_root):
            return None, f"Path must be inside workspace: {workspace_root}"
        return resolved, None

    if require_absolute_without_workspace and not input_path.is_absolute():
        return None, f"Path must be absolute when workspace is unavailable: {path}"

    return input_path.resolve(), None


def resolve_path_in_root(path: str, root_path: Path) -> Tuple[Optional[Path], Optional[str]]:
    raw = path.strip()
    if not raw:
        return None, "Path is empty"

    if "\x00" in raw:
        return None, "Invalid path"

    input_path = Path(raw)
    resolved = input_path.resolve() if input_path.is_absolute() else (root_path / input_path).resolve()
    if not is_within_workspace(resolved, root_path):
        return None, f"Path must be inside reference library root: {root_path}"

    return resolved, None
