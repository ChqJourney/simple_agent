from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional

from document_readers.pdf_reader import get_pdf_info, get_pdf_outline, read_pdf_pages
from llms.base import BaseLLM

logger = logging.getLogger(__name__)

REFERENCE_INDEX_DIR_NAME = ".agent/reference_index"
CATALOG_FILE_NAME = "standard_catalog.json"
DOCUMENTS_DIR_NAME = "documents"
CATALOG_VERSION = 1
MAX_OUTLINE_TITLES = 12
MAX_SCOPE_PAGES = 4
MAX_SCOPE_TEXT_CHARS = 6000

SCOPE_TITLE_PATTERNS = (
    "scope",
    "范围",
    "适用范围",
    "scope and object",
)

STANDARD_CODE_PATTERN = re.compile(
    r"\b(?:IEC(?:\s+TRF)?|ISO|UL|EN|ASTM|ANSI|CISPR|GB/?T|GB|YY/?T|YY)"
    r"\s*[A-Z0-9]+(?:[-./][A-Z0-9]+){0,6}\b",
    re.IGNORECASE,
)

SUMMARY_PROMPT = (
    "You are summarizing the coverage of a standards PDF for retrieval routing. "
    "Use only the provided document evidence. Return strict JSON with keys "
    "`scope_summary` and `topics`. `scope_summary` must be one concise sentence. "
    "`topics` must be an array of up to 6 short phrases. If evidence is limited, "
    "say so briefly instead of guessing."
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _normalize_text(text: str) -> str:
    return " ".join(text.replace("\x00", " ").split()).strip()


def reference_root_index_dir(root_path: str | Path) -> Path:
    return Path(root_path).resolve() / REFERENCE_INDEX_DIR_NAME


def reference_root_catalog_path(root_path: str | Path) -> Path:
    return reference_root_index_dir(root_path) / CATALOG_FILE_NAME


def reference_root_documents_dir(root_path: str | Path) -> Path:
    return reference_root_index_dir(root_path) / DOCUMENTS_DIR_NAME


def _doc_id(relative_path: str) -> str:
    return hashlib.sha1(relative_path.encode("utf-8")).hexdigest()[:20]


def _doc_metadata_path(root_path: str | Path, relative_path: str) -> Path:
    return reference_root_documents_dir(root_path) / f"{_doc_id(relative_path)}.json"


def _path_to_rel(path: Path, root_path: Path) -> str:
    return str(path.relative_to(root_path)).replace("\\", "/")


def _modified_iso(stat_result: os.stat_result) -> str:
    return datetime.fromtimestamp(stat_result.st_mtime_ns / 1_000_000_000, tz=timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )


def _extract_standard_code(file_name: str, title: str) -> str:
    for candidate in (_safe_str(title), _safe_str(file_name), f"{_safe_str(file_name)} {_safe_str(title)}"):
        if not candidate:
            continue
        match = STANDARD_CODE_PATTERN.search(candidate)
        if match:
            return _normalize_text(match.group(0).upper().replace(" / ", "/"))
    return ""


def _load_catalog(catalog_path: Path) -> Optional[Dict[str, Any]]:
    if not catalog_path.exists():
        return None
    try:
        with catalog_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else None
    except Exception as exc:
        logger.warning("Failed to load reference catalog %s: %s", catalog_path, exc)
        return None


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _find_scope_outline_item(items: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    for item in items:
        title = _safe_str(item.get("title")).lower()
        if not title:
            continue
        if any(pattern in title for pattern in SCOPE_TITLE_PATTERNS):
            return item
    return None


def _scope_page_range(scope_item: dict[str, Any], outline_items: list[dict[str, Any]], page_count: int) -> tuple[int, int]:
    start_page = int(scope_item.get("page_number") or 1)
    next_pages = [
        int(item.get("page_number") or 0)
        for item in outline_items
        if int(item.get("page_number") or 0) > start_page
    ]
    if next_pages:
        end_page = max(start_page, min(next_pages) - 1)
    else:
        end_page = min(page_count, start_page + MAX_SCOPE_PAGES - 1)
    end_page = min(end_page, start_page + MAX_SCOPE_PAGES - 1, page_count)
    return start_page, max(start_page, end_page)


def _read_scope_excerpt(file_path: Path, page_count: int, outline_items: list[dict[str, Any]]) -> tuple[str, Dict[str, Any]]:
    scope_item = _find_scope_outline_item(outline_items)
    source: Dict[str, Any]

    if scope_item is not None:
        page_start, page_end = _scope_page_range(scope_item, outline_items, page_count)
        page_spec = str(page_start) if page_start == page_end else f"{page_start}-{page_end}"
        source = {
            "type": "outline_section",
            "label": _safe_str(scope_item.get("title")) or "Scope",
            "page_start": page_start,
            "page_end": page_end,
        }
    else:
        page_start = 1
        page_end = min(page_count, 3)
        page_spec = str(page_start) if page_start == page_end else f"{page_start}-{page_end}"
        source = {
            "type": "front_pages",
            "label": "Front pages",
            "page_start": page_start,
            "page_end": page_end,
        }

    result = read_pdf_pages(file_path, pages=page_spec, mode="page_text")
    items = result.get("items") if isinstance(result, dict) else None
    excerpt_blocks: list[str] = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            text = _normalize_text(_safe_str(item.get("text")))
            if not text:
                continue
            page_number = item.get("page_number")
            excerpt_blocks.append(f"[Page {page_number}] {text}".strip())
    excerpt = "\n\n".join(excerpt_blocks).strip()
    return excerpt[:MAX_SCOPE_TEXT_CHARS], source


def _extract_document_data_sync(file_path: Path, root_path: Path) -> Dict[str, Any]:
    stat_result = file_path.stat()
    info = get_pdf_info(file_path)
    outline = get_pdf_outline(file_path, max_depth=4)
    outline_items = outline.get("items") if isinstance(outline, dict) else []
    if not isinstance(outline_items, list):
        outline_items = []

    outline_titles = [
        _safe_str(item.get("title"))
        for item in outline_items
        if isinstance(item, dict) and _safe_str(item.get("title"))
    ][:MAX_OUTLINE_TITLES]

    metadata = info.get("metadata") if isinstance(info, dict) else {}
    title = ""
    if isinstance(metadata, dict):
        title = _safe_str(metadata.get("title"))
    if not title:
        title = outline_titles[0] if outline_titles else file_path.stem

    standard_code = _extract_standard_code(file_path.name, title)
    page_count = int(info.get("page_count") or 0)
    scope_excerpt = ""
    scope_source: Dict[str, Any] = {"type": "unknown"}
    if page_count > 0:
        try:
            scope_excerpt, scope_source = _read_scope_excerpt(file_path, page_count, outline_items)
        except Exception as exc:
            logger.warning("Failed to read scope excerpt from %s: %s", file_path, exc)

    relative_path = _path_to_rel(file_path, root_path)
    sha256 = hashlib.sha256(file_path.read_bytes()).hexdigest()

    return {
        "doc_id": _doc_id(relative_path),
        "relative_path": relative_path,
        "path": str(file_path.resolve()),
        "file_name": file_path.name,
        "title": title,
        "standard_code": standard_code,
        "page_count": page_count,
        "outline_titles": outline_titles,
        "outline_count": int(info.get("outline_count") or len(outline_titles)),
        "scope_excerpt": scope_excerpt,
        "scope_source": scope_source,
        "size_bytes": int(stat_result.st_size),
        "modified_at": _modified_iso(stat_result),
        "modified_at_ns": int(stat_result.st_mtime_ns),
        "sha256": sha256,
    }


def _fallback_scope_summary(document: Dict[str, Any]) -> str:
    excerpt = _normalize_text(_safe_str(document.get("scope_excerpt")))
    if excerpt:
        summary = excerpt[:240].rstrip(" ,;")
        return summary

    title = _safe_str(document.get("title"))
    outline_titles = document.get("outline_titles")
    if title and isinstance(outline_titles, list) and outline_titles:
        topics = ", ".join(_safe_str(item) for item in outline_titles[:4] if _safe_str(item))
        if topics:
            return f"{title}. Covers topics such as {topics}."
    return title or "No scope summary available."


def _extract_completion_content(response: Any) -> str:
    if isinstance(response, dict):
        choices = response.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content")
        return content if isinstance(content, str) else ""

    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", "") if message else ""
    return content if isinstance(content, str) else ""


async def summarize_document_scope(document: Dict[str, Any], llm: Optional[BaseLLM]) -> Dict[str, Any]:
    fallback_summary = _fallback_scope_summary(document)
    fallback_topics = [
        _safe_str(item)
        for item in (document.get("outline_titles") or [])[:6]
        if _safe_str(item)
    ]
    if llm is None:
        return {
            "scope_summary": fallback_summary,
            "topics": fallback_topics,
            "summary_source": "document_fallback",
        }

    payload = {
        "title": document.get("title"),
        "standard_code": document.get("standard_code"),
        "outline_titles": document.get("outline_titles"),
        "scope_source": document.get("scope_source"),
        "scope_excerpt": document.get("scope_excerpt"),
    }

    try:
        response = await llm.complete(
            [
                {"role": "system", "content": SUMMARY_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ]
        )
        raw_content = _extract_completion_content(response).strip()
        parsed = json.loads(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError("Scope summary response must be a JSON object")
        scope_summary = _normalize_text(_safe_str(parsed.get("scope_summary")))
        topics = parsed.get("topics")
        normalized_topics = (
            [_normalize_text(_safe_str(item)) for item in topics if _normalize_text(_safe_str(item))]
            if isinstance(topics, list)
            else []
        )[:6]
        return {
            "scope_summary": scope_summary or fallback_summary,
            "topics": normalized_topics or fallback_topics,
            "summary_source": "llm",
        }
    except Exception as exc:
        logger.warning(
            "Failed to summarize scope for %s: %s",
            document.get("path"),
            exc,
        )
        return {
            "scope_summary": fallback_summary,
            "topics": fallback_topics,
            "summary_source": "document_fallback",
        }


def _discover_pdf_files(root_path: Path) -> list[Path]:
    return sorted(
        [path for path in root_path.rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"],
        key=lambda candidate: _path_to_rel(candidate, root_path).lower(),
    )


def _existing_entries_by_relative_path(catalog: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    documents = catalog.get("documents") if isinstance(catalog, dict) else None
    if not isinstance(documents, list):
        return {}
    entries: Dict[str, Dict[str, Any]] = {}
    for item in documents:
        if not isinstance(item, dict):
            continue
        relative_path = _safe_str(item.get("relative_path"))
        if relative_path:
            entries[relative_path] = item
    return entries


async def _emit_progress(
    progress_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None] | None]],
    payload: Dict[str, Any],
) -> None:
    if progress_callback is None:
        return

    try:
        maybe_awaitable = progress_callback(payload)
        if inspect.isawaitable(maybe_awaitable):
            await maybe_awaitable
    except Exception as exc:
        logger.warning("Reference index progress callback failed: %s", exc)


def compute_reference_index_status(root_id: str, root_path: str) -> Dict[str, Any]:
    resolved_root_path = Path(root_path).resolve()
    catalog_path = reference_root_catalog_path(resolved_root_path)
    catalog = _load_catalog(catalog_path)
    existing_entries = _existing_entries_by_relative_path(catalog)

    if not resolved_root_path.exists() or not resolved_root_path.is_dir():
        return {
            "root_id": root_id,
            "root_path": str(resolved_root_path),
            "catalog_path": str(catalog_path),
            "exists": False,
            "status": "missing_root",
            "document_count": 0,
            "indexed_document_count": 0,
            "pending": {"new": 0, "updated": 0, "removed": 0, "unchanged": 0},
            "last_built_at": None,
        }

    discovered_files = _discover_pdf_files(resolved_root_path)
    discovered_rel_paths = {_path_to_rel(path, resolved_root_path): path for path in discovered_files}

    new_count = 0
    updated_count = 0
    unchanged_count = 0

    for relative_path, file_path in discovered_rel_paths.items():
        entry = existing_entries.get(relative_path)
        if entry is None:
            new_count += 1
            continue
        stat_result = file_path.stat()
        if (
            int(entry.get("size_bytes") or -1) == int(stat_result.st_size)
            and int(entry.get("modified_at_ns") or -1) == int(stat_result.st_mtime_ns)
        ):
            unchanged_count += 1
        else:
            updated_count += 1

    removed_count = len(set(existing_entries.keys()) - set(discovered_rel_paths.keys()))
    catalog_exists = catalog_path.exists() and catalog is not None
    stale = new_count > 0 or updated_count > 0 or removed_count > 0 or not catalog_exists

    return {
        "root_id": root_id,
        "root_path": str(resolved_root_path),
        "catalog_path": str(catalog_path),
        "exists": catalog_exists,
        "status": "stale" if stale else "ready",
        "document_count": len(discovered_files),
        "indexed_document_count": len(existing_entries),
        "pending": {
            "new": new_count,
            "updated": updated_count,
            "removed": removed_count,
            "unchanged": unchanged_count,
        },
        "last_built_at": catalog.get("generated_at") if isinstance(catalog, dict) else None,
    }


async def build_reference_index(
    root_id: str,
    root_path: str,
    *,
    llm: Optional[BaseLLM] = None,
    mode: str = "incremental",
    progress_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None] | None]] = None,
) -> Dict[str, Any]:
    resolved_root_path = Path(root_path).resolve()
    if not resolved_root_path.exists():
        raise FileNotFoundError(f"Reference root does not exist: {resolved_root_path}")
    if not resolved_root_path.is_dir():
        raise ValueError(f"Reference root is not a directory: {resolved_root_path}")

    normalized_mode = mode if mode in {"incremental", "rebuild"} else "incremental"
    root_dir = reference_root_index_dir(resolved_root_path)
    catalog_path = reference_root_catalog_path(resolved_root_path)
    docs_dir = reference_root_documents_dir(resolved_root_path)
    existing_catalog = None if normalized_mode == "rebuild" else _load_catalog(catalog_path)
    existing_entries = _existing_entries_by_relative_path(existing_catalog)

    await _emit_progress(
        progress_callback,
        {
            "phase": "scanning",
            "progress_percent": 0,
            "detail": "Scanning reference root for PDF files...",
            "total_documents": 0,
            "processed_documents": 0,
            "counts": {"created": 0, "updated": 0, "removed": 0, "unchanged": 0},
        },
    )
    discovered_files = _discover_pdf_files(resolved_root_path)
    total_documents = len(discovered_files)
    await _emit_progress(
        progress_callback,
        {
            "phase": "preparing",
            "progress_percent": 0 if total_documents > 0 else 100,
            "detail": (
                f"Found {total_documents} PDF file(s). Preparing to build the standard catalog..."
            ),
            "total_documents": total_documents,
            "processed_documents": 0,
            "counts": {"created": 0, "updated": 0, "removed": 0, "unchanged": 0},
        },
    )
    next_documents: list[Dict[str, Any]] = []
    kept_relative_paths: set[str] = set()

    created_count = 0
    updated_count = 0
    unchanged_count = 0
    processed_count = 0

    for file_path in discovered_files:
        relative_path = _path_to_rel(file_path, resolved_root_path)
        kept_relative_paths.add(relative_path)
        doc_metadata_path = _doc_metadata_path(resolved_root_path, relative_path)
        existing_entry = existing_entries.get(relative_path)
        stat_result = file_path.stat()
        is_unchanged = (
            normalized_mode != "rebuild"
            and existing_entry is not None
            and int(existing_entry.get("size_bytes") or -1) == int(stat_result.st_size)
            and int(existing_entry.get("modified_at_ns") or -1) == int(stat_result.st_mtime_ns)
            and doc_metadata_path.exists()
        )

        if is_unchanged:
            next_documents.append(existing_entry)
            unchanged_count += 1
            processed_count += 1
            await _emit_progress(
                progress_callback,
                {
                    "phase": "processing",
                    "progress_percent": int(processed_count * 100 / total_documents) if total_documents > 0 else 100,
                    "detail": f"Skipping unchanged PDF: {relative_path}",
                    "current_document": {
                        "relative_path": relative_path,
                        "file_name": file_path.name,
                    },
                    "total_documents": total_documents,
                    "processed_documents": processed_count,
                    "counts": {
                        "created": created_count,
                        "updated": updated_count,
                        "removed": 0,
                        "unchanged": unchanged_count,
                    },
                },
            )
            continue

        await _emit_progress(
            progress_callback,
            {
                "phase": "extracting",
                "progress_percent": int(processed_count * 100 / total_documents) if total_documents > 0 else 100,
                "detail": f"Reading PDF metadata and scope: {relative_path}",
                "current_document": {
                    "relative_path": relative_path,
                    "file_name": file_path.name,
                },
                "total_documents": total_documents,
                "processed_documents": processed_count,
                "counts": {
                    "created": created_count,
                    "updated": updated_count,
                    "removed": 0,
                    "unchanged": unchanged_count,
                },
            },
        )
        document = await asyncio.to_thread(_extract_document_data_sync, file_path, resolved_root_path)
        await _emit_progress(
            progress_callback,
            {
                "phase": "summarizing",
                "progress_percent": int(processed_count * 100 / total_documents) if total_documents > 0 else 100,
                "detail": f"Summarizing scope and topics: {relative_path}",
                "current_document": {
                    "relative_path": relative_path,
                    "file_name": file_path.name,
                },
                "total_documents": total_documents,
                "processed_documents": processed_count,
                "counts": {
                    "created": created_count,
                    "updated": updated_count,
                    "removed": 0,
                    "unchanged": unchanged_count,
                },
            },
        )
        summary = await summarize_document_scope(document, llm)
        document_payload = {
            **document,
            **summary,
        }
        catalog_entry = {
            "doc_id": document_payload["doc_id"],
            "relative_path": document_payload["relative_path"],
            "path": document_payload["path"],
            "file_name": document_payload["file_name"],
            "title": document_payload["title"],
            "standard_code": document_payload["standard_code"],
            "page_count": document_payload["page_count"],
            "outline_titles": document_payload["outline_titles"],
            "scope_summary": document_payload["scope_summary"],
            "scope_source": document_payload["scope_source"],
            "topics": document_payload["topics"],
            "summary_source": document_payload["summary_source"],
            "size_bytes": document_payload["size_bytes"],
            "modified_at": document_payload["modified_at"],
            "modified_at_ns": document_payload["modified_at_ns"],
            "sha256": document_payload["sha256"],
            "doc_metadata_path": str(doc_metadata_path),
        }
        await asyncio.to_thread(_write_json, doc_metadata_path, document_payload)
        next_documents.append(catalog_entry)
        if existing_entry is None:
            created_count += 1
        else:
            updated_count += 1
        processed_count += 1
        await _emit_progress(
            progress_callback,
            {
                "phase": "processing",
                "progress_percent": int(processed_count * 100 / total_documents) if total_documents > 0 else 100,
                "detail": (
                    f"Indexed {'new' if existing_entry is None else 'updated'} PDF: {relative_path}"
                ),
                "current_document": {
                    "relative_path": relative_path,
                    "file_name": file_path.name,
                },
                "total_documents": total_documents,
                "processed_documents": processed_count,
                "counts": {
                    "created": created_count,
                    "updated": updated_count,
                    "removed": 0,
                    "unchanged": unchanged_count,
                },
            },
        )

    removed_entries = [
        entry
        for relative_path, entry in existing_entries.items()
        if relative_path not in kept_relative_paths
    ]
    for entry in removed_entries:
        doc_metadata_path = _safe_str(entry.get("doc_metadata_path"))
        if doc_metadata_path:
            try:
                Path(doc_metadata_path).unlink(missing_ok=True)
            except Exception as exc:
                logger.warning("Failed to remove stale reference doc metadata %s: %s", doc_metadata_path, exc)

    await _emit_progress(
        progress_callback,
        {
            "phase": "writing_catalog",
            "progress_percent": 100 if total_documents > 0 else 100,
            "detail": "Writing standard catalog files...",
            "total_documents": total_documents,
            "processed_documents": processed_count,
            "counts": {
                "created": created_count,
                "updated": updated_count,
                "removed": len(removed_entries),
                "unchanged": unchanged_count,
            },
        },
    )
    generated_at = _utc_now_iso()
    catalog_payload = {
        "version": CATALOG_VERSION,
        "root_id": root_id,
        "root_path": str(resolved_root_path),
        "generated_at": generated_at,
        "mode": normalized_mode,
        "documents": sorted(next_documents, key=lambda item: _safe_str(item.get("relative_path")).lower()),
    }
    await asyncio.to_thread(_write_json, catalog_path, catalog_payload)

    # Ensure directories exist even when the root is currently empty.
    root_dir.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)

    await _emit_progress(
        progress_callback,
        {
            "phase": "completed",
            "progress_percent": 100,
            "detail": "Standard catalog build completed.",
            "total_documents": total_documents,
            "processed_documents": processed_count,
            "counts": {
                "created": created_count,
                "updated": updated_count,
                "removed": len(removed_entries),
                "unchanged": unchanged_count,
            },
            "generated_at": generated_at,
        },
    )

    return {
        "root_id": root_id,
        "root_path": str(resolved_root_path),
        "catalog_path": str(catalog_path),
        "generated_at": generated_at,
        "document_count": len(discovered_files),
        "indexed_document_count": len(next_documents),
        "counts": {
            "created": created_count,
            "updated": updated_count,
            "removed": len(removed_entries),
            "unchanged": unchanged_count,
        },
        "status": "ready",
    }
