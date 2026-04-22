from __future__ import annotations

import base64
import hashlib
import html
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from core.user import Message, Session, validate_session_id
from llms.base import BaseLLM

logger = logging.getLogger(__name__)

STANDARD_QA_SCENARIO_ID = "standard_qa"
REPORT_CACHE_VERSION = 1
SUMMARY_KIND = "summary"
REPORT_KIND = "report"

SUMMARY_SYSTEM_PROMPT = (
    "You create concise professional summaries for Standard QA conversations. "
    "Return only a valid JSON object. Do not use markdown fences."
)

SUMMARY_USER_PROMPT = (
    "Summarize this full Standard QA conversation for a right-side preview panel. "
    "Use Chinese when the conversation is primarily Chinese; otherwise use the conversation language. "
    "Keep it compact but useful for a professional reviewer. "
    "Return exactly this JSON shape: "
    "{\"title\":\"...\",\"overview\":\"...\",\"key_points\":[\"...\"],"
    "\"evidence_highlights\":[\"...\"],\"open_questions\":[\"...\"]}. "
    "Preserve standard clause numbers, file names, page numbers, line numbers, and source labels when present."
)

REPORT_SYSTEM_PROMPT = (
    "You are a senior standards and compliance report writer. "
    "Create a polished, evidence-preserving Standard QA report from the entire conversation. "
    "Return only valid JSON. Do not use markdown fences or prose outside JSON."
)

REPORT_USER_PROMPT = (
    "Generate a professional PDF-ready report from the full Standard QA conversation. "
    "Write in the style of a concise scientific or engineering paper: abstract-like executive summary, "
    "clear scope, numbered findings, methodical question-by-question analysis, evidence traceability, "
    "limitations, and closure information. "
    "Use Chinese when the conversation is primarily Chinese; otherwise use the conversation language. "
    "The report must be suitable for human review, preserve evidence traceability, and explicitly keep "
    "standard clause numbers, file names, page numbers, line numbers, source labels, and short quoted "
    "evidence snippets when they appear in the conversation. If required evidence metadata is missing, "
    "state that source information is insufficient rather than inventing it. "
    "Return exactly this JSON shape: "
    "{"
    "\"title\":\"...\","
    "\"subtitle\":\"...\","
    "\"executive_summary\":\"...\","
    "\"scope\":\"...\","
    "\"key_findings\":[\"...\"],"
    "\"qa_sections\":[{"
    "\"question\":\"...\","
    "\"answer\":\"...\","
    "\"evidence\":[{"
    "\"standard_clause\":\"...\","
    "\"file\":\"...\","
    "\"page\":\"...\","
    "\"line\":\"...\","
    "\"quote\":\"...\","
    "\"explanation\":\"...\""
    "}],"
    "\"uncertainties\":[\"...\"]"
    "}],"
    "\"needed_information\":[\"...\"],"
    "\"appendix_notes\":[\"...\"]"
    "}. "
    "Do not omit qa_sections for substantive conversations."
)


class ReportGenerationError(Exception):
    """Raised when report generation cannot complete without fallback."""


ReportProgressCallback = Callable[[Dict[str, Any]], Awaitable[None]]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _reports_dir(workspace_path: str | Path) -> Path:
    return Path(workspace_path).resolve() / ".agent" / "reports"


def _cache_path(workspace_path: str | Path, session_id: str, kind: str) -> Path:
    safe_session_id = validate_session_id(session_id)
    return _reports_dir(workspace_path) / f"{safe_session_id}.standard-qa-{kind}.json"


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


def _get_chunk_choices(chunk: Any) -> List[Any]:
    if isinstance(chunk, dict):
        choices = chunk.get("choices")
        return choices if isinstance(choices, list) else []
    return getattr(chunk, "choices", []) or []


def _get_choice_field(choice: Any, field: str) -> Any:
    if isinstance(choice, dict):
        return choice.get(field)
    return getattr(choice, field, None)


def _get_delta_field(delta: Any, field: str) -> Any:
    if isinstance(delta, dict):
        return delta.get(field)
    return getattr(delta, field, None)


def _estimate_generated_tokens(text: str) -> int:
    if not text:
        return 0
    cjk_chars = sum(1 for char in text if "\u3400" <= char <= "\u9fff")
    non_cjk_chars = max(0, len(text) - cjk_chars)
    return max(1, cjk_chars + non_cjk_chars // 4)


def _parse_json_object(raw_content: str, *, label: str) -> Dict[str, Any]:
    cleaned = raw_content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ReportGenerationError(f"{label} LLM returned invalid JSON: {exc.msg}") from exc

    if not isinstance(parsed, dict):
        raise ReportGenerationError(f"{label} LLM response must be a JSON object.")
    return parsed


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _string_list(value: Any, *, limit: int = 12) -> List[str]:
    if not isinstance(value, list):
        return []
    items = [_stringify(item) for item in value]
    return [item for item in items if item][:limit]


def _normalize_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    overview = _stringify(payload.get("overview"))
    title = _stringify(payload.get("title")) or "Standard QA Summary"
    if not overview:
        raise ReportGenerationError("Summary LLM response is missing overview.")

    return {
        "title": title[:160],
        "overview": overview,
        "key_points": _string_list(payload.get("key_points"), limit=8),
        "evidence_highlights": _string_list(payload.get("evidence_highlights"), limit=8),
        "open_questions": _string_list(payload.get("open_questions"), limit=8),
    }


def _normalize_evidence(value: Any) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        return []

    normalized: List[Dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        entry = {
            "standard_clause": _stringify(item.get("standard_clause")),
            "file": _stringify(item.get("file")),
            "page": _stringify(item.get("page")),
            "line": _stringify(item.get("line")),
            "quote": _stringify(item.get("quote")),
            "explanation": _stringify(item.get("explanation")),
        }
        if any(entry.values()):
            normalized.append(entry)
    return normalized


def _normalize_report(payload: Dict[str, Any]) -> Dict[str, Any]:
    title = _stringify(payload.get("title")) or "Standard QA Report"
    executive_summary = _stringify(payload.get("executive_summary"))
    qa_sections_raw = payload.get("qa_sections")
    if not executive_summary:
        raise ReportGenerationError("Report LLM response is missing executive_summary.")
    if not isinstance(qa_sections_raw, list) or not qa_sections_raw:
        raise ReportGenerationError("Report LLM response is missing qa_sections.")

    qa_sections: List[Dict[str, Any]] = []
    for item in qa_sections_raw:
        if not isinstance(item, dict):
            continue
        question = _stringify(item.get("question"))
        answer = _stringify(item.get("answer"))
        if not question and not answer:
            continue
        qa_sections.append(
            {
                "question": question,
                "answer": answer,
                "evidence": _normalize_evidence(item.get("evidence")),
                "uncertainties": _string_list(item.get("uncertainties"), limit=8),
            }
        )

    if not qa_sections:
        raise ReportGenerationError("Report LLM response contains no usable qa_sections.")

    return {
        "title": title[:180],
        "subtitle": _stringify(payload.get("subtitle"))[:220],
        "executive_summary": executive_summary,
        "scope": _stringify(payload.get("scope")),
        "key_findings": _string_list(payload.get("key_findings"), limit=12),
        "qa_sections": qa_sections,
        "needed_information": _string_list(payload.get("needed_information"), limit=12),
        "appendix_notes": _string_list(payload.get("appendix_notes"), limit=12),
    }


def _message_to_digest_part(message: Message) -> Dict[str, Any]:
    return {
        "role": message.role,
        "content": message.content,
        "tool_calls": message.tool_calls,
        "tool_call_id": message.tool_call_id,
        "name": message.name,
        "timestamp": message.timestamp.isoformat() if message.timestamp else None,
    }


def compute_conversation_digest(messages: List[Message]) -> str:
    relevant = [
        _message_to_digest_part(message)
        for message in messages
        if message.role in {"user", "assistant", "tool"}
    ]
    encoded = json.dumps(relevant, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def load_standard_qa_session(workspace_path: str, session_id: str) -> Session:
    safe_session_id = validate_session_id(session_id)
    workspace = Path(workspace_path).resolve()
    if not workspace.exists() or not workspace.is_dir():
        raise ReportGenerationError(f"Workspace path is not available: {workspace_path}")

    session = Session.from_disk(safe_session_id, str(workspace))
    if session.scenario_id != STANDARD_QA_SCENARIO_ID:
        raise ReportGenerationError("Reports are only available for Standard QA sessions.")
    if not has_reportable_conversation(session.messages):
        raise ReportGenerationError("The session does not contain a completed Standard QA conversation yet.")
    return session


def has_reportable_conversation(messages: List[Message]) -> bool:
    has_user = any(message.role == "user" and _stringify(message.content) for message in messages)
    has_assistant = any(
        message.role == "assistant" and _stringify(message.content)
        for message in messages
    )
    return has_user and has_assistant


def _conversation_payload(session: Session) -> Dict[str, Any]:
    conversation: List[Dict[str, Any]] = []
    for message in session.messages:
        if message.role not in {"user", "assistant", "tool"}:
            continue
        content = _stringify(message.content)
        if not content and not message.tool_calls:
            continue

        entry: Dict[str, Any] = {
            "role": message.role,
            "content": content,
            "timestamp": message.timestamp.isoformat() if message.timestamp else None,
        }
        if message.name:
            entry["name"] = message.name
        if message.tool_call_id:
            entry["tool_call_id"] = message.tool_call_id
        if message.tool_calls:
            entry["tool_calls"] = message.tool_calls
        conversation.append(entry)

    return {
        "session_id": session.session_id,
        "workspace_path": session.workspace_path,
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "conversation": conversation,
    }


def _read_cache(workspace_path: str, session_id: str, kind: str, digest: str) -> Optional[Dict[str, Any]]:
    path = _cache_path(workspace_path, session_id, kind)
    if not path.exists():
        return None

    try:
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except Exception as exc:
        logger.warning("Failed to read report cache %s: %s", path, exc)
        return None

    if (
        isinstance(payload, dict)
        and payload.get("cache_version") == REPORT_CACHE_VERSION
        and payload.get("digest") == digest
        and isinstance(payload.get("data"), dict)
    ):
        return payload
    return None


def _write_cache(workspace_path: str, session_id: str, kind: str, digest: str, data: Dict[str, Any]) -> Dict[str, Any]:
    path = _cache_path(workspace_path, session_id, kind)
    payload = {
        "cache_version": REPORT_CACHE_VERSION,
        "kind": kind,
        "session_id": session_id,
        "digest": digest,
        "generated_at": _utc_now_iso(),
        "data": data,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    return payload


async def generate_standard_qa_summary(
    session: Session,
    llm: BaseLLM,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    digest = compute_conversation_digest(session.messages)
    if not force:
        cached = _read_cache(session.workspace_path, session.session_id, SUMMARY_KIND, digest)
        if cached is not None:
            return {**cached, "cached": True}

    response = await llm.complete(
        [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "instructions": SUMMARY_USER_PROMPT,
                        "session": _conversation_payload(session),
                    },
                    ensure_ascii=False,
                ),
            },
        ]
    )
    payload = _parse_json_object(_extract_completion_content(response), label="Summary")
    summary = _normalize_summary(payload)
    cached = _write_cache(session.workspace_path, session.session_id, SUMMARY_KIND, digest, summary)
    return {**cached, "cached": False}


async def generate_standard_qa_report(
    session: Session,
    llm: BaseLLM,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    digest = compute_conversation_digest(session.messages)
    if not force:
        cached = _read_cache(session.workspace_path, session.session_id, REPORT_KIND, digest)
        if cached is not None:
            return {**cached, "cached": True}

    response = await llm.complete(
        [
            {"role": "system", "content": REPORT_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "instructions": REPORT_USER_PROMPT,
                        "session": _conversation_payload(session),
                    },
                    ensure_ascii=False,
                ),
            },
        ]
    )
    payload = _parse_json_object(_extract_completion_content(response), label="Report")
    report = _normalize_report(payload)
    cached = _write_cache(session.workspace_path, session.session_id, REPORT_KIND, digest, report)
    return {**cached, "cached": False}


async def generate_standard_qa_report_streaming(
    session: Session,
    llm: BaseLLM,
    *,
    force: bool = False,
    progress_callback: Optional[ReportProgressCallback] = None,
) -> Dict[str, Any]:
    digest = compute_conversation_digest(session.messages)
    if not force:
        cached = _read_cache(session.workspace_path, session.session_id, REPORT_KIND, digest)
        if cached is not None:
            if progress_callback is not None:
                await progress_callback(
                    {
                        "phase": "cached",
                        "detail": "Using cached report content.",
                        "generated_characters": len(json.dumps(cached.get("data") or {}, ensure_ascii=False)),
                        "generated_tokens": 0,
                    }
                )
            return {**cached, "cached": True}

    messages = [
        {"role": "system", "content": REPORT_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "instructions": REPORT_USER_PROMPT,
                    "session": _conversation_payload(session),
                },
                ensure_ascii=False,
            ),
        },
    ]
    chunks: List[str] = []
    emitted_token_bucket = -1
    if progress_callback is not None:
        await progress_callback(
            {
                "phase": "llm_stream",
                "detail": "Primary model started generating report JSON.",
                "generated_characters": 0,
                "generated_tokens": 0,
            }
        )

    async for chunk in llm.stream(messages):
        for choice in _get_chunk_choices(chunk):
            delta = _get_choice_field(choice, "delta")
            if not delta:
                continue
            content = _get_delta_field(delta, "content")
            if not isinstance(content, str) or not content:
                continue
            chunks.append(content)
        raw_content = "".join(chunks)
        generated_tokens = _estimate_generated_tokens(raw_content)
        token_bucket = generated_tokens // 40
        if progress_callback is not None and token_bucket != emitted_token_bucket:
            emitted_token_bucket = token_bucket
            await progress_callback(
                {
                    "phase": "llm_stream",
                    "detail": "Primary model is generating report JSON.",
                    "generated_characters": len(raw_content),
                    "generated_tokens": generated_tokens,
                }
            )

    raw_content = "".join(chunks).strip()
    if not raw_content:
        raise ReportGenerationError("Report LLM stream returned no content.")
    if progress_callback is not None:
        await progress_callback(
            {
                "phase": "parsing",
                "detail": "Parsing structured report JSON.",
                "generated_characters": len(raw_content),
                "generated_tokens": _estimate_generated_tokens(raw_content),
            }
        )

    payload = _parse_json_object(raw_content, label="Report")
    report = _normalize_report(payload)
    cached = _write_cache(session.workspace_path, session.session_id, REPORT_KIND, digest, report)
    return {**cached, "cached": False}


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", value.strip(), flags=re.UNICODE)
    cleaned = cleaned.strip(".-")
    return cleaned[:80] or "standard-qa-report"


def _default_logo_path() -> Optional[Path]:
    repo_root = Path(__file__).resolve().parents[2]
    candidates = [
        repo_root / "src-tauri" / "icons" / "icon.png",
        repo_root / "src-tauri" / "icons" / "128x128.png",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _html_text(value: Any) -> str:
    return html.escape(_stringify(value), quote=True)


def _split_paragraph(text: str, *, chunk_size: int = 850) -> List[str]:
    normalized = _stringify(text)
    if not normalized:
        return []
    chunks: List[str] = []
    current = ""
    for part in re.split(r"(\s+)", normalized):
        if len(current) + len(part) > chunk_size and current:
            chunks.append(current.strip())
            current = part
        else:
            current += part
    if current.strip():
        chunks.append(current.strip())
    return chunks


def _paragraph_blocks(text: str, *, css_class: str = "body-text") -> List[str]:
    return [
        f'<p class="{css_class}">{_html_text(chunk)}</p>'
        for chunk in _split_paragraph(text)
    ]


def _list_blocks(items: List[str]) -> List[str]:
    if not items:
        return []
    return [
        '<ul class="bullet-list">'
        + "".join(f"<li>{_html_text(item)}</li>" for item in items)
        + "</ul>"
    ]


def _meta_value(label: str, value: str) -> str:
    return (
        '<div class="meta-row">'
        f'<span class="meta-label">{_html_text(label)}</span>'
        f'<span class="meta-value">{_html_text(value)}</span>'
        "</div>"
    )


def _build_report_blocks(
    report: Dict[str, Any],
    *,
    session: Session,
    summary: Optional[Dict[str, Any]],
    generated_at: str,
) -> List[str]:
    blocks: List[str] = []
    title = _stringify(report.get("title")) or "Standard QA Report"
    subtitle = _stringify(report.get("subtitle")) or "Evidence-driven technical report"

    blocks.append(
        '<section class="cover">'
        '<div class="eyebrow">work agent · Standard QA Report</div>'
        f'<h1>{_html_text(title)}</h1>'
        f'<p class="subtitle">{_html_text(subtitle)}</p>'
        '<div class="cover-grid">'
        + _meta_value("Generated", generated_at)
        + _meta_value("Workspace", session.workspace_path)
        + _meta_value("Session", session.session_id)
        + (_meta_value("Conversation", session.title) if session.title else "")
        + "</div>"
        "</section>"
    )

    blocks.append('<h2>Abstract</h2>')
    blocks.extend(_paragraph_blocks(_stringify(report.get("executive_summary"))))
    if summary and _stringify(summary.get("overview")):
        blocks.append('<div class="note-box"><div class="box-title">Panel Summary</div>')
        blocks.extend(_paragraph_blocks(_stringify(summary.get("overview")), css_class="compact-text"))
        blocks.append("</div>")

    scope = _stringify(report.get("scope"))
    if scope:
        blocks.append('<h2>1. Scope and Basis of Review</h2>')
        blocks.extend(_paragraph_blocks(scope))

    key_findings = _string_list(report.get("key_findings"), limit=24)
    if key_findings:
        blocks.append('<h2>2. Principal Findings</h2>')
        blocks.extend(_list_blocks(key_findings))

    qa_sections = report.get("qa_sections") if isinstance(report.get("qa_sections"), list) else []
    if qa_sections:
        blocks.append('<h2>3. Question-by-Question Analysis</h2>')
    for index, section in enumerate(qa_sections, start=1):
        if not isinstance(section, dict):
            continue
        question = _stringify(section.get("question")) or f"Question {index}"
        blocks.append(f'<h3>3.{index} {_html_text(question)}</h3>')
        answer = _stringify(section.get("answer"))
        if answer:
            blocks.extend(_paragraph_blocks(answer))

        evidence = section.get("evidence") if isinstance(section.get("evidence"), list) else []
        if evidence:
            blocks.append('<div class="evidence-heading">Evidence Traceability</div>')
            for evidence_index, item in enumerate(evidence, start=1):
                if not isinstance(item, dict):
                    continue
                standard_clause = _stringify(item.get("standard_clause"))
                file_name = _stringify(item.get("file"))
                page = _stringify(item.get("page"))
                line = _stringify(item.get("line"))
                quote = _stringify(item.get("quote"))
                explanation = _stringify(item.get("explanation"))
                locator = " · ".join(
                    part
                    for part in [
                        f"Clause {standard_clause}" if standard_clause else "",
                        file_name,
                        f"p. {page}" if page else "",
                        f"line {line}" if line else "",
                    ]
                    if part
                ) or "Source information insufficient"
                blocks.append(
                    '<div class="evidence-card">'
                    f'<div class="evidence-title">{evidence_index}. {_html_text(locator)}</div>'
                    + (f'<blockquote>{_html_text(quote)}</blockquote>' if quote else "")
                    + (f'<p class="compact-text">{_html_text(explanation)}</p>' if explanation else "")
                    + "</div>"
                )

        uncertainties = _string_list(section.get("uncertainties"), limit=12)
        if uncertainties:
            blocks.append('<div class="subheading">Uncertainties</div>')
            blocks.extend(_list_blocks(uncertainties))

    needed_information = _string_list(report.get("needed_information"), limit=24)
    if needed_information:
        blocks.append('<h2>4. Information Required for Closure</h2>')
        blocks.extend(_list_blocks(needed_information))

    appendix_notes = _string_list(report.get("appendix_notes"), limit=24)
    if appendix_notes:
        blocks.append('<h2>Appendix A. Notes and Source Context</h2>')
        blocks.extend(_list_blocks(appendix_notes))

    return blocks


def _contains_cjk(text: str) -> bool:
    return any("\u3400" <= char <= "\u9fff" for char in text)


def suggested_report_filename(report: Dict[str, Any], session: Session) -> str:
    base = _stringify(report.get("title")) or session.title or "standard-qa-report"
    return f"{_safe_filename(base)}.pdf"


def render_report_pdf(
    report: Dict[str, Any],
    *,
    session: Session,
    summary: Optional[Dict[str, Any]] = None,
) -> bytes:
    try:
        import pymupdf  # type: ignore
    except Exception as exc:
        raise ReportGenerationError("PyMuPDF is not available for PDF rendering.") from exc

    doc = pymupdf.open()
    page_width = 595
    page_height = 842
    margin_x = 56
    margin_top = 62
    margin_bottom = 54
    generated_at = _utc_now_iso()
    template = {
        "header": "work agent | Standard QA Report",
        "footer": f"Session {session.session_id}",
        "version": f"Template v{REPORT_CACHE_VERSION}",
        "watermark": "work agent",
    }
    logo_path = _default_logo_path()
    page_number = 0
    page = None
    cursor_y = margin_top

    def add_page() -> Any:
        nonlocal page, cursor_y, page_number
        page = doc.new_page(width=page_width, height=page_height)
        page_number += 1
        cursor_y = margin_top
        page.insert_text((margin_x, 30), template["header"], fontsize=8.2, fontname="helv", color=(0.25, 0.31, 0.38))
        if logo_path is not None:
            try:
                page.insert_image(pymupdf.Rect(page_width - margin_x - 24, 18, page_width - margin_x, 42), filename=str(logo_path))
            except Exception as exc:
                logger.debug("Failed to insert report logo %s: %s", logo_path, exc)
        page.insert_text((margin_x, page_height - 28), f"{template['footer']} | Page {page_number}", fontsize=7.6, fontname="helv", color=(0.42, 0.45, 0.50))
        page.insert_text((page_width - 124, page_height - 28), template["version"], fontsize=7.6, fontname="helv", color=(0.42, 0.45, 0.50))
        page.insert_text((page_width - 170, page_height / 2), template["watermark"], fontsize=25, fontname="helv", color=(0.93, 0.95, 0.97))
        return page

    def font_for(text: str, *, heading: bool = False) -> str:
        if _contains_cjk(text):
            return "china-ss" if heading else "china-s"
        return "helv" if heading else "tiro"

    def write_textbox(
        text: str,
        *,
        size: float = 10.4,
        color: tuple[float, float, float] = (0.10, 0.13, 0.20),
        top_gap: float = 0,
        bottom_gap: float = 6,
        indent: float = 0,
        align: int = 0,
        heading: bool = False,
        lineheight: float = 1.25,
    ) -> None:
        nonlocal cursor_y
        normalized = _stringify(text)
        if not normalized:
            return
        if page is None:
            add_page()
        assert page is not None
        cursor_y += top_gap
        max_y = page_height - margin_bottom
        rect = pymupdf.Rect(margin_x + indent, cursor_y, page_width - margin_x, max_y)
        font_name = font_for(normalized, heading=heading)
        spare = page.insert_textbox(
            rect,
            normalized,
            fontsize=size,
            fontname=font_name,
            color=color,
            align=align,
            lineheight=lineheight,
        )
        if spare < 0:
            add_page()
            assert page is not None
            rect = pymupdf.Rect(margin_x + indent, cursor_y, page_width - margin_x, max_y)
            spare = page.insert_textbox(
                rect,
                normalized,
                fontsize=size,
                fontname=font_name,
                color=color,
                align=align,
                lineheight=lineheight,
            )
            if spare < 0:
                for chunk in _split_paragraph(normalized, chunk_size=520):
                    write_textbox(
                        chunk,
                        size=size,
                        color=color,
                        bottom_gap=bottom_gap,
                        indent=indent,
                        align=align,
                        heading=heading,
                        lineheight=lineheight,
                    )
                return
        cursor_y = max(cursor_y + bottom_gap, rect.y1 - spare + bottom_gap)

    def write_rule(*, gap: float = 8) -> None:
        nonlocal cursor_y
        if page is None:
            add_page()
        assert page is not None
        cursor_y += gap
        page.draw_line(
            (margin_x, cursor_y),
            (page_width - margin_x, cursor_y),
            color=(0.68, 0.75, 0.82),
            width=0.7,
        )
        cursor_y += gap

    def write_section(title: str, number: Optional[str] = None) -> None:
        display = f"{number}. {title}" if number else title
        write_textbox(display, size=14, color=(0.04, 0.19, 0.28), top_gap=8, bottom_gap=5, heading=True, lineheight=1.18)
        write_rule(gap=2)

    def write_subsection(title: str) -> None:
        write_textbox(title, size=11.8, color=(0.10, 0.28, 0.36), top_gap=6, bottom_gap=4, heading=True, lineheight=1.18)

    def write_paragraphs(text: str) -> None:
        for paragraph in re.split(r"\n{2,}", _stringify(text)):
            for chunk in _split_paragraph(paragraph, chunk_size=900):
                write_textbox(chunk, size=10.2, bottom_gap=5, align=0, lineheight=1.32)

    def write_bullets(items: List[str]) -> None:
        for item in items:
            write_textbox(f"- {item}", size=10.0, bottom_gap=4, indent=10, lineheight=1.28)

    add_page()
    title = _stringify(report.get("title")) or "Standard QA Report"
    subtitle = _stringify(report.get("subtitle")) or "Evidence-driven technical report"
    if "session id" in subtitle.lower() or "workspace:" in subtitle.lower():
        subtitle = "Evidence-driven technical report"
    cursor_y += 70
    write_textbox("work agent · STANDARD QA REPORT", size=8.5, color=(0.38, 0.46, 0.54), bottom_gap=10, heading=True)
    write_textbox(title, size=23, color=(0.03, 0.18, 0.26), bottom_gap=10, heading=True, lineheight=1.12)
    write_textbox(subtitle, size=12.2, color=(0.26, 0.32, 0.40), bottom_gap=20, lineheight=1.22)
    write_rule(gap=8)
    write_textbox(f"Generated: {generated_at}", size=9.3, color=(0.34, 0.39, 0.46), bottom_gap=4)
    write_textbox(f"Workspace: {session.workspace_path}", size=9.3, color=(0.34, 0.39, 0.46), bottom_gap=4)
    write_textbox(f"Session: {session.session_id}", size=9.3, color=(0.34, 0.39, 0.46), bottom_gap=4)
    if session.title:
        write_textbox(f"Conversation: {session.title}", size=9.3, color=(0.34, 0.39, 0.46), bottom_gap=4)

    write_section("Abstract")
    write_paragraphs(_stringify(report.get("executive_summary")))
    if summary and _stringify(summary.get("overview")):
        write_subsection("Panel Summary")
        write_paragraphs(_stringify(summary.get("overview")))

    scope = _stringify(report.get("scope"))
    if scope:
        write_section("Scope and Basis of Review", "1")
        write_paragraphs(scope)

    key_findings = _string_list(report.get("key_findings"), limit=24)
    if key_findings:
        write_section("Principal Findings", "2")
        write_bullets(key_findings)

    qa_sections = report.get("qa_sections") if isinstance(report.get("qa_sections"), list) else []
    if qa_sections:
        write_section("Question-by-Question Analysis", "3")
    for index, section in enumerate(qa_sections, start=1):
        if not isinstance(section, dict):
            continue
        question = _stringify(section.get("question")) or f"Question {index}"
        write_subsection(f"3.{index} {question}")
        write_paragraphs(_stringify(section.get("answer")))
        evidence = section.get("evidence") if isinstance(section.get("evidence"), list) else []
        if evidence:
            write_textbox("Evidence Traceability", size=9.2, color=(0.13, 0.30, 0.40), top_gap=4, bottom_gap=3, heading=True)
            for evidence_index, item in enumerate(evidence, start=1):
                if not isinstance(item, dict):
                    continue
                standard_clause = _stringify(item.get("standard_clause"))
                file_name = _stringify(item.get("file"))
                page_ref = _stringify(item.get("page"))
                line_ref = _stringify(item.get("line"))
                locator = " · ".join(
                    part
                    for part in [
                        f"Clause {standard_clause}" if standard_clause else "",
                        file_name,
                        f"p. {page_ref}" if page_ref else "",
                        f"line {line_ref}" if line_ref else "",
                    ]
                    if part
                ) or "Source information insufficient"
                write_textbox(f"{evidence_index}. {locator}", size=9.2, color=(0.04, 0.23, 0.33), bottom_gap=2, heading=True)
                quote = _stringify(item.get("quote"))
                if quote:
                    write_textbox(f"Quote: {quote}", size=8.9, color=(0.26, 0.30, 0.36), bottom_gap=3, indent=12, lineheight=1.22)
                explanation = _stringify(item.get("explanation"))
                if explanation:
                    write_textbox(f"Explanation: {explanation}", size=8.9, color=(0.26, 0.30, 0.36), bottom_gap=5, indent=12, lineheight=1.22)
        uncertainties = _string_list(section.get("uncertainties"), limit=12)
        if uncertainties:
            write_textbox("Uncertainties", size=9.2, color=(0.13, 0.30, 0.40), top_gap=4, bottom_gap=3, heading=True)
            write_bullets(uncertainties)

    needed_information = _string_list(report.get("needed_information"), limit=24)
    if needed_information:
        write_section("Information Required for Closure", "4")
        write_bullets(needed_information)

    appendix_notes = _string_list(report.get("appendix_notes"), limit=24)
    if appendix_notes:
        write_section("Appendix A. Notes and Source Context")
        write_bullets(appendix_notes)

    return bytes(doc.tobytes(deflate=True))


def encode_pdf_base64(pdf_bytes: bytes) -> str:
    return base64.b64encode(pdf_bytes).decode("ascii")
