from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from runtime.reference_index import reference_root_catalog_path

from .base import BaseTool, ToolResult


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _tokenize_query(value: str) -> list[str]:
    return [token for token in re.split(r"[\s,;:()/_-]+", value.lower()) if token]


def _score_document(
    *,
    query: str,
    query_tokens: list[str],
    standard_code_filter: str,
    document: Dict[str, Any],
) -> float:
    score = 0.0
    normalized_query = query.lower()
    title = _normalize_text(document.get("title")).lower()
    standard_code = _normalize_text(document.get("standard_code")).lower()
    scope_summary = _normalize_text(document.get("scope_summary")).lower()
    outline_titles = " ".join(
        _normalize_text(item)
        for item in (document.get("outline_titles") or [])
        if _normalize_text(item)
    ).lower()
    topics = " ".join(
        _normalize_text(item)
        for item in (document.get("topics") or [])
        if _normalize_text(item)
    ).lower()
    haystacks = [title, standard_code, scope_summary, outline_titles, topics]

    if standard_code_filter:
        if standard_code == standard_code_filter:
            score += 20.0
        elif standard_code_filter in standard_code:
            score += 12.0

    if normalized_query and normalized_query in standard_code:
        score += 18.0
    if normalized_query and normalized_query in title:
        score += 12.0
    if normalized_query and normalized_query in scope_summary:
        score += 8.0
    if normalized_query and normalized_query in topics:
        score += 6.0

    for token in query_tokens:
        if token == standard_code_filter:
            continue
        if any(token == haystack for haystack in haystacks if haystack):
            score += 3.0
            continue
        if token and token in standard_code:
            score += 5.0
        if token and token in title:
            score += 4.0
        if token and token in scope_summary:
            score += 2.0
        if token and token in topics:
            score += 2.0
        if token and token in outline_titles:
            score += 1.5

    return score


def _build_follow_up_action(document: Dict[str, Any]) -> Dict[str, Any]:
    path = _normalize_text(document.get("path"))
    file_type = _normalize_text(document.get("file_type")).lower()
    if not file_type and path:
        file_type = Path(path).suffix.lower().lstrip(".")
    scope_source = document.get("scope_source")
    outline_titles = [
        _normalize_text(title)
        for title in (document.get("outline_titles") or [])
        if _normalize_text(title)
    ]

    if file_type == "md":
        if isinstance(scope_source, dict):
            line_start = scope_source.get("line_start")
            line_end = scope_source.get("line_end")
            label = _normalize_text(scope_source.get("label")) or "Scope"
            if isinstance(line_start, int) and isinstance(line_end, int):
                return {
                    "tool": "read_document_segment",
                    "path": path,
                    "locator": {
                        "type": "text_line_range",
                        "line_start": line_start,
                        "line_end": line_end,
                    },
                    "reason": f"Read the {label} section first to confirm applicability.",
                }

        if outline_titles:
            return {
                "tool": "get_document_structure",
                "path": path,
                "reason": "Inspect the markdown heading structure first, then open Scope or the closest matching section.",
            }

        return {
            "tool": "file_read",
            "path": path,
            "reason": "Start with the opening lines to confirm scope and structure.",
        }

    if isinstance(scope_source, dict):
        page_start = scope_source.get("page_start")
        page_end = scope_source.get("page_end")
        label = _normalize_text(scope_source.get("label")) or "Scope"
        if isinstance(page_start, int) and isinstance(page_end, int):
            return {
                "tool": "pdf_read_pages",
                "path": path,
                "page_start": page_start,
                "page_end": page_end,
                "reason": f"Read the {label} pages first to confirm applicability.",
            }

    if outline_titles:
        return {
            "tool": "pdf_get_outline",
            "path": path,
            "reason": "Inspect the PDF outline first, then open Scope or the closest matching section.",
        }

    return {
        "tool": "pdf_get_info",
        "path": path,
        "reason": "Start with document metadata, then inspect the opening pages for scope and structure.",
    }


def _build_top_level_next_actions(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    actions: List[Dict[str, Any]] = []
    for item in results[:3]:
        follow_up = item.get("recommended_follow_up")
        if not isinstance(follow_up, dict):
            continue
        actions.append(
            {
                "standard_code": _normalize_text(item.get("standard_code")),
                "title": _normalize_text(item.get("title")),
                "path": _normalize_text(item.get("path")),
                "file_type": _normalize_text(item.get("file_type")),
                "tool": _normalize_text(follow_up.get("tool")),
                "reason": _normalize_text(follow_up.get("reason")),
                "page_start": follow_up.get("page_start"),
                "page_end": follow_up.get("page_end"),
                "locator": follow_up.get("locator") if isinstance(follow_up.get("locator"), dict) else None,
            }
        )
    return actions


class SearchStandardCatalogTool(BaseTool):
    name = "search_standard_catalog"
    description = (
        "Search the generated standard catalog files under configured reference-library roots "
        "to quickly identify which standard documents are likely relevant before opening large files."
    )
    display_name = "Search Standard Catalog"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 9
    use_when = (
        "Use when a reference-library standard catalog exists and you need to decide which standard documents "
        "to inspect before reading outlines, sections, pages, or clauses."
    )
    avoid_when = "Avoid when the exact target PDF is already known or when no standard catalog has been built yet."
    user_summary_template = "Searching the standard catalog for {query}"
    result_preview_fields = ["summary", "results"]
    tags = ["document", "reference-library", "catalog", "safe-read"]
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Free-text search query describing the product, topic, or requirement domain.",
            },
            "standard_code": {
                "type": "string",
                "description": "Optional standard code hint such as IEC 60335-1 or UL 60335-1.",
            },
            "max_results": {
                "type": "integer",
                "default": 8,
                "description": "Maximum number of candidate standards to return across all indexed roots.",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        query: str,
        standard_code: str = "",
        max_results: int = 8,
        tool_call_id: str = "",
        reference_library_roots: Optional[list[str]] = None,
        **_: Any,
    ) -> ToolResult:
        normalized_query = _normalize_text(query)
        if not normalized_query:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Query is empty",
            )

        try:
            normalized_max_results = max(1, min(25, int(max_results)))
        except (TypeError, ValueError):
            normalized_max_results = 8

        query_tokens = _tokenize_query(normalized_query)
        standard_code_filter = _normalize_text(standard_code).lower()
        results: List[Dict[str, Any]] = []
        indexed_root_count = 0
        indexed_document_count = 0

        for root in reference_library_roots or []:
            catalog_path = reference_root_catalog_path(root)
            if not catalog_path.exists():
                continue

            try:
                with catalog_path.open("r", encoding="utf-8") as f:
                    payload = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue

            documents = payload.get("documents")
            if not isinstance(documents, list):
                continue

            indexed_root_count += 1
            indexed_document_count += len(documents)

            for item in documents:
                if not isinstance(item, dict):
                    continue
                score = _score_document(
                    query=normalized_query,
                    query_tokens=query_tokens,
                    standard_code_filter=standard_code_filter,
                    document=item,
                )
                if score <= 0:
                    continue

                results.append(
                    {
                        "catalog_path": str(catalog_path),
                        "root_path": _normalize_text(payload.get("root_path")) or str(Path(root).resolve()),
                        "path": _normalize_text(item.get("path")),
                        "relative_path": _normalize_text(item.get("relative_path")),
                        "file_name": _normalize_text(item.get("file_name")),
                        "file_type": _normalize_text(item.get("file_type")),
                        "title": _normalize_text(item.get("title")),
                        "standard_code": _normalize_text(item.get("standard_code")),
                        "scope_summary": _normalize_text(item.get("scope_summary")),
                        "scope_source": item.get("scope_source") if isinstance(item.get("scope_source"), dict) else {},
                        "topics": [
                            _normalize_text(topic)
                            for topic in (item.get("topics") or [])
                            if _normalize_text(topic)
                        ],
                        "outline_titles": [
                            _normalize_text(title)
                            for title in (item.get("outline_titles") or [])
                            if _normalize_text(title)
                        ],
                        "score": round(score, 3),
                    }
                )

        if indexed_root_count == 0:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=(
                    "No standard catalog is available under the configured reference-library roots. "
                    "Build the catalog in Settings or fall back to search_documents."
                ),
            )

        ordered_results = sorted(
            results,
            key=lambda item: (
                -float(item.get("score") or 0),
                _normalize_text(item.get("standard_code")).lower(),
                _normalize_text(item.get("file_name")).lower(),
            ),
        )[:normalized_max_results]
        for item in ordered_results:
            item["recommended_follow_up"] = _build_follow_up_action(item)

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output={
                "event": "standard_catalog_search_results",
                "query": normalized_query,
                "standard_code": _normalize_text(standard_code),
                "results": ordered_results,
                "recommended_next_actions": _build_top_level_next_actions(ordered_results),
                "summary": {
                    "indexed_root_count": indexed_root_count,
                    "indexed_document_count": indexed_document_count,
                    "hit_count": len(ordered_results),
                },
            },
        )
