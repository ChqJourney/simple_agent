from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from runtime.config import get_enabled_reference_library_roots

from .base import BaseTool, ToolResult
from .path_utils import resolve_path_in_root
from .read_document_segment import MAX_SEGMENT_CHARS, ReadDocumentSegmentTool
from .search_documents import (
    EXCEL_EXTENSIONS,
    MAX_EXCEL_SEARCH_FILE_BYTES,
    MAX_PDF_SEARCH_FILE_BYTES,
    MAX_PPTX_SEARCH_FILE_BYTES,
    MAX_TEXT_SEARCH_FILE_BYTES,
    MAX_WORD_SEARCH_FILE_BYTES,
    PDF_EXTENSIONS,
    PPTX_EXTENSIONS,
    TEXT_EXTENSIONS,
    WORD_EXTENSIONS,
    SearchDocumentsTool,
)


@dataclass(frozen=True)
class ReferenceLibraryRoot:
    root_id: str
    label: str
    path: Path
    kinds: tuple[str, ...]


class _ReferenceLibraryToolMixin:
    def __init__(self, config_getter: Callable[[], Optional[Dict[str, Any]]]) -> None:
        super().__init__()
        self._config_getter = config_getter

    def _resolve_roots(
        self,
        *,
        root_id: Optional[str] = None,
        kind: Optional[str] = None,
    ) -> tuple[List[ReferenceLibraryRoot], Optional[str]]:
        normalized_root_id = str(root_id or "").strip()
        normalized_kind = str(kind or "").strip().lower()
        if normalized_kind and normalized_kind not in {"standard", "checklist", "guidance"}:
            return [], f"Unsupported reference library kind: {kind}"

        config = self._config_getter() or {}
        roots = []
        for root in get_enabled_reference_library_roots(config, kind=normalized_kind or None):
            path = Path(str(root.get("path") or "")).resolve()
            if not path.exists() or not path.is_dir():
                continue
            candidate_root_id = str(root.get("id") or "").strip()
            if normalized_root_id and candidate_root_id != normalized_root_id:
                continue
            roots.append(
                ReferenceLibraryRoot(
                    root_id=candidate_root_id or str(path),
                    label=str(root.get("label") or "").strip() or path.name or str(path),
                    path=path,
                    kinds=tuple(
                        str(item or "").strip().lower()
                        for item in (root.get("kinds") or [])
                        if str(item or "").strip()
                    ),
                )
            )

        if roots:
            return roots, None

        if normalized_root_id:
            return [], f"Reference library root is not available: {normalized_root_id}"
        return [], "No enabled reference library roots are configured."


class SearchReferenceLibraryTool(_ReferenceLibraryToolMixin, BaseTool):
    name = "search_reference_library"
    description = (
        "Search across enabled global reference library folders and return structured matches with source metadata. "
        "Use this to find clauses, standard numbers, requirements, or guidance text in approved reference materials."
    )
    display_name = "Search Reference Library"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 14
    use_when = "Use when you need evidence from configured standards, checklists, or guidance libraries."
    avoid_when = "Avoid when the answer is already available in the current workspace or conversation."
    user_summary_template = "Searching reference library for {query}"
    result_preview_fields = ["summary", "results"]
    tags = ["reference-library", "document", "search", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search text. In mode='plain' this is matched literally; in mode='regex' this is a Python regular expression.",
            },
            "root_id": {
                "type": "string",
                "description": "Optional reference library root id to limit the search to a single configured root.",
            },
            "kind": {
                "type": "string",
                "enum": ["standard", "checklist", "guidance"],
                "description": "Optional reference library kind filter.",
            },
            "mode": {
                "type": "string",
                "enum": ["plain", "regex"],
                "default": "plain",
                "description": "Search mode: 'plain' treats query as literal text, 'regex' treats query as a regular expression.",
            },
            "file_glob": {
                "type": "string",
                "description": "Optional file filter such as '*.pdf', '*.docx', '*.xlsx', or '*.md'.",
            },
            "case_sensitive": {
                "type": "boolean",
                "default": False,
                "description": "Whether matching should respect uppercase/lowercase differences.",
            },
            "max_results": {
                "type": "integer",
                "default": 50,
                "description": "Maximum number of matches to return across all reference roots.",
            },
            "context_lines": {
                "type": "integer",
                "default": 2,
                "description": "Amount of nearby context to include. For text and PDF this means lines; for Word and Excel this means paragraphs or rows.",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    def __init__(self, config_getter: Callable[[], Optional[Dict[str, Any]]]) -> None:
        super().__init__(config_getter)
        self._search_documents = SearchDocumentsTool()

    async def execute(
        self,
        query: str,
        root_id: Optional[str] = None,
        kind: Optional[str] = None,
        mode: str = "plain",
        file_glob: Optional[str] = None,
        case_sensitive: bool = False,
        max_results: int = 50,
        context_lines: int = 2,
        tool_call_id: str = "",
        **_: Any,
    ) -> ToolResult:
        roots, root_error = self._resolve_roots(root_id=root_id, kind=kind)
        if root_error:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=root_error,
            )

        if not query.strip():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Query is empty",
            )

        try:
            pattern = self._search_documents._compile_pattern(query, mode, case_sensitive)
        except re.error as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Invalid regular expression: {exc}",
            )

        try:
            normalized_max_results = max(1, min(500, int(max_results)))
        except (TypeError, ValueError):
            normalized_max_results = 50
        try:
            normalized_context_lines = max(0, min(10, int(context_lines)))
        except (TypeError, ValueError):
            normalized_context_lines = 2

        results: List[Dict[str, Any]] = []
        matched_files: set[str] = set()
        matched_roots: set[str] = set()
        skipped_unsupported = 0
        skipped_large = 0
        skipped_decode = 0
        skipped_parse_errors = 0
        truncated = False

        for root in roots:
            if len(results) >= normalized_max_results:
                truncated = True
                break

            candidate_files: List[Path] = []
            for candidate in root.path.rglob("*"):
                if not candidate.is_file():
                    continue
                if file_glob and not candidate.match(file_glob):
                    continue
                candidate_files.append(candidate)

            for candidate in sorted(candidate_files):
                if len(results) >= normalized_max_results:
                    truncated = True
                    break

                doc_type = self._search_documents._document_type(candidate)
                if doc_type == "unsupported":
                    skipped_unsupported += 1
                    continue

                try:
                    stat = candidate.stat()
                except OSError:
                    continue

                if doc_type == "pdf":
                    limit = MAX_PDF_SEARCH_FILE_BYTES
                elif doc_type == "docx":
                    limit = MAX_WORD_SEARCH_FILE_BYTES
                elif doc_type == "xlsx":
                    limit = MAX_EXCEL_SEARCH_FILE_BYTES
                elif doc_type == "pptx":
                    limit = MAX_PPTX_SEARCH_FILE_BYTES
                else:
                    limit = MAX_TEXT_SEARCH_FILE_BYTES
                if stat.st_size > limit:
                    skipped_large += 1
                    continue

                path_str = str(candidate.relative_to(root.path)).replace("\\", "/")
                result_count_before = len(results)

                try:
                    if doc_type == "text":
                        file_skipped_decode, file_truncated = self._search_documents._search_text_file(
                            candidate,
                            path_str=path_str,
                            pattern=pattern,
                            max_results=normalized_max_results,
                            context_lines=normalized_context_lines,
                            results=results,
                        )
                        skipped_decode += file_skipped_decode
                        truncated = truncated or file_truncated
                    elif doc_type == "docx":
                        file_truncated = self._search_documents._search_word_file(
                            candidate,
                            path_str=path_str,
                            query=query,
                            mode=mode,
                            case_sensitive=case_sensitive,
                            max_results=normalized_max_results,
                            context_lines=normalized_context_lines,
                            results=results,
                        )
                        truncated = truncated or file_truncated
                    elif doc_type == "xlsx":
                        file_truncated = self._search_documents._search_excel_file(
                            candidate,
                            path_str=path_str,
                            query=query,
                            mode=mode,
                            case_sensitive=case_sensitive,
                            max_results=normalized_max_results,
                            context_lines=normalized_context_lines,
                            results=results,
                        )
                        truncated = truncated or file_truncated
                    elif doc_type == "pptx":
                        file_truncated = self._search_documents._search_pptx_file(
                            candidate,
                            path_str=path_str,
                            query=query,
                            mode=mode,
                            case_sensitive=case_sensitive,
                            max_results=normalized_max_results,
                            results=results,
                        )
                        truncated = truncated or file_truncated
                    else:
                        file_truncated = self._search_documents._search_pdf_file(
                            candidate,
                            path_str=path_str,
                            pattern=pattern,
                            max_results=normalized_max_results,
                            context_lines=normalized_context_lines,
                            results=results,
                        )
                        truncated = truncated or file_truncated
                except (RuntimeError, ValueError, OSError):
                    skipped_parse_errors += 1
                    continue

                if len(results) > result_count_before:
                    matched_files.add(f"{root.root_id}:{path_str}")
                    matched_roots.add(root.root_id)
                    for item in results[result_count_before:]:
                        item["source"] = "reference_library"
                        item["root_id"] = root.root_id
                        item["root_label"] = root.label
                        item["root_path"] = str(root.path)

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "reference_library_search_results",
                "source": "reference_library",
                "query": query,
                "mode": mode,
                "truncated": truncated,
                "results": results,
                "summary": {
                    "hit_count": len(results),
                    "file_count": len(matched_files),
                    "root_count": len(matched_roots),
                    "skipped_unsupported": skipped_unsupported,
                    "skipped_large": skipped_large,
                    "skipped_decode_errors": skipped_decode,
                    "skipped_parse_errors": skipped_parse_errors,
                },
            },
        )


class ReadReferenceSegmentTool(_ReferenceLibraryToolMixin, BaseTool):
    name = "read_reference_segment"
    description = (
        "Read a narrow segment from a configured reference library document using a structured locator. "
        "Use the `root_id` and relative `path` returned by `search_reference_library`."
    )
    display_name = "Read Reference Segment"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 15
    use_when = "Use when you already know which reference document and locator you need to inspect."
    avoid_when = "Avoid when you still need to discover the relevant clause or source document."
    user_summary_template = "Reading reference segment from {path}"
    result_preview_fields = ["summary", "content"]
    tags = ["reference-library", "document", "safe-read", "excerpt", "segment"]
    parameters = {
        "type": "object",
        "properties": {
            "root_id": {
                "type": "string",
                "description": "Reference library root id.",
            },
            "path": {
                "type": "string",
                "description": "Path relative to the selected reference library root.",
            },
            "locator": ReadDocumentSegmentTool.parameters["properties"]["locator"],
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
        "required": ["root_id", "path", "locator"],
        "additionalProperties": False,
    }

    def __init__(self, config_getter: Callable[[], Optional[Dict[str, Any]]]) -> None:
        super().__init__(config_getter)
        self._read_document_segment = ReadDocumentSegmentTool()

    async def execute(
        self,
        root_id: str,
        path: str,
        locator: dict[str, Any],
        include_context: int = 0,
        max_chars: int = MAX_SEGMENT_CHARS,
        encoding: str = "utf-8",
        tool_call_id: str = "",
        **_: Any,
    ) -> ToolResult:
        roots, root_error = self._resolve_roots(root_id=root_id)
        if root_error:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=root_error,
            )

        root = roots[0]
        file_path, resolve_error = resolve_path_in_root(path, root.path)
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
                segment = self._read_document_segment._read_text_segment(
                    file_path,
                    locator,
                    encoding=encoding,
                    max_chars=normalized_max_chars,
                )
            elif suffix in WORD_EXTENSIONS:
                locator_type = str(locator.get("type") or "")
                if locator_type == "word_table_range" or locator.get("table_index") is not None:
                    segment = self._read_document_segment._read_word_table_segment(
                        file_path,
                        locator,
                        include_context=include_context,
                        max_chars=normalized_max_chars,
                    )
                else:
                    segment = self._read_document_segment._read_word_segment(
                        file_path,
                        locator,
                        include_context=include_context,
                        max_chars=normalized_max_chars,
                    )
            elif suffix in EXCEL_EXTENSIONS:
                segment = self._read_document_segment._read_excel_segment(
                    file_path,
                    locator,
                    include_context=include_context,
                    max_chars=normalized_max_chars,
                )
            elif suffix in PPTX_EXTENSIONS:
                segment = self._read_document_segment._read_pptx_segment(
                    file_path,
                    locator,
                    max_chars=normalized_max_chars,
                )
            elif suffix in PDF_EXTENSIONS:
                locator_type = str(locator.get("type") or "")
                if locator_type == "pdf_line_range" or (
                    not locator_type and locator.get("page_number") is not None
                ):
                    segment = self._read_document_segment._read_pdf_line_segment(
                        file_path,
                        locator,
                        include_context=include_context,
                        max_chars=normalized_max_chars,
                    )
                else:
                    segment = self._read_document_segment._read_pdf_page_segment(
                        file_path,
                        locator,
                        workspace_path=None,
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
                "event": "reference_segment",
                "source": "reference_library",
                "root_id": root.root_id,
                "root_label": root.label,
                "root_path": str(root.path),
                "path": str(file_path.relative_to(root.path)).replace("\\", "/"),
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
