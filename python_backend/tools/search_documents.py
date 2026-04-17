from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from document_readers.excel_reader import search_excel_workbook
from document_readers.pdf_reader import ExtractionOptions, PdfReader
from document_readers.pptx_reader import search_pptx_document
from document_readers.word_reader import search_word_document

from .base import BaseTool, ToolResult
from .path_utils import resolve_workspace_path

MAX_TEXT_SEARCH_FILE_BYTES = 2 * 1024 * 1024
MAX_PDF_SEARCH_FILE_BYTES = 25 * 1024 * 1024
MAX_WORD_SEARCH_FILE_BYTES = 10 * 1024 * 1024
MAX_EXCEL_SEARCH_FILE_BYTES = 15 * 1024 * 1024
MAX_PPTX_SEARCH_FILE_BYTES = 20 * 1024 * 1024
TEXT_EXTENSIONS = {
    ".md",
    ".txt",
    ".rst",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".csv",
    ".log",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".sql",
}
PDF_EXTENSIONS = {".pdf"}
WORD_EXTENSIONS = {".docx"}
EXCEL_EXTENSIONS = {".xlsx"}
PPTX_EXTENSIONS = {".pptx"}


class SearchDocumentsTool(BaseTool):
    name = "search_documents"
    description = (
        "Search across workspace documents and return structured matches with location metadata. "
        "Supports text documents, PDF files, Word documents, Excel workbooks, and PowerPoint decks. "
        "By default hidden files and directories are skipped unless include_hidden=true. "
        "Use mode='plain' for literal keyword search and mode='regex' only for true regular expressions."
    )
    display_name = "Search Documents"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 11
    use_when = "Use when you need to locate keywords, clauses, identifiers, or repeated phrases across documents."
    avoid_when = "Avoid when you already know the exact file and excerpt to read."
    user_summary_template = "Searching documents for {query}"
    result_preview_fields = ["summary", "results"]
    tags = ["document", "search", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search text. In mode='plain' this is matched literally; in mode='regex' this is a Python regular expression.",
            },
            "path": {
                "type": "string",
                "description": "Absolute path or path relative to current workspace. Use '.' to search the whole workspace.",
                "default": ".",
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
                "description": "Maximum number of matches to return across all files.",
            },
            "context_lines": {
                "type": "integer",
                "default": 2,
                "description": "Amount of nearby context to include. For text and PDF this means lines; for Word and Excel this means paragraphs or rows.",
            },
            "include_hidden": {
                "type": "boolean",
                "default": False,
                "description": "Whether to include hidden files and directories such as .agent or dotfiles when searching a directory.",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    @staticmethod
    def _document_type(path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix in PDF_EXTENSIONS:
            return "pdf"
        if suffix in WORD_EXTENSIONS:
            return "docx"
        if suffix in EXCEL_EXTENSIONS:
            return "xlsx"
        if suffix in PPTX_EXTENSIONS:
            return "pptx"
        if suffix in TEXT_EXTENSIONS:
            return "text"
        return "unsupported"

    @staticmethod
    def _relative_path(candidate: Path, root_path: Path, search_root: Path) -> str:
        rel_path = (
            candidate.relative_to(search_root if search_root.is_dir() else candidate.parent)
            if root_path.is_dir()
            else candidate.name
        )
        return str(rel_path).replace("\\", "/")

    @staticmethod
    def _compile_pattern(query: str, mode: str, case_sensitive: bool) -> re.Pattern[str]:
        flags = 0 if case_sensitive else re.IGNORECASE
        if mode == "regex":
            return re.compile(query, flags)
        return re.compile(re.escape(query), flags)

    def _search_text_file(
        self,
        candidate: Path,
        *,
        path_str: str,
        pattern: re.Pattern[str],
        max_results: int,
        context_lines: int,
        results: List[Dict[str, Any]],
    ) -> tuple[int, bool]:
        skipped_decode = 0
        truncated = False
        try:
            lines = candidate.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return skipped_decode, truncated
        except UnicodeDecodeError:
            return 1, truncated

        for line_index, line in enumerate(lines, start=1):
            if len(results) >= max_results:
                truncated = True
                break
            match = pattern.search(line)
            if not match:
                continue
            context_before = "\n".join(lines[max(0, line_index - 1 - context_lines): line_index - 1])
            context_after = "\n".join(lines[line_index: line_index + context_lines])
            results.append(
                {
                    "path": path_str,
                    "document_type": "text",
                    "locator": {
                        "line": line_index,
                        "column": match.start() + 1,
                    },
                    "line": line_index,
                    "column": match.start() + 1,
                    "match_text": match.group(0),
                    "context_before": context_before,
                    "context_after": context_after,
                }
            )

        return skipped_decode, truncated

    def _search_pdf_file(
        self,
        candidate: Path,
        *,
        path_str: str,
        pattern: re.Pattern[str],
        max_results: int,
        context_lines: int,
        results: List[Dict[str, Any]],
    ) -> bool:
        truncated = False
        with PdfReader(candidate) as reader:
            options = ExtractionOptions()
            for page_number in range(1, reader.page_count + 1):
                if len(results) >= max_results:
                    truncated = True
                    break

                content = reader._get_page_content(page_number, options)
                lines = content["lines"]
                for index, line in enumerate(lines):
                    if len(results) >= max_results:
                        truncated = True
                        break
                    line_text = str(line.get("text") or "")
                    match = pattern.search(line_text)
                    if not match:
                        continue

                    start = max(0, index - context_lines)
                    end = min(len(lines), index + context_lines + 1)
                    context_before = "\n".join(str(item.get("text") or "") for item in lines[start:index])
                    context_after = "\n".join(str(item.get("text") or "") for item in lines[index + 1:end])

                    results.append(
                        {
                            "path": path_str,
                            "document_type": "pdf",
                            "locator": {
                                "page_number": page_number,
                                "line_number": int(line.get("line_number") or 0),
                                "column": match.start() + 1,
                            },
                            "page_number": page_number,
                            "line_number": int(line.get("line_number") or 0),
                            "column": match.start() + 1,
                            "match_text": match.group(0),
                            "context_before": context_before,
                            "context_after": context_after,
                            "text": line_text,
                        }
                    )
        return truncated

    def _search_word_file(
        self,
        candidate: Path,
        *,
        path_str: str,
        query: str,
        mode: str,
        case_sensitive: bool,
        max_results: int,
        context_lines: int,
        results: List[Dict[str, Any]],
    ) -> bool:
        result = search_word_document(
            candidate,
            query,
            mode=mode,
            case_sensitive=case_sensitive,
            max_results=max_results - len(results),
            context_paragraphs=context_lines,
        )
        for item in result["items"]:
            locator: dict[str, Any] = {}
            for key in ("paragraph_index", "table_index", "row_index", "column_index"):
                if item.get(key) is not None:
                    locator[key] = int(item[key])

            search_result: dict[str, Any] = {
                "path": path_str,
                "document_type": "docx",
                "locator": locator,
                "match_source": str(item.get("source_type") or "paragraph"),
                "match_text": str(item["match_text"]),
                "context_before": str(item.get("context_before") or ""),
                "context_after": str(item.get("context_after") or ""),
                "text": str(item.get("text") or ""),
            }
            for key in (
                "paragraph_index",
                "table_index",
                "row_index",
                "column_index",
                "style_name",
                "table_title",
                "table_type",
                "section_title",
                "column_header",
                "row_text",
            ):
                if item.get(key) is not None and item.get(key) != "":
                    search_result[key] = item[key]

            results.append(
                search_result
            )
            if len(results) >= max_results:
                return True
        return False

    def _search_excel_file(
        self,
        candidate: Path,
        *,
        path_str: str,
        query: str,
        mode: str,
        case_sensitive: bool,
        max_results: int,
        context_lines: int,
        results: List[Dict[str, Any]],
    ) -> bool:
        result = search_excel_workbook(
            candidate,
            query,
            mode=mode,
            case_sensitive=case_sensitive,
            max_results=max_results - len(results),
            context_rows=context_lines,
        )
        for item in result["items"]:
            locator: dict[str, Any] = {
                "sheet_name": str(item["sheet_name"]),
                "row_index": int(item["row_index"]),
                "column_index": int(item["column_index"]),
            }
            search_result: dict[str, Any] = {
                "path": path_str,
                "document_type": "xlsx",
                "locator": locator,
                "match_source": str(item.get("source_type") or "cell"),
                "match_text": str(item["match_text"]),
                "context_before": str(item.get("context_before") or ""),
                "context_after": str(item.get("context_after") or ""),
                "text": str(item.get("text") or ""),
                "sheet_name": str(item["sheet_name"]),
                "row_index": int(item["row_index"]),
                "column_index": int(item["column_index"]),
            }
            for key in ("column_letter", "cell_ref", "column_header", "row_text"):
                if item.get(key) is not None and item.get(key) != "":
                    search_result[key] = item[key]
            results.append(search_result)
            if len(results) >= max_results:
                return True
        return False

    def _search_pptx_file(
        self,
        candidate: Path,
        *,
        path_str: str,
        query: str,
        mode: str,
        case_sensitive: bool,
        max_results: int,
        results: List[Dict[str, Any]],
    ) -> bool:
        result = search_pptx_document(
            candidate,
            query,
            mode=mode,
            case_sensitive=case_sensitive,
            max_results=max_results - len(results),
        )
        for item in result["items"]:
            locator: dict[str, Any] = {
                "slide_number": int(item["slide_number"]),
            }
            if item.get("shape_index") is not None:
                locator["shape_index"] = int(item["shape_index"])
            search_result: dict[str, Any] = {
                "path": path_str,
                "document_type": "pptx",
                "locator": locator,
                "match_source": str(item.get("source_type") or "slide_text"),
                "match_text": str(item["match_text"]),
                "context_before": str(item.get("context_before") or ""),
                "context_after": str(item.get("context_after") or ""),
                "text": str(item.get("text") or ""),
                "slide_number": int(item["slide_number"]),
                "slide_title": str(item.get("slide_title") or ""),
            }
            if item.get("shape_index") is not None:
                search_result["shape_index"] = int(item["shape_index"])
            results.append(search_result)
            if len(results) >= max_results:
                return True
        return False

    def _search_documents_sync(
        self,
        *,
        root_path: Path,
        query: str,
        mode: str,
        file_glob: Optional[str],
        case_sensitive: bool,
        max_results: int,
        context_lines: int,
        include_hidden: bool,
    ) -> dict[str, Any]:
        pattern = self._compile_pattern(query, mode, case_sensitive)
        search_root = root_path if root_path.is_dir() else root_path.parent

        def should_include(candidate: Path) -> bool:
            if include_hidden:
                return True
            try:
                relative_parts = candidate.relative_to(search_root).parts
            except ValueError:
                return True
            return not any(part.startswith(".") for part in relative_parts)

        candidate_files: List[Path] = []
        if root_path.is_file():
            candidate_files = [root_path]
        else:
            for candidate in search_root.rglob("*"):
                if not candidate.is_file():
                    continue
                if not should_include(candidate):
                    continue
                if file_glob and not candidate.match(file_glob):
                    continue
                candidate_files.append(candidate)

        results: List[Dict[str, Any]] = []
        matched_files: set[str] = set()
        skipped_unsupported = 0
        skipped_large = 0
        skipped_decode = 0
        skipped_parse_errors = 0
        truncated = False

        for candidate in sorted(candidate_files):
            if len(results) >= max_results:
                truncated = True
                break

            doc_type = self._document_type(candidate)
            if doc_type == "unsupported":
                skipped_unsupported += 1
                continue

            try:
                stat = candidate.stat()
            except OSError:
                continue

            if doc_type == "pdf":
                size_limit = MAX_PDF_SEARCH_FILE_BYTES
            elif doc_type == "docx":
                size_limit = MAX_WORD_SEARCH_FILE_BYTES
            elif doc_type == "xlsx":
                size_limit = MAX_EXCEL_SEARCH_FILE_BYTES
            elif doc_type == "pptx":
                size_limit = MAX_PPTX_SEARCH_FILE_BYTES
            else:
                size_limit = MAX_TEXT_SEARCH_FILE_BYTES
            if stat.st_size > size_limit:
                skipped_large += 1
                continue

            path_str = self._relative_path(candidate, root_path, search_root)
            result_count_before = len(results)

            if doc_type == "text":
                file_skipped_decode, file_truncated = self._search_text_file(
                    candidate,
                    path_str=path_str,
                    pattern=pattern,
                    max_results=max_results,
                    context_lines=context_lines,
                    results=results,
                )
                skipped_decode += file_skipped_decode
                truncated = truncated or file_truncated
            elif doc_type == "docx":
                try:
                    file_truncated = self._search_word_file(
                        candidate,
                        path_str=path_str,
                        query=query,
                        mode=mode,
                        case_sensitive=case_sensitive,
                        max_results=max_results,
                        context_lines=context_lines,
                        results=results,
                    )
                    truncated = truncated or file_truncated
                except (RuntimeError, ValueError, OSError):
                    skipped_parse_errors += 1
                    continue
            elif doc_type == "xlsx":
                try:
                    file_truncated = self._search_excel_file(
                        candidate,
                        path_str=path_str,
                        query=query,
                        mode=mode,
                        case_sensitive=case_sensitive,
                        max_results=max_results,
                        context_lines=context_lines,
                        results=results,
                    )
                    truncated = truncated or file_truncated
                except (RuntimeError, ValueError, OSError):
                    skipped_parse_errors += 1
                    continue
            elif doc_type == "pptx":
                try:
                    file_truncated = self._search_pptx_file(
                        candidate,
                        path_str=path_str,
                        query=query,
                        mode=mode,
                        case_sensitive=case_sensitive,
                        max_results=max_results,
                        results=results,
                    )
                    truncated = truncated or file_truncated
                except (RuntimeError, ValueError, OSError):
                    skipped_parse_errors += 1
                    continue
            else:
                try:
                    file_truncated = self._search_pdf_file(
                        candidate,
                        path_str=path_str,
                        pattern=pattern,
                        max_results=max_results,
                        context_lines=context_lines,
                        results=results,
                    )
                    truncated = truncated or file_truncated
                except (RuntimeError, ValueError, OSError):
                    skipped_parse_errors += 1
                    continue

            if len(results) > result_count_before:
                for item in results[result_count_before:]:
                    item["absolute_path"] = str(candidate)
                    item["resolved_root_path"] = str(root_path)
                matched_files.add(path_str)

        return {
            "event": "document_search_results",
            "query": query,
            "mode": mode,
            "resolved_root_path": str(root_path),
            "truncated": truncated,
            "results": results,
            "summary": {
                "hit_count": len(results),
                "file_count": len(matched_files),
                "skipped_unsupported": skipped_unsupported,
                "skipped_large": skipped_large,
                "skipped_decode_errors": skipped_decode,
                "skipped_parse_errors": skipped_parse_errors,
            },
        }

    async def execute(
        self,
        query: str,
        path: str = ".",
        mode: str = "plain",
        file_glob: Optional[str] = None,
        case_sensitive: bool = False,
        max_results: int = 50,
        context_lines: int = 2,
        include_hidden: bool = False,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        root_path, resolve_error = resolve_workspace_path(
            path,
            workspace_path,
            reference_library_roots=reference_library_roots,
            allow_reference_library=True,
        )
        if resolve_error or root_path is None:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=resolve_error or "Invalid path",
            )

        if not query.strip():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Query is empty",
            )

        if not root_path.exists():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Path not found: {path}",
            )

        try:
            normalized_max_results = max(1, min(500, int(max_results)))
        except (TypeError, ValueError):
            normalized_max_results = 50
        try:
            normalized_context_lines = max(0, min(10, int(context_lines)))
        except (TypeError, ValueError):
            normalized_context_lines = 2

        try:
            output = await asyncio.to_thread(
                self._search_documents_sync,
                root_path=root_path,
                query=query,
                mode=mode,
                file_glob=file_glob,
                case_sensitive=case_sensitive,
                max_results=normalized_max_results,
                context_lines=normalized_context_lines,
                include_hidden=include_hidden,
            )
        except re.error as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Invalid regular expression: {exc}",
            )

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output=output,
        )
