from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Optional

from document_readers.excel_reader import read_excel_range
from document_readers.pdf_reader import read_pdf_lines, read_pdf_pages
from document_readers.pptx_reader import read_pptx_slides
from document_readers.word_reader import read_word_paragraphs, read_word_table_rows

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path
from .search_documents import EXCEL_EXTENSIONS, PDF_EXTENSIONS, PPTX_EXTENSIONS, TEXT_EXTENSIONS, WORD_EXTENSIONS

MAX_SEGMENT_CHARS = 64 * 1024
MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024


class ReadDocumentSegmentTool(BaseTool):
    name = "read_document_segment"
    description = (
        "Read a narrow segment from a workspace document using a structured locator. "
        "Supports text documents, PDF files, Word documents, Excel workbooks, and PowerPoint decks. "
        "Use locator.type plus the matching locator fields for the target format. "
        "For PDF page ranges, the returned content is markdown-oriented so structure, tables, and images are preserved as much as possible."
    )
    display_name = "Read Document Segment"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 12
    use_when = "Use when you know the target document and need a specific line, character, page, paragraph, table, sheet, cell-range, or slide segment. For PDF page ranges, this is a good way to get markdown-preserving excerpts."
    avoid_when = "Avoid when you first need to locate relevant content or understand the document structure."
    user_summary_template = "Reading document segment from {path}"
    result_preview_fields = ["summary", "content"]
    tags = ["document", "safe-read", "excerpt", "segment"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "locator": {
                "type": "object",
                "description": (
                    "Structured location descriptor for the segment you want to read. "
                    "Examples: {type:'pdf_line_range', page_number:12, line_start:30, line_end:40}, "
                    "{type:'word_table_range', table_index:2, row_start:5, row_end:9}, "
                    "{type:'excel_range', sheet_name:'Sheet1', row_start:2, row_end:20}."
                ),
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "text_line_range",
                            "text_char_range",
                            "pdf_page_range",
                            "pdf_line_range",
                            "word_paragraph_range",
                            "word_table_range",
                            "excel_range",
                            "pptx_slide_range",
                        ],
                        "description": "Segment kind. Prefer setting this explicitly so the tool can choose the correct locator fields.",
                    },
                    "start": {"type": "integer", "description": "Generic start index alias for simple ranges."},
                    "end": {"type": "integer", "description": "Generic end index alias for simple ranges."},
                    "line_start": {"type": "integer", "description": "Start line for text_line_range or pdf_line_range."},
                    "line_end": {"type": "integer", "description": "End line for text_line_range or pdf_line_range."},
                    "char_start": {"type": "integer", "description": "1-based start character for text_char_range."},
                    "char_end": {"type": "integer", "description": "1-based end character for text_char_range."},
                    "page_start": {"type": "integer", "description": "Start page for pdf_page_range."},
                    "page_end": {"type": "integer", "description": "End page for pdf_page_range."},
                    "page_number": {"type": "integer", "description": "Single PDF page for pdf_line_range."},
                    "paragraph_start": {"type": "integer", "description": "Start paragraph for word_paragraph_range."},
                    "paragraph_end": {"type": "integer", "description": "End paragraph for word_paragraph_range."},
                    "table_index": {"type": "integer", "description": "1-based Word table index for word_table_range."},
                    "row_start": {"type": "integer", "description": "Start row for word_table_range or excel_range."},
                    "row_end": {"type": "integer", "description": "End row for word_table_range or excel_range."},
                    "column_start": {"type": "integer", "description": "Start column for word_table_range or excel_range."},
                    "column_end": {"type": "integer", "description": "End column for word_table_range or excel_range."},
                    "sheet_name": {"type": "string", "description": "Excel sheet name for excel_range."},
                    "slide_start": {"type": "integer", "description": "Start slide for pptx_slide_range."},
                    "slide_end": {"type": "integer", "description": "End slide for pptx_slide_range."},
                    "slide_number": {"type": "integer", "description": "Single slide alias for pptx_slide_range."},
                },
                "additionalProperties": False,
            },
            "include_context": {
                "type": "integer",
                "default": 0,
                "description": "How much nearby context to include. Mainly used for PDF lines, Word paragraphs/tables, and Excel rows.",
            },
            "max_chars": {
                "type": "integer",
                "default": MAX_SEGMENT_CHARS,
                "description": "Maximum characters to return before truncation.",
            },
            "encoding": {
                "type": "string",
                "default": "utf-8",
                "description": "Text file encoding. Only used for plain text files.",
            },
        },
        "required": ["path", "locator"],
        "additionalProperties": False,
    }

    @staticmethod
    def _normalize_positive_int(value: Any, field_name: str) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field_name} must be an integer")
        if parsed < 1:
            raise ValueError(f"{field_name} must be >= 1")
        return parsed

    @staticmethod
    def _truncate_content(content: str, max_chars: int) -> tuple[str, bool]:
        if len(content) <= max_chars:
            return content, False
        return content[:max_chars], True

    @staticmethod
    def _resolve_file_path(
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

        return file_path, None

    def _read_text_segment(
        self,
        file_path: Path,
        locator: dict[str, Any],
        *,
        encoding: str,
        max_chars: int,
    ) -> dict[str, Any]:
        file_size = file_path.stat().st_size
        if file_size > MAX_TEXT_FILE_BYTES:
            raise ValueError(f"File too large: {file_size} bytes (max: {MAX_TEXT_FILE_BYTES} bytes)")

        content = file_path.read_text(encoding=encoding)
        locator_type = str(locator.get("type") or "text_line_range")

        if locator_type == "text_char_range":
            start = self._normalize_positive_int(locator.get("char_start", locator.get("start")), "char_start")
            end = self._normalize_positive_int(locator.get("char_end", locator.get("end")), "char_end")
            if end < start:
                raise ValueError("Invalid range: char_end must be >= char_start")
            segment = content[start - 1:end]
            segment, truncated = self._truncate_content(segment, max_chars)
            return {
                "document_type": "text",
                "segment_type": "text_char_range",
                "locator": {"char_start": start, "char_end": end},
                "content": segment,
                "items": [],
                "truncated": truncated,
                "summary": {
                    "char_count": len(segment),
                    "document_type": "text",
                    "segment_type": "text_char_range",
                },
            }

        start = self._normalize_positive_int(locator.get("line_start", locator.get("start")), "line_start")
        end = self._normalize_positive_int(locator.get("line_end", locator.get("end")), "line_end")
        if end < start:
            raise ValueError("Invalid range: line_end must be >= line_start")

        lines = content.splitlines()
        excerpt_lines = lines[start - 1:end]
        segment = "\n".join(excerpt_lines)
        segment, truncated = self._truncate_content(segment, max_chars)
        return {
            "document_type": "text",
            "segment_type": "text_line_range",
            "locator": {"line_start": start, "line_end": end},
            "content": segment,
            "items": [],
            "truncated": truncated,
            "summary": {
                "line_count": len(excerpt_lines),
                "char_count": len(segment),
                "document_type": "text",
                "segment_type": "text_line_range",
            },
        }

    def _read_pdf_page_segment(
        self,
        file_path: Path,
        locator: dict[str, Any],
        *,
        workspace_path: Optional[str],
        max_chars: int,
    ) -> dict[str, Any]:
        page_start = self._normalize_positive_int(locator.get("page_start", locator.get("start")), "page_start")
        page_end = self._normalize_positive_int(locator.get("page_end", locator.get("end")), "page_end")
        if page_end < page_start:
            raise ValueError("Invalid range: page_end must be >= page_start")

        page_spec = str(page_start) if page_start == page_end else f"{page_start}-{page_end}"
        asset_root = None
        if workspace_path:
            asset_root = Path(workspace_path).resolve() / ".agent" / "cache" / "pdf_markdown"
        result = read_pdf_pages(
            file_path,
            pages=page_spec,
            mode="markdown",
            write_images=False,
            asset_root=asset_root,
        )
        blocks = []
        for item in result["items"]:
            page_number = int(item["page_number"])
            page_text = str(item.get("text") or "")
            blocks.append(f"[Page {page_number}]\n{page_text}".strip())
        content = "\n\n".join(blocks)
        content, truncated = self._truncate_content(content, max_chars)
        return {
            "document_type": "pdf",
            "segment_type": "pdf_page_range",
            "locator": {"page_start": page_start, "page_end": page_end},
            "content": content,
            "items": result["items"],
            "truncated": truncated,
            "summary": {
                "page_count": len(result["items"]),
                "char_count": len(content),
                "document_type": "pdf",
                "segment_type": "pdf_page_range",
            },
        }

    def _read_pdf_line_segment(
        self,
        file_path: Path,
        locator: dict[str, Any],
        *,
        include_context: int,
        max_chars: int,
    ) -> dict[str, Any]:
        page_number = self._normalize_positive_int(locator.get("page_number"), "page_number")
        line_start = self._normalize_positive_int(locator.get("line_start", locator.get("start")), "line_start")
        line_end = self._normalize_positive_int(locator.get("line_end", locator.get("end")), "line_end")
        if line_end < line_start:
            raise ValueError("Invalid range: line_end must be >= line_start")

        line_spec = str(line_start) if line_start == line_end else f"{line_start}-{line_end}"
        result = read_pdf_lines(
            file_path,
            page_number=page_number,
            line_numbers=line_spec,
            include_context=max(0, include_context),
        )
        content_lines = []
        for item in result["items"]:
            line_number = int(item.get("line_number") or 0)
            line_text = str(item.get("text") or "")
            prefix = f"[L{line_number}]"
            if not bool(item.get("requested")):
                prefix = f"[Context L{line_number}]"
            content_lines.append(f"{prefix} {line_text}".rstrip())
        content = "\n".join(content_lines)
        content, truncated = self._truncate_content(content, max_chars)
        return {
            "document_type": "pdf",
            "segment_type": "pdf_line_range",
            "locator": {
                "page_number": page_number,
                "line_start": line_start,
                "line_end": line_end,
            },
            "content": content,
            "items": result["items"],
            "truncated": truncated,
            "summary": {
                "page_number": page_number,
                "line_count": len(result["items"]),
                "char_count": len(content),
                "document_type": "pdf",
                "segment_type": "pdf_line_range",
            },
        }

    def _read_word_segment(
        self,
        file_path: Path,
        locator: dict[str, Any],
        *,
        include_context: int,
        max_chars: int,
    ) -> dict[str, Any]:
        paragraph_start = self._normalize_positive_int(
            locator.get("paragraph_start", locator.get("start")),
            "paragraph_start",
        )
        paragraph_end = self._normalize_positive_int(
            locator.get("paragraph_end", locator.get("end")),
            "paragraph_end",
        )
        if paragraph_end < paragraph_start:
            raise ValueError("Invalid range: paragraph_end must be >= paragraph_start")

        result = read_word_paragraphs(
            file_path,
            paragraph_start=paragraph_start,
            paragraph_end=paragraph_end,
            include_context=max(0, include_context),
        )
        content_lines = []
        for item in result["items"]:
            paragraph_index = int(item.get("paragraph_index") or 0)
            paragraph_text = str(item.get("text") or "")
            prefix = f"[P{paragraph_index}]"
            if not bool(item.get("requested")):
                prefix = f"[Context P{paragraph_index}]"
            content_lines.append(f"{prefix} {paragraph_text}".rstrip())
        content = "\n".join(content_lines)
        content, truncated = self._truncate_content(content, max_chars)
        return {
            "document_type": "docx",
            "segment_type": "word_paragraph_range",
            "locator": {
                "paragraph_start": paragraph_start,
                "paragraph_end": paragraph_end,
            },
            "content": content,
            "items": result["items"],
            "truncated": truncated,
            "summary": {
                "line_count": len(result["items"]),
                "char_count": len(content),
                "document_type": "docx",
                "segment_type": "word_paragraph_range",
            },
        }

    @staticmethod
    def _format_word_table_row(
        cells: list[dict[str, Any]],
        *,
        table_type: str,
        column_headers: list[str],
        include_headers: bool,
    ) -> str:
        values = [str(cell.get("text") or "").strip() for cell in cells]
        if include_headers and column_headers:
            parts = []
            for index, value in enumerate(values):
                if not value:
                    continue
                header = column_headers[index] if index < len(column_headers) else f"C{index + 1}"
                parts.append(f"{header}={value}")
            if parts:
                return " | ".join(parts)

        non_empty = [value for value in values if value]
        if table_type == "key_value" and len(non_empty) == 2 and len(non_empty[0]) <= 80:
            return f"{non_empty[0]}: {non_empty[1]}"
        return " | ".join(non_empty)

    def _read_word_table_segment(
        self,
        file_path: Path,
        locator: dict[str, Any],
        *,
        include_context: int,
        max_chars: int,
    ) -> dict[str, Any]:
        table_index = self._normalize_positive_int(locator.get("table_index"), "table_index")
        row_start = locator.get("row_start", locator.get("start"))
        row_end = locator.get("row_end", locator.get("end"))
        column_start = locator.get("column_start")
        column_end = locator.get("column_end")

        result = read_word_table_rows(
            file_path,
            table_index=table_index,
            row_start=int(row_start) if row_start is not None else None,
            row_end=int(row_end) if row_end is not None else None,
            column_start=int(column_start) if column_start is not None else None,
            column_end=int(column_end) if column_end is not None else None,
            include_context=max(0, include_context),
        )

        content_lines = [f"[Table {result['table_index']}] {str(result.get('title') or '').strip()}".rstrip()]
        column_headers = [str(value or "") for value in result.get("column_headers") or []]
        header_row_index = int(result["header_row_index"]) if result.get("header_row_index") else None
        table_type = str(result.get("table_type") or "grid")

        for item in result["items"]:
            row_index = int(item.get("row_index") or 0)
            if bool(item.get("is_header")):
                prefix = f"[Header R{row_index}]"
            elif not bool(item.get("requested")):
                prefix = f"[Context R{row_index}]"
            else:
                prefix = f"[R{row_index}]"

            row_text = self._format_word_table_row(
                list(item.get("cells") or []),
                table_type=table_type,
                column_headers=column_headers,
                include_headers=header_row_index is not None and row_index != header_row_index,
            )
            content_lines.append(f"{prefix} {row_text}".rstrip())

        content = "\n".join(line for line in content_lines if line.strip())
        content, truncated = self._truncate_content(content, max_chars)
        return {
            "document_type": "docx",
            "segment_type": "word_table_range",
            "locator": {
                "table_index": table_index,
                "row_start": int(result["row_start"]),
                "row_end": int(result["row_end"]),
                "column_start": int(result["column_start"]),
                "column_end": int(result["column_end"]),
            },
            "content": content,
            "items": result["items"],
            "truncated": truncated,
            "summary": {
                "line_count": len(result["items"]),
                "row_count": len(result["items"]),
                "char_count": len(content),
                "document_type": "docx",
                "segment_type": "word_table_range",
            },
        }

    def _read_excel_segment(
        self,
        file_path: Path,
        locator: dict[str, Any],
        *,
        include_context: int,
        max_chars: int,
    ) -> dict[str, Any]:
        sheet_name = str(locator.get("sheet_name") or "").strip()
        if not sheet_name:
            raise ValueError("sheet_name is required for excel_range")

        row_start = locator.get("row_start", locator.get("start"))
        row_end = locator.get("row_end", locator.get("end"))
        column_start = locator.get("column_start")
        column_end = locator.get("column_end")

        result = read_excel_range(
            file_path,
            sheet_name=sheet_name,
            row_start=int(row_start) if row_start is not None else None,
            row_end=int(row_end) if row_end is not None else None,
            column_start=int(column_start) if column_start is not None else None,
            column_end=int(column_end) if column_end is not None else None,
            include_context=max(0, include_context),
        )

        column_headers = [str(value or "") for value in result.get("column_headers") or []]
        header_row_index = int(result["header_row_index"]) if result.get("header_row_index") else None
        content_lines = [f"[Sheet {result['sheet_name']}]"]
        for item in result["items"]:
            row_index = int(item.get("row_index") or 0)
            if bool(item.get("is_header")):
                prefix = f"[Header R{row_index}]"
            elif not bool(item.get("requested")):
                prefix = f"[Context R{row_index}]"
            else:
                prefix = f"[R{row_index}]"

            values = [str(cell.get("text") or "").strip() for cell in item.get("cells") or []]
            parts = []
            if header_row_index is not None and row_index != header_row_index and column_headers:
                for index, value in enumerate(values):
                    if not value:
                        continue
                    header = column_headers[index] if index < len(column_headers) else f"C{index + 1}"
                    parts.append(f"{header}={value}")
            else:
                parts = [value for value in values if value]

            content_lines.append(f"{prefix} {' | '.join(parts)}".rstrip())

        content = "\n".join(line for line in content_lines if line.strip())
        content, truncated = self._truncate_content(content, max_chars)
        return {
            "document_type": "xlsx",
            "segment_type": "excel_range",
            "locator": {
                "sheet_name": sheet_name,
                "row_start": int(result["row_start"]),
                "row_end": int(result["row_end"]),
                "column_start": int(result["column_start"]),
                "column_end": int(result["column_end"]),
            },
            "content": content,
            "items": result["items"],
            "truncated": truncated,
            "summary": {
                "line_count": len(result["items"]),
                "row_count": len(result["items"]),
                "char_count": len(content),
                "document_type": "xlsx",
                "segment_type": "excel_range",
            },
        }

    def _read_pptx_segment(
        self,
        file_path: Path,
        locator: dict[str, Any],
        *,
        max_chars: int,
    ) -> dict[str, Any]:
        slide_start = self._normalize_positive_int(locator.get("slide_start", locator.get("slide_number", locator.get("start"))), "slide_start")
        slide_end = self._normalize_positive_int(locator.get("slide_end", locator.get("slide_number", locator.get("end", slide_start))), "slide_end")
        if slide_end < slide_start:
            raise ValueError("Invalid slide range: slide_end must be >= slide_start")

        result = read_pptx_slides(file_path, slide_start=slide_start, slide_end=slide_end)
        content_blocks = []
        for item in result["items"]:
            block_lines = [f"[Slide {int(item['slide_number'])}] {str(item.get('title') or '').strip()}".rstrip()]
            text = str(item.get("text") or "")
            notes_text = str(item.get("notes_text") or "")
            if text:
                block_lines.append(text)
            if notes_text:
                block_lines.append(f"[Notes]\n{notes_text}")
            content_blocks.append("\n".join(line for line in block_lines if line))
        content = "\n\n".join(content_blocks)
        content, truncated = self._truncate_content(content, max_chars)
        return {
            "document_type": "pptx",
            "segment_type": "pptx_slide_range",
            "locator": {
                "slide_start": slide_start,
                "slide_end": slide_end,
            },
            "content": content,
            "items": result["items"],
            "truncated": truncated,
            "summary": {
                "page_count": len(result["items"]),
                "char_count": len(content),
                "document_type": "pptx",
                "segment_type": "pptx_slide_range",
            },
        }

    async def execute(
        self,
        path: str,
        locator: dict[str, Any],
        include_context: int = 0,
        max_chars: int = MAX_SEGMENT_CHARS,
        encoding: str = "utf-8",
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        file_path, failure = self._resolve_file_path(
            path, workspace_path, tool_call_id, self.name,
            reference_library_roots=reference_library_roots,
        )
        if failure:
            return failure

        if not isinstance(locator, dict) or not locator:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="locator must be a non-empty object",
            )

        try:
            normalized_max_chars = max(1, min(200_000, int(max_chars)))
        except (TypeError, ValueError):
            normalized_max_chars = MAX_SEGMENT_CHARS

        suffix = file_path.suffix.lower()
        try:
            if suffix in TEXT_EXTENSIONS:
                segment = self._read_text_segment(
                    file_path,
                    locator,
                    encoding=encoding,
                    max_chars=normalized_max_chars,
                )
            elif suffix in WORD_EXTENSIONS:
                locator_type = str(locator.get("type") or "")
                if locator_type == "word_table_range" or locator.get("table_index") is not None:
                    segment = await asyncio.to_thread(
                        self._read_word_table_segment,
                        file_path,
                        locator,
                        include_context=include_context,
                        max_chars=normalized_max_chars,
                    )
                else:
                    segment = await asyncio.to_thread(
                        self._read_word_segment,
                        file_path,
                        locator,
                        include_context=include_context,
                        max_chars=normalized_max_chars,
                    )
            elif suffix in EXCEL_EXTENSIONS:
                segment = await asyncio.to_thread(
                    self._read_excel_segment,
                    file_path,
                    locator,
                    include_context=include_context,
                    max_chars=normalized_max_chars,
                )
            elif suffix in PPTX_EXTENSIONS:
                segment = await asyncio.to_thread(
                    self._read_pptx_segment,
                    file_path,
                    locator,
                    max_chars=normalized_max_chars,
                )
            elif suffix in PDF_EXTENSIONS:
                locator_type = str(locator.get("type") or "")
                if locator_type == "pdf_line_range" or (
                    not locator_type and locator.get("page_number") is not None
                ):
                    segment = await asyncio.to_thread(
                        self._read_pdf_line_segment,
                        file_path,
                        locator,
                        include_context=include_context,
                        max_chars=normalized_max_chars,
                    )
                else:
                    segment = await asyncio.to_thread(
                        self._read_pdf_page_segment,
                        file_path,
                        locator,
                        workspace_path=workspace_path,
                        max_chars=normalized_max_chars,
                    )
            else:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Unsupported file type for segment reading: {file_path.suffix or '(none)'}",
                )
        except (OSError, RuntimeError, UnicodeDecodeError, ValueError) as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "document_segment",
                "path": str(file_path),
                "document_type": segment["document_type"],
                "segment_type": segment["segment_type"],
                "locator": segment["locator"],
                "include_context": max(0, int(include_context))
                if isinstance(include_context, int) or str(include_context).isdigit()
                else 0,
                "truncated": segment["truncated"],
                "content": segment["content"],
                "items": segment["items"],
                "summary": segment["summary"],
            },
        )
