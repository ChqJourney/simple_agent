from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from document_readers.excel_reader import get_excel_structure
from document_readers.pdf_reader import get_pdf_info, get_pdf_outline
from document_readers.pptx_reader import get_pptx_structure
from document_readers.word_reader import get_word_structure

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

MAX_TEXT_STRUCTURE_FILE_BYTES = 5 * 1024 * 1024
TEXT_SUPPORTED_EXTENSIONS = {".md", ".txt", ".rst"}
PDF_SUPPORTED_EXTENSIONS = {".pdf"}
WORD_SUPPORTED_EXTENSIONS = {".docx"}
EXCEL_SUPPORTED_EXTENSIONS = {".xlsx"}
PPTX_SUPPORTED_EXTENSIONS = {".pptx"}
MARKDOWN_HEADING_RE = re.compile(r"^(#{1,6})\s+(?P<title>.+?)\s*$")
NUMBERED_HEADING_RE = re.compile(r"^(?P<number>\d+(?:\.\d+){0,5})[\s.)-]+(?P<title>.+?)\s*$")


class GetDocumentStructureTool(BaseTool):
    name = "get_document_structure"
    description = (
        "Extract a lightweight structural map from a workspace document. "
        "Supports text documents, PDF files, Word documents, Excel workbooks, and PowerPoint decks."
    )
    display_name = "Get Document Structure"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 13
    use_when = "Use when you need heading structure, section anchors, outline entries, or approximate section boundaries."
    avoid_when = "Avoid when you only need a simple keyword search or already know the exact excerpt to read."
    user_summary_template = "Extracting document structure from {path}"
    result_preview_fields = ["summary", "nodes"]
    tags = ["document", "structure", "outline", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace",
            },
            "max_nodes": {
                "type": "integer",
                "default": 200,
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    @staticmethod
    def _make_anchor(text: str) -> str:
        anchor = re.sub(r"[^\w\s-]", "", text.lower()).strip()
        anchor = re.sub(r"[\s_]+", "-", anchor)
        return anchor

    @staticmethod
    def _build_text_nodes(lines: list[str], max_nodes: int) -> list[dict[str, Any]]:
        nodes: List[Dict[str, Any]] = []
        for line_number, line in enumerate(lines, start=1):
            markdown_match = MARKDOWN_HEADING_RE.match(line)
            if markdown_match:
                title = markdown_match.group("title").strip()
                nodes.append(
                    {
                        "title": title,
                        "level": len(markdown_match.group(1)),
                        "anchor": GetDocumentStructureTool._make_anchor(title),
                        "locator": {
                            "line_start": line_number,
                            "line_end": line_number,
                        },
                    }
                )
            else:
                numbered_match = NUMBERED_HEADING_RE.match(line)
                if numbered_match:
                    number = numbered_match.group("number")
                    title = numbered_match.group("title").strip()
                    node_title = f"{number} {title}".strip()
                    nodes.append(
                        {
                            "title": node_title,
                            "level": number.count(".") + 1,
                            "anchor": GetDocumentStructureTool._make_anchor(node_title),
                            "locator": {
                                "line_start": line_number,
                                "line_end": line_number,
                            },
                        }
                    )

            if len(nodes) >= max_nodes:
                break

        for index, node in enumerate(nodes):
            locator = node["locator"]
            next_line_start = (
                nodes[index + 1]["locator"]["line_start"] if index + 1 < len(nodes) else len(lines) + 1
            )
            locator["line_end"] = max(locator["line_start"], next_line_start - 1)

        return nodes[:max_nodes]

    @staticmethod
    def _build_pdf_nodes(file_path: Path, max_nodes: int) -> tuple[str, list[dict[str, Any]]]:
        outline = get_pdf_outline(file_path, max_depth=None)
        outline_items = outline.get("items", [])
        if outline_items:
            nodes: list[dict[str, Any]] = []
            for item in outline_items[:max_nodes]:
                title = str(item.get("title") or "").strip() or "Untitled"
                page_number = item.get("page_number")
                node = {
                    "title": title,
                    "level": int(item.get("level") or 1),
                    "anchor": GetDocumentStructureTool._make_anchor(title),
                    "locator": {
                        "page_number": page_number,
                    },
                }
                nodes.append(node)
            return "pdf_outline", nodes

        info = get_pdf_info(file_path)
        page_count = int(info.get("page_count") or 0)
        nodes = [
            {
                "title": f"Page {page_number}",
                "level": 1,
                "anchor": f"page-{page_number}",
                "locator": {
                    "page_number": page_number,
                },
            }
            for page_number in range(1, min(page_count, max_nodes) + 1)
        ]
        return "pdf_page_map", nodes

    async def execute(
        self,
        path: str,
        max_nodes: int = 200,
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

        try:
            normalized_max_nodes = max(1, min(1000, int(max_nodes)))
        except (TypeError, ValueError):
            normalized_max_nodes = 200

        suffix = file_path.suffix.lower()
        try:
            if suffix in TEXT_SUPPORTED_EXTENSIONS:
                file_size = file_path.stat().st_size
                if file_size > MAX_TEXT_STRUCTURE_FILE_BYTES:
                    return ToolResult(
                        tool_call_id=tool_call_id,
                        tool_name=self.name,
                        success=False,
                        output=None,
                        error=(
                            f"File too large: {file_size} bytes "
                            f"(max: {MAX_TEXT_STRUCTURE_FILE_BYTES} bytes)"
                        ),
                    )
                lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
                structure_type = "text_outline"
                document_type = "text"
                nodes = self._build_text_nodes(lines, normalized_max_nodes)
            elif suffix in PDF_SUPPORTED_EXTENSIONS:
                structure_type, nodes = self._build_pdf_nodes(file_path, normalized_max_nodes)
                document_type = "pdf"
            elif suffix in WORD_SUPPORTED_EXTENSIONS:
                structure = get_word_structure(file_path, max_nodes=normalized_max_nodes)
                structure_type = str(structure.get("structure_type") or "word_heading_map")
                document_type = "docx"
                nodes = list(structure.get("items") or [])
                table_count = int(structure.get("table_count") or 0)
            elif suffix in EXCEL_SUPPORTED_EXTENSIONS:
                structure = get_excel_structure(file_path, max_nodes=normalized_max_nodes)
                structure_type = str(structure.get("structure_type") or "excel_workbook_map")
                document_type = "xlsx"
                nodes = list(structure.get("items") or [])
                sheet_count = int(structure.get("sheet_count") or 0)
            elif suffix in PPTX_SUPPORTED_EXTENSIONS:
                structure = get_pptx_structure(file_path, max_nodes=normalized_max_nodes)
                structure_type = str(structure.get("structure_type") or "pptx_slide_map")
                document_type = "pptx"
                nodes = list(structure.get("items") or [])
                slide_count = int(structure.get("slide_count") or 0)
            else:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=False,
                    output=None,
                    error=f"Unsupported file type for structure extraction: {file_path.suffix or '(none)'}",
                )
        except (OSError, RuntimeError, ValueError) as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )

        summary = {
            "node_count": len(nodes[:normalized_max_nodes]),
            "max_level": max((int(node["level"]) for node in nodes[:normalized_max_nodes]), default=0),
            "document_type": document_type,
            "structure_type": structure_type,
        }
        if suffix in WORD_SUPPORTED_EXTENSIONS:
            summary["table_count"] = table_count
        if suffix in EXCEL_SUPPORTED_EXTENSIONS:
            summary["sheet_count"] = sheet_count
        if suffix in PPTX_SUPPORTED_EXTENSIONS:
            summary["slide_count"] = slide_count

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "document_structure",
                "path": str(file_path),
                "document_type": document_type,
                "structure_type": structure_type,
                "truncated": len(nodes) >= normalized_max_nodes,
                "nodes": nodes[:normalized_max_nodes],
                "summary": summary,
            },
        )
