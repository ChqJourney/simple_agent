import logging
import os
import sys
from pathlib import Path
from typing import Mapping

EMBEDDED_PYTHON_ENV_VAR = "TAURI_AGENT_EMBEDDED_PYTHON"
EMBEDDED_NODE_ENV_VAR = "TAURI_AGENT_EMBEDDED_NODE"

logger = logging.getLogger(__name__)


def _configured_root(env_var: str) -> Path | None:
    raw_value = os.environ.get(env_var)
    if not raw_value:
        return None

    normalized = raw_value.strip()
    if not normalized:
        return None

    resolved = Path(normalized)
    if resolved.is_dir():
        return resolved

    logger.warning(
        "Environment variable %s is set to '%s' but the directory does not exist; "
        "falling back to system runtime.",
        env_var,
        normalized,
    )
    return None


def _validate_embedded_executable(path: Path, runtime_name: str) -> Path | None:
    if path.exists():
        return path
    logger.warning(
        "Configured embedded %s executable is missing: %s; falling back to system runtime.",
        runtime_name,
        path,
    )
    return None


def _embedded_executable_path(root: Path, executable_name: str) -> Path:
    raw_root = str(root)
    if "\\" in raw_root and "/" not in raw_root:
        trimmed_root = raw_root.rstrip("\\")
        return Path(f"{trimmed_root}\\{executable_name}")
    return root / executable_name


def get_python_executable() -> Path:
    embedded_root = _configured_root(EMBEDDED_PYTHON_ENV_VAR)
    if embedded_root is None:
        return Path(sys.executable)

    result = _validate_embedded_executable(_embedded_executable_path(embedded_root, "python.exe"), "python")
    return result if result is not None else Path(sys.executable)


def get_pip_command() -> list[str]:
    python_executable = get_python_executable()
    return [str(python_executable), "-m", "pip"]


def build_runtime_environment(base_env: Mapping[str, str] | None = None) -> dict[str, str]:
    env = dict(base_env or os.environ)
    path_entries: list[str] = []

    embedded_python = _configured_root(EMBEDDED_PYTHON_ENV_VAR)
    if embedded_python is not None:
        path_entries.append(str(embedded_python))
        scripts_dir = embedded_python / "Scripts"
        if scripts_dir.is_dir():
            path_entries.append(str(scripts_dir))

    embedded_node = _configured_root(EMBEDDED_NODE_ENV_VAR)
    if embedded_node is not None:
        path_entries.append(str(embedded_node))

    if path_entries:
        existing_path = env.get("PATH", "")
        env["PATH"] = os.pathsep.join(
            [*path_entries, *([existing_path] if existing_path else [])]
        )

    return env


def get_node_executable() -> Path:
    embedded_root = _configured_root(EMBEDDED_NODE_ENV_VAR)
    if embedded_root is None:
        return Path("node")

    result = _validate_embedded_executable(_embedded_executable_path(embedded_root, "node.exe"), "node")
    return result if result is not None else Path("node")


def get_npm_command() -> list[str]:
    embedded_root = _configured_root(EMBEDDED_NODE_ENV_VAR)
    if embedded_root is None:
        return ["npm"]

    command = _embedded_executable_path(embedded_root, "npm.cmd")
    result = _validate_embedded_executable(command, "node")
    if result is not None:
        return [str(result)]
    return ["npm"]


def get_npx_command() -> list[str]:
    embedded_root = _configured_root(EMBEDDED_NODE_ENV_VAR)
    if embedded_root is None:
        return ["npx"]

    command = _embedded_executable_path(embedded_root, "npx.cmd")
    result = _validate_embedded_executable(command, "node")
    if result is not None:
        return [str(result)]
    return ["npx"]
