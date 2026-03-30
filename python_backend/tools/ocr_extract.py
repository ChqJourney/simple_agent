from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any, Optional

from ocr.client import OcrSidecarClient
from ocr.manager import OcrSidecarManager, OcrSidecarStartupError, OcrSidecarUnavailableError
from document_readers.pdf_reader import render_pdf_pages_to_images

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
}
PDF_EXTENSIONS = {".pdf"}


class OcrExtractTool(BaseTool):
    name = "ocr_extract"
    description = (
        "Extract text from image files and scanned PDFs using the optional Paddle OCR sidecar. "
        "Use pages='all' or selectors like '1', '3-5', or '1-3,8' when OCRing PDFs."
    )
    display_name = "OCR Extract"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 18
    use_when = "Use when a screenshot, scan, or image-based document contains text that normal file reading cannot extract."
    avoid_when = "Avoid when the file already has machine-readable text or when you only need regular PDF/text tools."
    user_summary_template = "Extracting OCR text from {path}"
    result_preview_fields = ["summary", "content"]
    tags = ["document", "ocr", "image", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace.",
            },
            "input_type": {
                "type": "string",
                "enum": ["auto", "image", "pdf"],
                "default": "auto",
                "description": "Input type hint. Use 'auto' in most cases.",
            },
            "lang": {
                "type": "string",
                "default": "ch",
                "description": "Paddle OCR language code, for example 'ch' or 'en'.",
            },
            "pages": {
                "type": "string",
                "default": "all",
                "description": "PDF-only page selector. Use 'all' or ranges like '1', '3-5', or '1-3,8'.",
            },
            "detail_level": {
                "type": "string",
                "enum": ["text", "lines", "blocks"],
                "default": "lines",
                "description": "Response shape. 'text' returns only flattened text, 'lines' returns OCR lines, 'blocks' returns grouped blocks.",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    def __init__(
        self,
        manager: OcrSidecarManager | None = None,
        client: OcrSidecarClient | None = None,
    ) -> None:
        super().__init__()
        self.manager = manager or OcrSidecarManager()
        self.client = client or OcrSidecarClient()

    async def execute(
        self,
        path: str,
        input_type: str = "auto",
        lang: str = "ch",
        pages: str = "all",
        detail_level: str = "lines",
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        **_: Any,
    ) -> ToolResult:
        file_path, resolve_error = resolve_workspace_path(path, workspace_path)
        if resolve_error or file_path is None:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=resolve_error or "Invalid path",
            )

        if not file_path.exists():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"File not found: {path}",
            )

        if not file_path.is_file():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Path is not a file: {file_path}",
            )

        normalized_input_type = (input_type or "auto").strip().lower()
        normalized_detail_level = (detail_level or "lines").strip().lower()
        normalized_lang = (lang or "ch").strip() or "ch"
        normalized_pages = (pages or "all").strip() or "all"

        if normalized_input_type not in {"auto", "image", "pdf"}:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="input_type must be one of: auto, image, pdf",
            )

        if normalized_detail_level not in {"text", "lines", "blocks"}:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="detail_level must be one of: text, lines, blocks",
            )

        detected_input_type = self._detect_input_type(file_path, normalized_input_type)
        if detected_input_type != "image":
            if detected_input_type != "pdf":
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Unsupported OCR input type for file: {file_path.suffix or '(none)'}",
                )

        cache_path = self._cache_path(
            file_path=file_path,
            workspace_path=workspace_path,
            input_type=detected_input_type,
            lang=normalized_lang,
            pages=normalized_pages if detected_input_type == "pdf" else "",
            detail_level=normalized_detail_level,
            sidecar_version=self._sidecar_version_hint(),
        )
        cached_output = self._load_cache(cache_path)
        if cached_output is not None:
            cached_metadata = cached_output.setdefault("metadata", {})
            if isinstance(cached_metadata, dict):
                cached_metadata["cache_hit"] = True
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=True,
                output=cached_output,
            )

        try:
            connection = await self.manager.ensure_ready()
            if detected_input_type == "pdf":
                output = await self._execute_pdf_ocr(
                    file_path=file_path,
                    pages=normalized_pages,
                    lang=normalized_lang,
                    detail_level=normalized_detail_level,
                    connection=connection,
                )
            else:
                output = await self._execute_image_ocr(
                    file_path=file_path,
                    lang=normalized_lang,
                    detail_level=normalized_detail_level,
                    connection=connection,
                )
        except (OcrSidecarUnavailableError, OcrSidecarStartupError) as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )
        except Exception as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"OCR request failed: {exc}",
            )

        self._store_cache(cache_path, output)
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output=output,
        )

    async def _execute_image_ocr(
        self,
        *,
        file_path: Path,
        lang: str,
        detail_level: str,
        connection: Any,
    ) -> dict[str, Any]:
        response = await self.client.ocr_image(
            connection,
            file_path,
            lang=lang,
            detail_level=detail_level,
        )

        items = []
        if detail_level == "blocks":
            items = response.blocks
        elif detail_level == "lines":
            items = [line.model_dump(mode="json") for line in response.lines]

        return {
            "event": "ocr_extract",
            "path": str(file_path),
            "input_type": "image",
            "detail_level": detail_level,
            "content": response.text,
            "items": items,
            "summary": {
                "char_count": len(response.text),
                "line_count": len(response.lines),
                "detail_level": detail_level,
                "engine": response.model.get("engine", "paddle"),
                "lang": response.model.get("lang", lang),
            },
            "metadata": {
                "elapsed_ms": response.elapsed_ms,
                "cache_hit": False,
                "sidecar_version": connection.version,
                "sidecar_api_version": connection.api_version,
            },
        }

    async def _execute_pdf_ocr(
        self,
        *,
        file_path: Path,
        pages: str,
        lang: str,
        detail_level: str,
        connection: Any,
    ) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="work-agent-ocr-") as temp_dir:
            rendered = render_pdf_pages_to_images(
                file_path,
                pages=pages,
                output_dir=temp_dir,
                dpi=144,
                image_format="png",
            )

            items: list[dict[str, Any]] = []
            text_blocks: list[str] = []
            total_elapsed_ms = 0
            total_line_count = 0

            for page in rendered["items"]:
                image_path = Path(str(page["image_path"]))
                response = await self.client.ocr_image(
                    connection,
                    image_path,
                    lang=lang,
                    detail_level=detail_level,
                )
                page_number = int(page["page_number"])
                total_elapsed_ms += int(response.elapsed_ms)
                total_line_count += len(response.lines)

                if response.text.strip():
                    text_blocks.append(f"[Page {page_number}]\n{response.text}".strip())

                if detail_level == "lines":
                    for line in response.lines:
                        item = line.model_dump(mode="json")
                        item["page_number"] = page_number
                        items.append(item)
                elif detail_level == "blocks":
                    for block in response.blocks:
                        item = dict(block)
                        item["page_number"] = page_number
                        items.append(item)

        content = "\n\n".join(text_blocks)
        return {
            "event": "ocr_extract",
            "path": str(file_path),
            "input_type": "pdf",
            "detail_level": detail_level,
            "content": content,
            "items": items,
            "summary": {
                "char_count": len(content),
                "line_count": total_line_count,
                "page_count": len(rendered["items"]),
                "requested_pages": list(rendered["pages"]),
                "detail_level": detail_level,
                "engine": connection.engine,
                "lang": lang,
            },
            "metadata": {
                "elapsed_ms": total_elapsed_ms,
                "cache_hit": False,
                "sidecar_version": connection.version,
                "sidecar_api_version": connection.api_version,
                "render_dpi": rendered["dpi"],
            },
        }

    @staticmethod
    def _cache_root(workspace_path: Optional[str]) -> Path | None:
        if not workspace_path:
            return None
        workspace_root = Path(workspace_path).resolve()
        return workspace_root / ".agent" / "cache" / "ocr"

    def _cache_path(
        self,
        *,
        file_path: Path,
        workspace_path: Optional[str],
        input_type: str,
        lang: str,
        pages: str,
        detail_level: str,
        sidecar_version: str | None,
    ) -> Path | None:
        cache_root = self._cache_root(workspace_path)
        if cache_root is None:
            return None

        stat = file_path.stat()
        cache_key = {
            "path": str(file_path.resolve()),
            "size": int(stat.st_size),
            "mtime_ns": int(stat.st_mtime_ns),
            "input_type": input_type,
            "lang": lang,
            "pages": pages,
            "detail_level": detail_level,
            "sidecar_version": sidecar_version or "unknown",
        }
        digest = hashlib.sha256(json.dumps(cache_key, sort_keys=True).encode("utf-8")).hexdigest()
        return cache_root / f"{digest}.json"

    def _sidecar_version_hint(self) -> str | None:
        resolve_installation = getattr(self.manager, "resolve_installation", None)
        if not callable(resolve_installation):
            return None
        try:
            installation = resolve_installation()
        except Exception:
            return None
        manifest = getattr(installation, "manifest", None)
        version = getattr(manifest, "version", None)
        return str(version) if version else None

    @staticmethod
    def _load_cache(cache_path: Path | None) -> dict[str, Any] | None:
        if cache_path is None or not cache_path.exists():
            return None
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    @staticmethod
    def _store_cache(cache_path: Path | None, output: dict[str, Any]) -> None:
        if cache_path is None:
            return
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(
                json.dumps(output, ensure_ascii=True, sort_keys=True),
                encoding="utf-8",
            )
        except OSError:
            return

    @staticmethod
    def _detect_input_type(file_path: Path, input_type: str) -> str:
        if input_type != "auto":
            return input_type

        suffix = file_path.suffix.lower()
        if suffix in IMAGE_EXTENSIONS:
            return "image"
        if suffix in PDF_EXTENSIONS:
            return "pdf"
        return "unknown"
