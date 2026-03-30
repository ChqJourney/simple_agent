from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

AUTH_HEADER_NAME = "x-work-agent-ocr-auth"
DEFAULT_OCR_HOST = "127.0.0.1"
DEFAULT_OCR_STARTUP_TIMEOUT_SECONDS = 15
DEFAULT_OCR_REQUEST_TIMEOUT_SECONDS = 60
OCR_SIDECAR_DIR_ENV_VAR = "TAURI_AGENT_OCR_SIDECAR_DIR"
APP_DIR_ENV_VAR = "TAURI_AGENT_APP_DIR"
DEFAULT_RELATIVE_INSTALL_DIR = Path("ocr-sidecar") / "current"


class OcrSidecarManifest(BaseModel):
    name: str = "work-agent-ocr-sidecar"
    version: str
    engine: str = "paddle"
    api_version: int = 1
    entry: str = "ocr-server.exe"
    languages: list[str] = Field(default_factory=list)


class OcrSidecarConnection(BaseModel):
    root_dir: str
    executable_path: str
    base_url: str
    auth_token: str
    version: str
    engine: str = "paddle"
    api_version: int = 1


class OcrHealthResponse(BaseModel):
    status: str
    engine: str
    version: str
    api_version: int
    warmed_languages: list[str] = Field(default_factory=list)


class OcrImageLine(BaseModel):
    text: str
    bbox: list[float] = Field(default_factory=list)
    score: float | None = None


class OcrImageResponse(BaseModel):
    success: bool
    text: str
    lines: list[OcrImageLine] = Field(default_factory=list)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    elapsed_ms: int
    model: dict[str, Any] = Field(default_factory=dict)


OcrDetailLevel = Literal["text", "lines", "blocks"]
