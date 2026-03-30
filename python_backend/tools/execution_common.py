import asyncio
import contextlib
import os
import signal
import subprocess
from typing import Any, Dict

MIN_TIMEOUT_SECONDS = 1
MAX_TIMEOUT_SECONDS = 120
MAX_OUTPUT_BYTES = 64 * 1024
PROCESS_TERMINATION_GRACE_SECONDS = 1.0


def normalize_timeout(timeout_seconds: Any, default_timeout: int = 30) -> int:
    try:
        parsed = int(timeout_seconds)
    except (TypeError, ValueError):
        parsed = default_timeout
    if parsed < MIN_TIMEOUT_SECONDS:
        return default_timeout
    return min(parsed, MAX_TIMEOUT_SECONDS)


def truncate_output_text(text: str, max_bytes: int = MAX_OUTPUT_BYTES) -> tuple[str, bool]:
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= max_bytes:
        return text, False

    clipped = encoded[:max_bytes]
    return clipped.decode("utf-8", errors="ignore"), True


def format_process_output(
    stdout: bytes,
    stderr: bytes,
    capture_output: bool,
    max_bytes: int = MAX_OUTPUT_BYTES,
) -> Dict[str, Any]:
    if capture_output:
        stdout_text = stdout.decode("utf-8", errors="replace").strip()
        stderr_text = stderr.decode("utf-8", errors="replace").strip()
        stdout_text, stdout_truncated = truncate_output_text(stdout_text, max_bytes=max_bytes)
        stderr_text, stderr_truncated = truncate_output_text(stderr_text, max_bytes=max_bytes)
    else:
        stdout_text = ""
        stderr_text = ""
        stdout_truncated = False
        stderr_truncated = False

    return {
        "stdout": stdout_text,
        "stderr": stderr_text,
        "stdout_truncated": stdout_truncated,
        "stderr_truncated": stderr_truncated,
        "captured_output": capture_output,
        "output_max_bytes": max_bytes,
    }


def build_subprocess_kwargs() -> Dict[str, Any]:
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return {"creationflags": creationflags} if creationflags else {}
    return {"start_new_session": True}


async def terminate_process_tree(process: Any) -> None:
    if process is None:
        return

    returncode = getattr(process, "returncode", None)
    if returncode not in (None,):
        await _drain_process(process)
        return

    pid = getattr(process, "pid", None)

    if os.name == "nt":
        terminated = await _terminate_process_tree_windows(pid)
        if not terminated and hasattr(process, "kill"):
            with contextlib.suppress(ProcessLookupError, OSError):
                process.kill()
    else:
        terminated = _terminate_process_tree_posix(pid)
        if not terminated and hasattr(process, "kill"):
            with contextlib.suppress(ProcessLookupError, OSError):
                process.kill()

    await _drain_process(process)


def _terminate_process_tree_posix(pid: Any) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False

    try:
        pgid = os.getpgid(pid)
    except (ProcessLookupError, OSError):
        return False

    with contextlib.suppress(ProcessLookupError, OSError):
        os.killpg(pgid, signal.SIGKILL)
        return True
    return False


async def _terminate_process_tree_windows(pid: Any) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False

    try:
        killer = await asyncio.create_subprocess_exec(
            "taskkill",
            "/PID",
            str(pid),
            "/T",
            "/F",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotImplementedError):
        return False

    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(killer.communicate(), timeout=PROCESS_TERMINATION_GRACE_SECONDS)
    return True


async def _drain_process(process: Any) -> None:
    communicate = getattr(process, "communicate", None)
    if not callable(communicate):
        return

    with contextlib.suppress(asyncio.TimeoutError, ProcessLookupError, OSError):
        await asyncio.wait_for(
            asyncio.shield(communicate()),
            timeout=PROCESS_TERMINATION_GRACE_SECONDS,
        )
