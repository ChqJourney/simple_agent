import os
import sys
from pathlib import Path
from typing import Mapping

EMBEDDED_PYTHON_ENV_VAR = "TAURI_AGENT_EMBEDDED_PYTHON"
EMBEDDED_NODE_ENV_VAR = "TAURI_AGENT_EMBEDDED_NODE"


def _configured_root(env_var: str) -> Path | None:
    raw_value = os.environ.get(env_var)
    if not raw_value:
        return None

    normalized = raw_value.strip()
    if not normalized:
        return None

    return Path(normalized)


def _validate_embedded_executable(path: Path, runtime_name: str) -> Path:
    if not path.exists():
        raise RuntimeError(f"Configured embedded {runtime_name} executable is missing: {path}")
    return path


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

    return _validate_embedded_executable(_embedded_executable_path(embedded_root, "python.exe"), "python")


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

    return _validate_embedded_executable(_embedded_executable_path(embedded_root, "node.exe"), "node")


def get_npm_command() -> list[str]:
    embedded_root = _configured_root(EMBEDDED_NODE_ENV_VAR)
    if embedded_root is None:
        return ["npm"]

    command = _embedded_executable_path(embedded_root, "npm.cmd")
    return [str(_validate_embedded_executable(command, "node"))]


def get_npx_command() -> list[str]:
    embedded_root = _configured_root(EMBEDDED_NODE_ENV_VAR)
    if embedded_root is None:
        return ["npx"]

    command = _embedded_executable_path(embedded_root, "npx.cmd")
    return [str(_validate_embedded_executable(command, "node"))]
