from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Optional

from document_readers.pdf_reader import (
    get_pdf_info,
    get_pdf_outline,
    read_pdf_lines,
    read_pdf_pages,
    search_pdf,
)

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path
from .policies import ToolExecutionPolicy


def _filter_properties() -> dict[str, dict[str, Any]]:
    return {
        "exclude_header_footer": {
            "type": "boolean",
            "default": True,
            "description": "Whether repeated headers and footers should be filtered out.",
        },
        "header_ratio": {
            "type": "number",
            "default": 0.05,
            "description": "Top page area treated as header when header/footer filtering is enabled.",
        },
        "footer_ratio": {
            "type": "number",
            "default": 0.05,
            "description": "Bottom page area treated as footer when header/footer filtering is enabled.",
        },
        "exclude_watermark": {
            "type": "boolean",
            "default": True,
            "description": "Whether rotated watermark-like text should be filtered out.",
        },
        "angle_threshold": {
            "type": "number",
            "default": 5.0,
            "description": "Rotation threshold used when filtering watermark-like text.",
        },
        "exclude_tables": {
            "type": "boolean",
            "default": True,
            "description": "Whether detected table regions should be excluded from page text extraction.",
        },
        "y_tolerance": {
            "type": "number",
            "default": 3.0,
            "description": "Vertical tolerance used to merge nearby PDF text spans into visual lines.",
        },
    }


def _markdown_properties() -> dict[str, dict[str, Any]]:
    return {
        "write_images": {
            "type": "boolean",
            "default": False,
            "description": "When mode='markdown', save extracted image assets and reference them from markdown. Leave this disabled unless image extraction is specifically needed.",
        },
        "embed_images": {
            "type": "boolean",
            "default": False,
            "description": "When mode='markdown', embed images as data URIs instead of writing asset files.",
        },
        "image_format": {
            "type": "string",
            "enum": ["png"],
            "default": "png",
            "description": "Image format used for extracted markdown assets.",
        },
        "dpi": {
            "type": "integer",
            "default": 150,
            "description": "Rasterization DPI used when extracting markdown images.",
        },
        "force_text": {
            "type": "boolean",
            "default": True,
            "description": "Keep text that appears on top of image regions in markdown output.",
        },
        "ignore_graphics": {
            "type": "boolean",
            "default": False,
            "description": "Skip vector graphic extraction in markdown mode.",
        },
        "detect_bg_color": {
            "type": "boolean",
            "default": True,
            "description": "Use background color detection to reduce noisy markdown extraction.",
        },
        "ignore_alpha": {
            "type": "boolean",
            "default": True,
            "description": "Ignore fully transparent text when building markdown output.",
        },
        "table_strategy": {
            "type": "string",
            "enum": ["lines_strict", "lines", "text"],
            "default": "lines_strict",
            "description": "Table detection strategy used in markdown mode.",
        },
    }


class PdfToolMixin:
    @staticmethod
    def _resolve_pdf_path(
        path: str,
        workspace_path: Optional[str],
        tool_call_id: str,
        tool_name: str,
        reference_library_roots: Optional[list[str]] = None,
    ) -> tuple[Optional[Path], Optional[ToolResult]]:
        file_path, resolve_error = resolve_workspace_path(
            path,
            workspace_path,
            reference_library_roots=reference_library_roots,
            allow_reference_library=True,
        )
        if resolve_error or file_path is None:
            return None, ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=resolve_error or "Invalid path",
            )

        if not file_path.exists():
            return None, ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=f"File not found: {path}",
            )

        if not file_path.is_file():
            return None, ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=f"Path is not a file: {file_path}",
            )

        if file_path.suffix.lower() != ".pdf":
            return None, ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=f"Unsupported file type for PDF tool: {file_path.suffix or '(none)'}",
            )

        return file_path, None

    @staticmethod
    def _markdown_asset_root(workspace_path: Optional[str]) -> Path | None:
        if not workspace_path:
            return None
        return Path(workspace_path).resolve() / ".agent" / "cache" / "pdf_markdown"


class PdfGetInfoTool(PdfToolMixin, BaseTool):
    name = "pdf_get_info"
    description = "Read PDF metadata such as page count and embedded outline presence."
    display_name = "PDF Get Info"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 14
    use_when = "Use when you need to inspect a PDF before searching or reading it."
    avoid_when = "Avoid when you already know the PDF structure and need content directly."
    user_summary_template = "Inspecting PDF {path}"
    result_preview_fields = ["summary"]
    tags = ["document", "pdf", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        path: str,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        file_path, failure = self._resolve_pdf_path(
            path, workspace_path, tool_call_id, self.name,
            reference_library_roots=reference_library_roots,
        )
        if failure:
            return failure

        try:
            info = await asyncio.to_thread(get_pdf_info, file_path)
        except (FileNotFoundError, RuntimeError, ValueError) as exc:
            return ToolResult(tool_call_id=tool_call_id, tool_name=self.name, success=False, output=None, error=str(exc))

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "pdf_info",
                "path": str(file_path),
                "summary": {
                    "page_count": info["page_count"],
                    "has_outline": info["has_outline"],
                    "outline_count": info["outline_count"],
                },
                "info": info,
            },
        )


class PdfGetOutlineTool(PdfToolMixin, BaseTool):
    name = "pdf_get_outline"
    description = "Read a PDF embedded outline to locate chapters and section anchors."
    display_name = "PDF Get Outline"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 15
    use_when = "Use when you need chapter structure or section navigation for a PDF."
    avoid_when = "Avoid when the PDF has no outline or you only need a keyword search."
    user_summary_template = "Reading PDF outline from {path}"
    result_preview_fields = ["summary", "items"]
    tags = ["document", "pdf", "outline", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "max_depth": {
                "type": "integer",
                "default": 4,
                "description": "Maximum outline depth to return. Use a larger value for deeper chapter trees.",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        path: str,
        max_depth: int = 4,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        file_path, failure = self._resolve_pdf_path(
            path, workspace_path, tool_call_id, self.name,
            reference_library_roots=reference_library_roots,
        )
        if failure:
            return failure

        try:
            normalized_max_depth = max(1, int(max_depth)) if max_depth is not None else None
            outline = await asyncio.to_thread(
                get_pdf_outline,
                file_path,
                max_depth=normalized_max_depth,
            )
        except (FileNotFoundError, RuntimeError, ValueError) as exc:
            return ToolResult(tool_call_id=tool_call_id, tool_name=self.name, success=False, output=None, error=str(exc))

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "pdf_outline",
                "path": str(file_path),
                "summary": {
                    "page_count": outline["page_count"],
                    "item_count": len(outline["items"]),
                },
                "items": outline["items"],
            },
        )


class PdfReadPagesTool(PdfToolMixin, BaseTool):
    name = "pdf_read_pages"
    policy = ToolExecutionPolicy(timeout_seconds=60)
    description = (
        "Read PDF pages by page selector, preferring markdown output that preserves headings, tables, and layout. "
        "Use pages='all' for the whole file, or selectors like '23', '34-40', or '1-3,8-10'. "
        "Prefer mode='markdown' for normal reading. Use other modes only when you specifically need plain page text, visual lines, or text blocks. "
        "Image extraction is optional and disabled by default."
    )
    display_name = "PDF Read Pages"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 15
    use_when = "Use when you need page-level PDF reading. Prefer the default markdown mode because it best preserves structure and tables for LLM consumption without the overhead of image extraction."
    avoid_when = "Avoid when you only need a few specific visual lines or a keyword search."
    user_summary_template = "Reading PDF pages from {path}"
    result_preview_fields = ["summary", "items"]
    tags = ["document", "pdf", "safe-read", "excerpt"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "pages": {
                "type": "string",
                "description": "Use 'all' for every page, or selectors like '23', '34-40', or '1-3,8-10'",
            },
            "mode": {
                "type": "string",
                "enum": ["page_text", "visual_lines", "blocks", "markdown"],
                "default": "markdown",
                "description": "Preferred output shape. 'markdown' is the default and should be used for normal PDF reading because it preserves headings, tables, and layout. 'page_text' returns flattened text, 'visual_lines' returns visual lines, and 'blocks' returns text blocks.",
            },
            **_filter_properties(),
            **_markdown_properties(),
        },
        "required": ["path", "pages"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        path: str,
        pages: str,
        mode: str = "markdown",
        exclude_header_footer: bool = True,
        header_ratio: float = 0.05,
        footer_ratio: float = 0.05,
        exclude_watermark: bool = True,
        angle_threshold: float = 5.0,
        exclude_tables: bool = True,
        y_tolerance: float = 3.0,
        write_images: bool = False,
        embed_images: bool = False,
        image_format: str = "png",
        dpi: int = 150,
        force_text: bool = True,
        ignore_graphics: bool = False,
        detect_bg_color: bool = True,
        ignore_alpha: bool = True,
        table_strategy: str = "lines_strict",
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        file_path, failure = self._resolve_pdf_path(
            path, workspace_path, tool_call_id, self.name,
            reference_library_roots=reference_library_roots,
        )
        if failure:
            return failure

        effective_mode = mode
        fallback_from_mode: str | None = None
        try:
            result = await asyncio.to_thread(
                read_pdf_pages,
                file_path,
                pages=pages,
                mode=effective_mode,
                exclude_header_footer=exclude_header_footer,
                header_ratio=header_ratio,
                footer_ratio=footer_ratio,
                exclude_watermark=exclude_watermark,
                angle_threshold=angle_threshold,
                exclude_tables=exclude_tables,
                y_tolerance=y_tolerance,
                write_images=write_images,
                embed_images=embed_images,
                image_format=image_format,
                dpi=dpi,
                force_text=force_text,
                ignore_graphics=ignore_graphics,
                detect_bg_color=detect_bg_color,
                ignore_alpha=ignore_alpha,
                table_strategy=table_strategy,
                asset_root=self._markdown_asset_root(workspace_path),
            )
        except (FileNotFoundError, RuntimeError, ValueError) as exc:
            if effective_mode == "markdown" and "PyMuPDF4LLM is not installed" in str(exc):
                try:
                    fallback_from_mode = effective_mode
                    effective_mode = "page_text"
                    result = await asyncio.to_thread(
                        read_pdf_pages,
                        file_path,
                        pages=pages,
                        mode=effective_mode,
                        exclude_header_footer=exclude_header_footer,
                        header_ratio=header_ratio,
                        footer_ratio=footer_ratio,
                        exclude_watermark=exclude_watermark,
                        angle_threshold=angle_threshold,
                        exclude_tables=exclude_tables,
                        y_tolerance=y_tolerance,
                        write_images=write_images,
                        embed_images=embed_images,
                        image_format=image_format,
                        dpi=dpi,
                        force_text=force_text,
                        ignore_graphics=ignore_graphics,
                        detect_bg_color=detect_bg_color,
                        ignore_alpha=ignore_alpha,
                        table_strategy=table_strategy,
                        asset_root=self._markdown_asset_root(workspace_path),
                    )
                except (FileNotFoundError, RuntimeError, ValueError) as fallback_exc:
                    return ToolResult(
                        tool_call_id=tool_call_id,
                        tool_name=self.name,
                        success=False,
                        output=None,
                        error=str(fallback_exc),
                    )
            else:
                return ToolResult(tool_call_id=tool_call_id, tool_name=self.name, success=False, output=None, error=str(exc))

        summary = {
            "page_count": result["page_count"],
            "requested_pages": result["pages"],
            "mode": result["mode"],
            "returned_items": len(result["items"]),
        }
        if fallback_from_mode:
            summary["fallback_from_mode"] = fallback_from_mode

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "pdf_pages",
                "path": str(file_path),
                "summary": summary,
                **result,
            },
        )


class PdfReadLinesTool(PdfToolMixin, BaseTool):
    name = "pdf_read_lines"
    description = (
        "Read specific visual line ranges from one PDF page. "
        "Use exact line selectors like '8', '8-12', or '8,12-15'. "
        "This tool does not support line_numbers='all'; use pdf_read_pages for whole-page reads."
    )
    display_name = "PDF Read Lines"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 17
    use_when = "Use when you already know the PDF page and want stable line-range reads."
    avoid_when = "Avoid when you first need to locate the relevant page or chapter."
    user_summary_template = "Reading PDF lines from {path}"
    result_preview_fields = ["summary", "items"]
    tags = ["document", "pdf", "safe-read", "excerpt", "line-range"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "page_number": {
                "type": "integer",
                "description": "1-based PDF page number",
            },
            "line_numbers": {
                "type": "string",
                "description": "Line selector such as '8', '8-12', or '8,12-15'. Do not use 'all'.",
            },
            "include_context": {
                "type": "integer",
                "default": 0,
                "description": "Number of nearby visual lines to include before and after the requested lines.",
            },
            **_filter_properties(),
        },
        "required": ["path", "page_number", "line_numbers"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        path: str,
        page_number: int,
        line_numbers: str,
        include_context: int = 0,
        exclude_header_footer: bool = True,
        header_ratio: float = 0.05,
        footer_ratio: float = 0.05,
        exclude_watermark: bool = True,
        angle_threshold: float = 5.0,
        exclude_tables: bool = True,
        y_tolerance: float = 3.0,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        file_path, failure = self._resolve_pdf_path(
            path, workspace_path, tool_call_id, self.name,
            reference_library_roots=reference_library_roots,
        )
        if failure:
            return failure

        try:
            result = await asyncio.to_thread(
                read_pdf_lines,
                file_path,
                page_number=page_number,
                line_numbers=line_numbers,
                include_context=include_context,
                exclude_header_footer=exclude_header_footer,
                header_ratio=header_ratio,
                footer_ratio=footer_ratio,
                exclude_watermark=exclude_watermark,
                angle_threshold=angle_threshold,
                exclude_tables=exclude_tables,
                y_tolerance=y_tolerance,
            )
        except (FileNotFoundError, RuntimeError, ValueError) as exc:
            return ToolResult(tool_call_id=tool_call_id, tool_name=self.name, success=False, output=None, error=str(exc))

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "pdf_lines",
                "path": str(file_path),
                "summary": {
                    "page_number": result["page_number"],
                    "requested_lines": result["requested_lines"],
                    "returned_items": len(result["items"]),
                },
                **result,
            },
        )


class PdfSearchTool(PdfToolMixin, BaseTool):
    name = "pdf_search"
    policy = ToolExecutionPolicy(timeout_seconds=60)
    description = (
        "Search PDF content with structured location metadata. "
        "Use search_mode='page' for broad page-level discovery and search_mode='line' for precise visual-line matches."
    )
    display_name = "PDF Search"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 18
    use_when = "Use when you need to locate terms or clauses inside a PDF before reading excerpts."
    avoid_when = "Avoid when you already know the exact page and line range."
    user_summary_template = "Searching PDF {path} for {query}"
    result_preview_fields = ["summary", "items"]
    tags = ["document", "pdf", "search", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "query": {
                "type": "string",
                "description": "Literal search keyword or phrase.",
            },
            "top_k": {
                "type": "integer",
                "default": 5,
                "description": "Maximum number of matches to return.",
            },
            "search_mode": {
                "type": "string",
                "enum": ["page", "line"],
                "default": "page",
                "description": "Result granularity: 'page' returns broader page matches, 'line' returns precise visual-line hits.",
            },
            "max_pages": {
                "type": "integer",
                "description": "Optional upper bound on how many pages to scan from the start of the PDF.",
            },
            **_filter_properties(),
        },
        "required": ["path", "query"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        path: str,
        query: str,
        top_k: int = 5,
        search_mode: str = "page",
        max_pages: Optional[int] = None,
        exclude_header_footer: bool = True,
        header_ratio: float = 0.05,
        footer_ratio: float = 0.05,
        exclude_watermark: bool = True,
        angle_threshold: float = 5.0,
        exclude_tables: bool = True,
        y_tolerance: float = 3.0,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        file_path, failure = self._resolve_pdf_path(
            path, workspace_path, tool_call_id, self.name,
            reference_library_roots=reference_library_roots,
        )
        if failure:
            return failure

        try:
            result = await asyncio.to_thread(
                search_pdf,
                file_path,
                query=query,
                top_k=top_k,
                search_mode=search_mode,
                max_pages=max_pages,
                exclude_header_footer=exclude_header_footer,
                header_ratio=header_ratio,
                footer_ratio=footer_ratio,
                exclude_watermark=exclude_watermark,
                angle_threshold=angle_threshold,
                exclude_tables=exclude_tables,
                y_tolerance=y_tolerance,
            )
        except (FileNotFoundError, RuntimeError, ValueError) as exc:
            return ToolResult(tool_call_id=tool_call_id, tool_name=self.name, success=False, output=None, error=str(exc))

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "pdf_search",
                "path": str(file_path),
                "summary": {
                    "query": result["query"],
                    "search_mode": result["search_mode"],
                    "result_count": len(result["items"]),
                    "scanned_pages": result.get("scanned_pages"),
                },
                **result,
            },
        )
