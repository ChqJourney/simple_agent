from typing import Any, Dict

MIN_TIMEOUT_SECONDS = 1
MAX_TIMEOUT_SECONDS = 120
MAX_OUTPUT_BYTES = 64 * 1024


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
