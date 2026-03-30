from __future__ import annotations

import asyncio
import json
import os
import secrets
import socket
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Optional

import httpx

from .client import OcrSidecarClient
from .contracts import (
    APP_DIR_ENV_VAR,
    DEFAULT_OCR_HOST,
    DEFAULT_OCR_STARTUP_TIMEOUT_SECONDS,
    DEFAULT_RELATIVE_INSTALL_DIR,
    OcrSidecarConnection,
    OcrSidecarManifest,
    OCR_SIDECAR_DIR_ENV_VAR,
)


class OcrSidecarUnavailableError(RuntimeError):
    pass


class OcrSidecarStartupError(RuntimeError):
    pass


@dataclass(frozen=True)
class _ResolvedInstallation:
    root_dir: Path
    executable_path: Path
    manifest: OcrSidecarManifest
    signature: tuple[str, str, int, int]


class OcrSidecarManager:
    def __init__(
        self,
        *,
        client: OcrSidecarClient | None = None,
        startup_timeout_seconds: int = DEFAULT_OCR_STARTUP_TIMEOUT_SECONDS,
        restart_backoff_seconds: int = 5,
    ) -> None:
        self.client = client or OcrSidecarClient()
        self.startup_timeout_seconds = max(3, int(startup_timeout_seconds))
        self.restart_backoff_seconds = max(1, int(restart_backoff_seconds))
        self._lock = asyncio.Lock()
        self._child: asyncio.subprocess.Process | None = None
        self._connection: OcrSidecarConnection | None = None
        self._install_signature: tuple[str, str, int, int] | None = None
        self._backoff_until: float = 0.0
        self._stdout_handle: BinaryIO | None = None
        self._stderr_handle: BinaryIO | None = None

    def resolve_installation(self) -> _ResolvedInstallation:
        root_dir = self._discover_installation_dir()
        if root_dir is None:
            expected_root = self._expected_default_root()
            if expected_root is not None:
                raise OcrSidecarUnavailableError(
                    f"OCR sidecar is not installed. Expected directory: {expected_root}"
                )
            raise OcrSidecarUnavailableError(
                "OCR sidecar is not installed and no install root is discoverable. "
                f"Set {OCR_SIDECAR_DIR_ENV_VAR} or {APP_DIR_ENV_VAR}."
            )

        if not root_dir.exists():
            raise OcrSidecarUnavailableError(f"OCR sidecar directory does not exist: {root_dir}")
        if not root_dir.is_dir():
            raise OcrSidecarUnavailableError(f"OCR sidecar path is not a directory: {root_dir}")

        manifest_path = root_dir / "manifest.json"
        if not manifest_path.exists():
            raise OcrSidecarUnavailableError(f"OCR sidecar manifest not found: {manifest_path}")

        try:
            manifest = OcrSidecarManifest.model_validate(json.loads(manifest_path.read_text(encoding="utf-8")))
        except Exception as exc:
            raise OcrSidecarUnavailableError(f"Failed to read OCR sidecar manifest: {manifest_path}") from exc

        executable_path = root_dir / str(manifest.entry or "ocr-server.exe")
        if not executable_path.exists():
            raise OcrSidecarUnavailableError(f"OCR sidecar executable not found: {executable_path}")
        if not executable_path.is_file():
            raise OcrSidecarUnavailableError(f"OCR sidecar entry is not a file: {executable_path}")

        executable_stat = executable_path.stat()
        manifest_stat = manifest_path.stat()
        return _ResolvedInstallation(
            root_dir=root_dir.resolve(),
            executable_path=executable_path.resolve(),
            manifest=manifest,
            signature=(
                str(executable_path.resolve()),
                manifest.version,
                manifest_stat.st_mtime_ns,
                executable_stat.st_mtime_ns,
            ),
        )

    def inspect_installation(self) -> dict[str, object]:
        try:
            installation = self.resolve_installation()
        except OcrSidecarUnavailableError:
            expected_root = self._expected_default_root()
            return {
                "installed": False,
                "root_dir": str(expected_root) if expected_root is not None else None,
                "version": None,
                "engine": None,
                "api_version": None,
            }

        return {
            "installed": True,
            "root_dir": str(installation.root_dir),
            "logs_dir": str((installation.root_dir / "logs").resolve()),
            "version": installation.manifest.version,
            "engine": installation.manifest.engine,
            "api_version": installation.manifest.api_version,
        }

    async def ensure_ready(self) -> OcrSidecarConnection:
        async with self._lock:
            installation = self.resolve_installation()

            if self._connection is not None and self._install_signature != installation.signature:
                await self._stop_locked()

            if self._connection is not None and self._child is not None and self._child.returncode is None:
                if await self._healthcheck_locked(self._connection):
                    return self._connection
                await self._stop_locked()

            now = time.monotonic()
            if now < self._backoff_until:
                remaining = max(1, int(self._backoff_until - now))
                raise OcrSidecarStartupError(
                    f"OCR sidecar is in restart backoff. Try again in about {remaining}s."
                )

            await self._start_locked(installation)
            if self._connection is None:
                raise OcrSidecarStartupError("OCR sidecar failed to produce a connection state.")
            return self._connection

    async def stop(self) -> None:
        async with self._lock:
            await self._stop_locked()

    def _discover_installation_dir(self) -> Optional[Path]:
        override_dir = str(os.environ.get(OCR_SIDECAR_DIR_ENV_VAR) or "").strip()
        if override_dir:
            return Path(override_dir).resolve()

        default_root = self._expected_default_root()
        if default_root is not None:
            return default_root

        return None

    @staticmethod
    def _expected_default_root() -> Optional[Path]:
        app_dir = str(os.environ.get(APP_DIR_ENV_VAR) or "").strip()
        if not app_dir:
            return None
        return (Path(app_dir).resolve() / DEFAULT_RELATIVE_INSTALL_DIR).resolve()

    async def _start_locked(self, installation: _ResolvedInstallation) -> None:
        port = self._pick_free_port()
        auth_token = secrets.token_hex(16)
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        stdout_handle, stderr_handle = self._prepare_log_streams(installation.root_dir)

        try:
            child = await asyncio.create_subprocess_exec(
                str(installation.executable_path),
                "--host",
                DEFAULT_OCR_HOST,
                "--port",
                str(port),
                "--auth-token",
                auth_token,
                cwd=str(installation.root_dir),
                stdout=stdout_handle,
                stderr=stderr_handle,
                creationflags=creationflags,
            )
        except OSError as exc:
            self._close_log_handles_locked()
            self._backoff_until = time.monotonic() + self.restart_backoff_seconds
            raise OcrSidecarStartupError(
                f"Failed to start OCR sidecar executable: {installation.executable_path}"
            ) from exc

        self._stdout_handle = stdout_handle
        self._stderr_handle = stderr_handle
        connection = OcrSidecarConnection(
            root_dir=str(installation.root_dir),
            executable_path=str(installation.executable_path),
            base_url=f"http://{DEFAULT_OCR_HOST}:{port}",
            auth_token=auth_token,
            version=installation.manifest.version,
            engine=installation.manifest.engine,
            api_version=installation.manifest.api_version,
        )

        self._child = child
        self._connection = connection
        self._install_signature = installation.signature

        try:
            await self._wait_until_healthy_locked(connection)
        except Exception:
            await self._stop_locked()
            self._backoff_until = time.monotonic() + self.restart_backoff_seconds
            raise

        self._backoff_until = 0.0

    async def _wait_until_healthy_locked(self, connection: OcrSidecarConnection) -> None:
        deadline = time.monotonic() + self.startup_timeout_seconds
        last_error: Exception | None = None

        while time.monotonic() < deadline:
            if self._child is not None and self._child.returncode is not None:
                raise OcrSidecarStartupError(
                    f"OCR sidecar exited during startup with code {self._child.returncode}."
                )

            try:
                if await self._healthcheck_locked(connection):
                    return
            except Exception as exc:
                last_error = exc

            await asyncio.sleep(0.25)

        if last_error is not None:
            raise OcrSidecarStartupError(f"OCR sidecar failed health check: {last_error}") from last_error
        raise OcrSidecarStartupError("OCR sidecar did not become healthy before startup timeout.")

    async def _healthcheck_locked(self, connection: OcrSidecarConnection) -> bool:
        try:
            response = await self.client.health(connection, timeout_seconds=2)
        except (httpx.HTTPError, OSError, RuntimeError):
            return False

        return response.status == "ok"

    async def _stop_locked(self) -> None:
        child = self._child
        self._child = None
        self._connection = None
        self._install_signature = None

        if child is None:
            self._close_log_handles_locked()
            return

        if child.returncode is None:
            try:
                child.kill()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(child.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                pass

        self._close_log_handles_locked()

    @staticmethod
    def _pick_free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((DEFAULT_OCR_HOST, 0))
            sock.listen(1)
            return int(sock.getsockname()[1])

    def _prepare_log_streams(self, root_dir: Path) -> tuple[BinaryIO, BinaryIO]:
        logs_dir = (root_dir / "logs").resolve()
        logs_dir.mkdir(parents=True, exist_ok=True)
        stdout_path = logs_dir / "stdout.log"
        stderr_path = logs_dir / "stderr.log"
        timestamp = datetime.now(timezone.utc).astimezone().isoformat()
        header = (
            f"\n===== OCR sidecar start {timestamp} =====\n"
            f"cwd={root_dir}\n"
        ).encode("utf-8", errors="replace")

        stdout_handle = open(stdout_path, "ab")
        stderr_handle = open(stderr_path, "ab")
        stdout_handle.write(header)
        stderr_handle.write(header)
        stdout_handle.flush()
        stderr_handle.flush()
        return stdout_handle, stderr_handle

    def _close_log_handles_locked(self) -> None:
        for attribute_name in ("_stdout_handle", "_stderr_handle"):
            handle = getattr(self, attribute_name, None)
            if handle is None:
                continue
            try:
                handle.flush()
            except Exception:
                pass
            try:
                handle.close()
            except Exception:
                pass
            setattr(self, attribute_name, None)
