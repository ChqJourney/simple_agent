import hashlib
import os
import shlex
import shutil
import stat
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

EMBEDDED_PYTHON_ENV_VAR = "TAURI_AGENT_EMBEDDED_PYTHON"
EMBEDDED_NODE_ENV_VAR = "TAURI_AGENT_EMBEDDED_NODE"
STRICT_RUNTIME_ENV_VAR = "TAURI_AGENT_RUNTIME_STRICT"
PYTHON_NO_USER_SITE_ENV_VAR = "PYTHONNOUSERSITE"
PIP_DISABLE_VERSION_CHECK_ENV_VAR = "PIP_DISABLE_PIP_VERSION_CHECK"
LOCAL_PATH_TYPE = type(Path())


@dataclass(frozen=True)
class RuntimeCommand:
    name: str
    command: tuple[str, ...]
    source: str
    root: Path | None = None

    @property
    def executable(self) -> Path:
        return LOCAL_PATH_TYPE(self.command[0])

    def as_list(self) -> list[str]:
        return list(self.command)


@dataclass(frozen=True)
class RuntimeBundle:
    python: RuntimeCommand
    pip: RuntimeCommand
    node: RuntimeCommand
    npm: RuntimeCommand
    npx: RuntimeCommand
    strict: bool
    path_entries: tuple[str, ...]


def _configured_root(env_var: str, env: Mapping[str, str]) -> Path | None:
    raw_value = env.get(env_var)
    if not raw_value:
        return None

    normalized = raw_value.strip()
    if not normalized:
        return None

    return LOCAL_PATH_TYPE(normalized)


def _validate_executable(path: Path, runtime_name: str) -> Path:
    if not path.exists():
        raise RuntimeError(f"Configured embedded {runtime_name} executable is missing: {path}")
    return path


def _resolve_existing_command(command_name: str) -> Path | None:
    resolved = shutil.which(command_name)
    return LOCAL_PATH_TYPE(resolved) if resolved else None


def _is_truthy(raw_value: str | None) -> bool:
    if raw_value is None:
        return False
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _strict_runtime_required(env: Mapping[str, str]) -> bool:
    return _is_truthy(env.get(STRICT_RUNTIME_ENV_VAR))


def _merged_env(base_env: Mapping[str, str] | None = None) -> dict[str, str]:
    if base_env is None:
        return dict(os.environ)
    return {**os.environ, **base_env}


def _candidate_path(root: Path, *segments: str) -> Path:
    raw_root = str(root)
    if "\\" in raw_root and "/" not in raw_root:
        trimmed = raw_root.rstrip("\\")
        return LOCAL_PATH_TYPE("\\".join([trimmed, *segments]))

    current = root
    for segment in segments:
        current = current / segment
    return current


def _resolve_embedded_path(root: Path, runtime_name: str, candidates: tuple[tuple[str, ...], ...]) -> Path:
    checked_paths: list[Path] = []
    for segments in candidates:
        candidate = _candidate_path(root, *segments)
        checked_paths.append(candidate)
        if candidate.exists():
            return candidate

    checked = ", ".join(str(path) for path in checked_paths)
    raise RuntimeError(
        f"Configured embedded {runtime_name} runtime is missing an executable under {root}. "
        f"Checked: {checked}"
    )


def _uses_windows_layout(root: Path) -> bool:
    raw_root = str(root)
    return "\\" in raw_root and "/" not in raw_root


def _python_candidates(root: Path) -> tuple[tuple[str, ...], ...]:
    if _uses_windows_layout(root):
        return (("python.exe",),)
    return (("bin", "python3"), ("bin", "python"))


def _node_candidates(root: Path) -> tuple[tuple[str, ...], ...]:
    if _uses_windows_layout(root):
        return (("node.exe",),)
    return (("bin", "node"),)


def _npm_candidates(root: Path, command_name: str) -> tuple[tuple[str, ...], ...]:
    if _uses_windows_layout(root):
        return ((f"{command_name}.cmd",),)
    return (("bin", command_name),)


def _runtime_root_entries(*roots: Path | None) -> tuple[str, ...]:
    entries: list[str] = []
    for root in roots:
        if root is None:
            continue
        normalized = str(root)
        if normalized not in entries:
            entries.append(normalized)
    return tuple(entries)


def _resolve_python_runtime(env: Mapping[str, str], strict: bool) -> tuple[RuntimeCommand, RuntimeCommand]:
    embedded_root = _configured_root(EMBEDDED_PYTHON_ENV_VAR, env)
    if embedded_root is not None:
        python_path = _resolve_embedded_path(embedded_root, "python", _python_candidates(embedded_root))
        python_command = RuntimeCommand(
            name="python",
            command=(str(_validate_executable(python_path, "python")),),
            source="embedded",
            root=embedded_root,
        )
        pip_command = RuntimeCommand(
            name="pip",
            command=(str(python_command.executable), "-m", "pip"),
            source="embedded",
            root=embedded_root,
        )
        return python_command, pip_command

    if strict:
        raise RuntimeError(
            f"Embedded Python runtime is required but {EMBEDDED_PYTHON_ENV_VAR} is not configured."
        )

    python_command = RuntimeCommand(
        name="python",
        command=(sys.executable,),
        source="current_process",
        root=LOCAL_PATH_TYPE(os.path.dirname(sys.executable)),
    )
    pip_command = RuntimeCommand(
        name="pip",
        command=(sys.executable, "-m", "pip"),
        source="current_process",
        root=LOCAL_PATH_TYPE(os.path.dirname(sys.executable)),
    )
    return python_command, pip_command


def _resolve_node_runtime(
    env: Mapping[str, str],
    strict: bool,
) -> tuple[RuntimeCommand, RuntimeCommand, RuntimeCommand]:
    embedded_root = _configured_root(EMBEDDED_NODE_ENV_VAR, env)
    if embedded_root is not None:
        node_path = _resolve_embedded_path(embedded_root, "node", _node_candidates(embedded_root))
        npm_path = _resolve_embedded_path(embedded_root, "npm", _npm_candidates(embedded_root, "npm"))
        npx_path = _resolve_embedded_path(embedded_root, "npx", _npm_candidates(embedded_root, "npx"))
        return (
            RuntimeCommand(
                name="node",
                command=(str(_validate_executable(node_path, "node")),),
                source="embedded",
                root=embedded_root,
            ),
            RuntimeCommand(
                name="npm",
                command=(str(_validate_executable(npm_path, "npm")),),
                source="embedded",
                root=embedded_root,
            ),
            RuntimeCommand(
                name="npx",
                command=(str(_validate_executable(npx_path, "npx")),),
                source="embedded",
                root=embedded_root,
            ),
        )

    if strict:
        raise RuntimeError(
            f"Embedded Node runtime is required but {EMBEDDED_NODE_ENV_VAR} is not configured."
        )

    resolved_node = _resolve_existing_command("node")
    resolved_npm = _resolve_existing_command("npm")
    resolved_npx = _resolve_existing_command("npx")
    return (
        RuntimeCommand(
            name="node",
            command=(str(resolved_node) if resolved_node else "node",),
            source="system_path",
            root=resolved_node.parent if resolved_node else None,
        ),
        RuntimeCommand(
            name="npm",
            command=(str(resolved_npm) if resolved_npm else "npm",),
            source="system_path",
            root=resolved_npm.parent if resolved_npm else None,
        ),
        RuntimeCommand(
            name="npx",
            command=(str(resolved_npx) if resolved_npx else "npx",),
            source="system_path",
            root=resolved_npx.parent if resolved_npx else None,
        ),
    )


def resolve_runtime_bundle(base_env: Mapping[str, str] | None = None) -> RuntimeBundle:
    env = _merged_env(base_env)
    strict = _strict_runtime_required(env)
    python_command, pip_command = _resolve_python_runtime(env, strict)
    node_command, npm_command, npx_command = _resolve_node_runtime(env, strict)

    return RuntimeBundle(
        python=python_command,
        pip=pip_command,
        node=node_command,
        npm=npm_command,
        npx=npx_command,
        strict=strict,
        path_entries=_runtime_root_entries(
            _configured_root(EMBEDDED_PYTHON_ENV_VAR, env),
            _configured_root(EMBEDDED_NODE_ENV_VAR, env),
        ),
    )


def _runtime_shim_root(bundle: RuntimeBundle) -> Path:
    signature = "|".join(
        [
            *bundle.python.command,
            *bundle.pip.command,
            *bundle.node.command,
            *bundle.npm.command,
            *bundle.npx.command,
            "strict" if bundle.strict else "relaxed",
        ]
    )
    digest = hashlib.sha256(signature.encode("utf-8")).hexdigest()[:12]
    return LOCAL_PATH_TYPE(tempfile.gettempdir()) / "tauri-agent-runtime-shims" / digest


def _shim_contents(command: tuple[str, ...]) -> str:
    if os.name == "nt":
        fixed_args = " ".join(f'"{segment.replace(chr(34), chr(34) * 2)}"' for segment in command)
        return f"@echo off\r\n{fixed_args} %*\r\n"
    fixed_args = " ".join(shlex.quote(segment) for segment in command)
    return f"#!/bin/sh\nexec {fixed_args} \"$@\"\n"


def _write_shim(path: Path, command: tuple[str, ...]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_shim_contents(command), encoding="utf-8")
    if os.name != "nt":
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _ensure_runtime_shims(bundle: RuntimeBundle) -> Path:
    shim_root = _runtime_shim_root(bundle)
    extension = ".cmd" if os.name == "nt" else ""
    shim_map = {
        "python": bundle.python.command,
        "python3": bundle.python.command,
        "pip": bundle.pip.command,
        "pip3": bundle.pip.command,
        "node": bundle.node.command,
        "npm": bundle.npm.command,
        "npx": bundle.npx.command,
    }

    for shim_name, command in shim_map.items():
        _write_shim(shim_root / f"{shim_name}{extension}", command)

    return shim_root


def get_python_executable(base_env: Mapping[str, str] | None = None) -> Path:
    return resolve_runtime_bundle(base_env).python.executable


def get_pip_command(base_env: Mapping[str, str] | None = None) -> list[str]:
    return resolve_runtime_bundle(base_env).pip.as_list()


def build_runtime_environment(base_env: Mapping[str, str] | None = None) -> dict[str, str]:
    env = _merged_env(base_env)
    bundle = resolve_runtime_bundle(env)
    path_entries = [str(_ensure_runtime_shims(bundle)), *bundle.path_entries]
    existing_path = env.get("PATH", "")

    env["PATH"] = os.pathsep.join([*path_entries, *([existing_path] if existing_path else [])])
    env[PYTHON_NO_USER_SITE_ENV_VAR] = "1"
    env[PIP_DISABLE_VERSION_CHECK_ENV_VAR] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    # Strip virtual-environment variables that could poison sys.path
    # inside the child process, even when the correct interpreter is used.
    for _ve_key in (
        "VIRTUAL_ENV",
        "CONDA_PREFIX",
        "CONDA_DEFAULT_ENV",
        "CONDA_PROMPT_MODIFIER",
        "PYTHONPATH",
    ):
        env.pop(_ve_key, None)

    return env


def get_node_executable(base_env: Mapping[str, str] | None = None) -> Path:
    return resolve_runtime_bundle(base_env).node.executable


def get_npm_command(base_env: Mapping[str, str] | None = None) -> list[str]:
    return resolve_runtime_bundle(base_env).npm.as_list()


def get_npx_command(base_env: Mapping[str, str] | None = None) -> list[str]:
    return resolve_runtime_bundle(base_env).npx.as_list()
