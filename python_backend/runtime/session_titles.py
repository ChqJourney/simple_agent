import logging
from typing import Any, Awaitable, Callable, Dict, Optional

from core.user import Session
from llms.base import BaseLLM

logger = logging.getLogger(__name__)

SendCallback = Callable[[Dict[str, Any]], Awaitable[None]]

TITLE_PROMPT = (
    "Generate a concise session title for this user request. "
    "Return plain text only, no quotes, no markdown, maximum 6 words."
)


def _extract_title_content(response: Any) -> str:
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


def _normalize_title(raw_title: str) -> str:
    cleaned = " ".join(raw_title.strip().replace("\n", " ").split())
    cleaned = cleaned.strip("'\"")
    return cleaned[:80].strip()


async def maybe_generate_session_title(
    session: Session,
    llm: BaseLLM,
    first_message: str,
    send_callback: SendCallback,
) -> Optional[str]:
    if session.title or not first_message.strip():
        return None

    response = await llm.complete(
        [
            {"role": "system", "content": TITLE_PROMPT},
            {"role": "user", "content": first_message.strip()},
        ]
    )
    title = _normalize_title(_extract_title_content(response))
    if not title:
        return None

    session.set_title_in_memory(title)
    await send_callback(
        {
            "type": "session_title_updated",
            "session_id": session.session_id,
            "title": title,
        }
    )
    await session.save_metadata_async()
    return title


async def run_session_title_task(
    session: Session,
    llm: BaseLLM,
    first_message: str,
    send_callback: SendCallback,
) -> None:
    try:
        await maybe_generate_session_title(session, llm, first_message, send_callback)
    except Exception as exc:
        logger.warning("Failed to generate session title for %s: %s", session.session_id, exc)
