import asyncio
import inspect
import json
import logging
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from core.user import Message, Session, UserManager
from llms.base import BaseLLM
from tools.base import BaseTool

logger = logging.getLogger(__name__)
TOOL_CALL_PROGRESS_CHAR_INTERVAL = 2048
RunEventEmitter = Callable[
    [Session, str, str, Optional[Dict[str, Any]], Optional[int]], Awaitable[None]
]


class RunInterrupted(Exception):
    pass


class RunInterruptedWithPartial(RunInterrupted):
    def __init__(self, partial_message: Optional[Message] = None):
        super().__init__()
        self.partial_message = partial_message


class LLMStreamInactivityTimeout(Exception):
    pass


class LLMStreamFailedWithPartial(Exception):
    def __init__(
        self,
        partial_message: Optional[Message] = None,
        *,
        details: Optional[str] = None,
    ):
        super().__init__(details or "LLM response stopped before completion.")
        self.partial_message = partial_message
        self.details = details or "LLM response stopped before completion."


class LLMStreamRunner:
    def __init__(
        self,
        llm: BaseLLM,
        user_manager: UserManager,
        interrupt_event: asyncio.Event,
        emit_run_event: RunEventEmitter,
    ) -> None:
        self.llm = llm
        self.user_manager = user_manager
        self.interrupt_event = interrupt_event
        self.emit_run_event = emit_run_event

    async def stream_with_retry(
        self,
        messages: List[Dict[str, Any]],
        tools: List[BaseTool],
        session: Session,
        run_id: str,
        *,
        max_retries: int,
    ) -> Optional[Message]:
        last_error: Optional[Exception] = None

        for attempt in range(max_retries):
            if self.interrupt_event.is_set():
                raise RunInterrupted()

            try:
                return await self.stream_response(messages, tools, session, run_id)
            except RunInterrupted:
                raise
            except LLMStreamFailedWithPartial as exc:
                if exc.partial_message is not None:
                    raise
                last_error = exc
                logger.warning(
                    "LLM call failed (attempt %s/%s): %s",
                    attempt + 1,
                    max_retries,
                    exc,
                )
                if attempt < max_retries - 1:
                    await self._emit_retry(session, run_id, attempt + 1, max_retries, exc.details)
                    await asyncio.sleep(2**attempt)
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "LLM call failed (attempt %s/%s): %s",
                    attempt + 1,
                    max_retries,
                    exc,
                )
                if attempt < max_retries - 1:
                    await self._emit_retry(
                        session,
                        run_id,
                        attempt + 1,
                        max_retries,
                        str(exc),
                    )
                    await asyncio.sleep(2**attempt)

        if last_error:
            raise last_error
        return None

    async def _emit_retry(
        self,
        session: Session,
        run_id: str,
        attempt: int,
        max_retries: int,
        details: str,
    ) -> None:
        safe_error = "LLM request failed"
        await self.emit_run_event(
            session,
            run_id,
            "retry_scheduled",
            {
                "attempt": attempt,
                "max_retries": max_retries,
                "error": safe_error,
                "details": details,
            },
            None,
        )
        await self.user_manager.send_to_frontend(
            {
                "type": "retry",
                "session_id": session.session_id,
                "attempt": attempt,
                "max_retries": max_retries,
                "error": safe_error,
            }
        )

    def _get_stream_inactivity_timeout_seconds(self) -> float:
        get_timeout_seconds = getattr(self.llm, "_get_timeout_seconds", None)
        if callable(get_timeout_seconds):
            return max(1.0, float(get_timeout_seconds(60.0)))
        return 60.0

    @staticmethod
    async def _close_async_iterator(iterator: Any) -> None:
        close_candidates = [
            getattr(iterator, "aclose", None),
            getattr(iterator, "close", None),
        ]
        attempted: set[int] = set()

        for close_fn in close_candidates:
            if not callable(close_fn):
                continue
            fn_id = id(close_fn)
            if fn_id in attempted:
                continue
            attempted.add(fn_id)
            try:
                result = close_fn()
                if inspect.isawaitable(result):
                    await result
            except Exception as exc:
                logger.debug("Failed to close LLM stream iterator cleanly: %s", exc)

    @staticmethod
    def _get_chunk_choices(chunk: Any) -> List[Any]:
        if isinstance(chunk, dict):
            return chunk.get("choices", [])
        return getattr(chunk, "choices", []) or []

    @staticmethod
    def _get_choice_field(choice: Any, field: str) -> Any:
        if isinstance(choice, dict):
            return choice.get(field)
        return getattr(choice, field, None)

    @staticmethod
    def _get_delta_field(delta: Any, field: str) -> Any:
        if isinstance(delta, dict):
            return delta.get(field)
        return getattr(delta, field, None)

    @staticmethod
    def _get_tool_call_delta_field(tool_call_delta: Any, field: str) -> Any:
        if isinstance(tool_call_delta, dict):
            return tool_call_delta.get(field)
        return getattr(tool_call_delta, field, None)

    @staticmethod
    def serialize_tool_message_content(content: Any) -> str:
        if isinstance(content, dict) and content.get("event") == "standard_catalog_search_results":
            query = str(content.get("query") or "").strip()
            summary = content.get("summary") if isinstance(content.get("summary"), dict) else {}
            results = content.get("results") if isinstance(content.get("results"), list) else []
            recommended_actions = (
                content.get("recommended_next_actions")
                if isinstance(content.get("recommended_next_actions"), list)
                else []
            )

            lines = [
                f"Standard catalog search results for: {query or '(empty query)'}",
                (
                    "Summary: "
                    f"{int(summary.get('hit_count') or 0)} candidate standard(s) "
                    f"from {int(summary.get('indexed_document_count') or 0)} indexed document(s) "
                    f"across {int(summary.get('indexed_root_count') or 0)} catalog root(s)."
                ),
            ]

            if recommended_actions:
                lines.append("Recommended next actions:")
                for index, action in enumerate(recommended_actions[:3], start=1):
                    tool = str(action.get("tool") or "").strip() or "inspect_document"
                    path = str(action.get("path") or "").strip()
                    reason = str(action.get("reason") or "").strip()
                    standard_code = str(action.get("standard_code") or "").strip()
                    page_start = action.get("page_start")
                    page_end = action.get("page_end")
                    page_hint = ""
                    if isinstance(page_start, int) and isinstance(page_end, int):
                        page_hint = f" pages {page_start}-{page_end}"
                    lines.append(
                        f"{index}. Use `{tool}` on `{path}`{page_hint} for "
                        f"{standard_code or 'the top candidate'} because {reason or 'it is the best match'}"
                    )

            if results:
                lines.append("Top candidate standards:")
                for index, item in enumerate(results[:5], start=1):
                    standard_code = str(item.get("standard_code") or "").strip() or "(unknown code)"
                    title = str(item.get("title") or "").strip() or "(untitled)"
                    path = str(item.get("path") or "").strip()
                    score = item.get("score")
                    scope_summary = str(item.get("scope_summary") or "").strip()
                    follow_up = (
                        item.get("recommended_follow_up")
                        if isinstance(item.get("recommended_follow_up"), dict)
                        else {}
                    )
                    follow_up_tool = str(follow_up.get("tool") or "").strip()
                    follow_up_reason = str(follow_up.get("reason") or "").strip()
                    lines.append(
                        f"{index}. {standard_code}: {title} (score={score}, path={path})"
                    )
                    if scope_summary:
                        lines.append(f"   Scope summary: {scope_summary}")
                    if follow_up_tool:
                        lines.append(
                            f"   Next: `{follow_up_tool}` because {follow_up_reason or 'it is the recommended follow-up'}"
                        )

            return "\n".join(lines)

        if isinstance(content, str):
            return content
        if isinstance(content, (dict, list, int, float, bool)) or content is None:
            try:
                return json.dumps(content, ensure_ascii=False)
            except TypeError:
                return str(content)
        return str(content)

    async def stream_response(
        self,
        messages: List[Dict[str, Any]],
        tools: List[BaseTool],
        session: Session,
        run_id: str,
    ) -> Message:
        content_chunks: List[str] = []
        reasoning_chunks: List[str] = []
        tool_calls_data: Dict[int, Dict[str, Any]] = {}
        tool_progress_sent_chars: Dict[int, int] = {}
        last_tool_progress_emit_at: Dict[int, float] = {}
        stream_timeout_seconds = self._get_stream_inactivity_timeout_seconds()

        async def maybe_emit_tool_call_progress(idx: int) -> None:
            tc = tool_calls_data.get(idx)
            if not tc:
                return

            tool_name = tc["function"]["name"]
            if not tool_name:
                return

            argument_character_count = len(tc["function"]["arguments"])
            last_sent_chars = tool_progress_sent_chars.get(idx)
            now = time.monotonic()
            last_emit_at = last_tool_progress_emit_at.get(idx, 0.0)
            should_emit = (
                last_sent_chars is None
                or argument_character_count - last_sent_chars >= TOOL_CALL_PROGRESS_CHAR_INTERVAL
                or now - last_emit_at >= 0.5
            )
            if not should_emit:
                return

            tool_progress_sent_chars[idx] = argument_character_count
            last_tool_progress_emit_at[idx] = now
            await self.user_manager.send_to_frontend(
                {
                    "type": "tool_call_progress",
                    "session_id": session.session_id,
                    "tool_call_id": tc["id"] or None,
                    "name": tool_name,
                    "arguments_character_count": argument_character_count,
                }
            )

        def interrupted_with_partial() -> RunInterrupted:
            partial_message = self._build_interrupted_assistant_message(
                content_chunks,
                reasoning_chunks,
            )
            if partial_message is not None:
                return RunInterruptedWithPartial(partial_message)
            return RunInterrupted()

        def failed_with_partial(details: str) -> LLMStreamFailedWithPartial:
            partial_message = self._build_interrupted_assistant_message(
                content_chunks,
                reasoning_chunks,
            )
            return LLMStreamFailedWithPartial(partial_message, details=details)

        stream_iterator = self.llm.stream(messages, tools).__aiter__()

        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        stream_iterator.__anext__(),
                        timeout=stream_timeout_seconds,
                    )
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError as exc:
                    await self._close_async_iterator(stream_iterator)
                    raise LLMStreamInactivityTimeout(
                        f"LLM stream produced no chunks for {stream_timeout_seconds:.0f}s"
                    ) from exc

                if self.interrupt_event.is_set():
                    raise interrupted_with_partial()

                choices = self._get_chunk_choices(chunk)
                if not choices:
                    continue

                choice = choices[0]
                delta = self._get_choice_field(choice, "delta")
                if not delta:
                    continue

                reasoning_content = self._get_delta_field(delta, "reasoning_content")
                if reasoning_content:
                    reasoning_chunks.append(reasoning_content)
                    await self.user_manager.send_to_frontend(
                        {
                            "type": "reasoning_token",
                            "session_id": session.session_id,
                            "content": reasoning_content,
                        }
                    )

                content = self._get_delta_field(delta, "content")
                if content:
                    content_chunks.append(content)
                    await self.user_manager.send_to_frontend(
                        {
                            "type": "token",
                            "session_id": session.session_id,
                            "content": content,
                        }
                    )

                delta_tool_calls = self._get_delta_field(delta, "tool_calls")
                if delta_tool_calls:
                    for tool_call_delta in delta_tool_calls:
                        idx = self._get_tool_call_delta_field(tool_call_delta, "index")
                        if idx is None:
                            idx = 0

                        if idx not in tool_calls_data:
                            tool_calls_data[idx] = {
                                "id": "",
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            }

                        tool_call_id = self._get_tool_call_delta_field(tool_call_delta, "id")
                        if tool_call_id:
                            tool_calls_data[idx]["id"] = tool_call_id

                        function_delta = self._get_tool_call_delta_field(
                            tool_call_delta, "function"
                        )
                        if function_delta:
                            function_name = self._get_delta_field(function_delta, "name")
                            if function_name:
                                tool_calls_data[idx]["function"]["name"] = function_name
                                await maybe_emit_tool_call_progress(idx)

                            function_args = self._get_delta_field(
                                function_delta, "arguments"
                            )
                            if function_args:
                                tool_calls_data[idx]["function"]["arguments"] += function_args
                                await maybe_emit_tool_call_progress(idx)
        except asyncio.CancelledError as exc:
            raise interrupted_with_partial() from exc
        except RunInterrupted:
            raise
        except Exception as exc:
            details = str(exc).strip() or "LLM response stopped before completion."
            if isinstance(exc, LLMStreamInactivityTimeout):
                details = "LLM stream stalled before completion."
            raise failed_with_partial(details) from exc
        finally:
            await self._close_async_iterator(stream_iterator)

        if reasoning_chunks:
            await self.user_manager.send_to_frontend(
                {"type": "reasoning_complete", "session_id": session.session_id}
            )

        content = "".join(content_chunks) if content_chunks else None
        reasoning_content = "".join(reasoning_chunks) if reasoning_chunks else None

        tool_calls: Optional[List[Dict[str, Any]]] = None
        if tool_calls_data:
            tool_calls = []
            for idx in sorted(tool_calls_data.keys()):
                tc = tool_calls_data[idx]
                tool_calls.append(
                    {
                        "id": tc["id"],
                        "type": tc["type"],
                        "function": {
                            "name": tc["function"]["name"],
                            "arguments": tc["function"]["arguments"],
                        },
                    }
                )

                try:
                    args = (
                        json.loads(tc["function"]["arguments"])
                        if tc["function"]["arguments"]
                        else {}
                    )
                except json.JSONDecodeError:
                    args = {}

                await self.user_manager.send_to_frontend(
                    {
                        "type": "tool_call",
                        "session_id": session.session_id,
                        "tool_call_id": tc["id"],
                        "name": tc["function"]["name"],
                        "arguments": args,
                    }
                )
                await self.emit_run_event(
                    session,
                    run_id,
                    "tool_call_requested",
                    {
                        "tool_call_id": tc["id"],
                        "tool_name": tc["function"]["name"],
                        "arguments": args,
                    },
                    None,
                )

        return Message(
            role="assistant",
            content=content,
            tool_calls=tool_calls,
            reasoning_content=reasoning_content,
        )

    @staticmethod
    def _build_interrupted_assistant_message(
        content_chunks: List[str],
        reasoning_chunks: List[str],
    ) -> Optional[Message]:
        content = "".join(content_chunks)
        if not content.strip():
            return None

        reasoning_content = "".join(reasoning_chunks) if reasoning_chunks else None
        return Message(
            role="assistant",
            content=content,
            reasoning_content=reasoning_content,
        )
