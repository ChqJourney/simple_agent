import asyncio
import json
import logging
import platform
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from core.agent_streaming import (
    LLMStreamFailedWithPartial,
    LLMStreamRunner,
    RunInterrupted,
)
from core.agent_tool_execution import ToolExecutionCoordinator
from core.user import Message, Session, UserManager
from llms.base import BaseLLM
from runtime.contracts import ReplayPlan, SessionCompactionRecord, SessionMemorySnapshot
from runtime.events import RunEvent
from runtime.logs import append_run_event
from runtime.reference_index import reference_root_catalog_path
from skills.base import SkillProvider, SkillSummary
from tools.base import BaseTool, ToolRegistry, ToolResult
from tools.shell_execute import ShellExecuteTool

logger = logging.getLogger(__name__)
BACKGROUND_COMPACTION_USAGE_THRESHOLD = 0.60
FORCED_COMPACTION_USAGE_THRESHOLD = 0.75
RECENT_RAW_MESSAGE_COUNT = 8
MIN_RECENT_RAW_MESSAGE_COUNT = 4


class Agent:
    def __init__(
        self,
        llm: BaseLLM,
        tool_registry: ToolRegistry,
        user_manager: UserManager,
        skill_provider: Optional[SkillProvider] = None,
        custom_system_prompt: str = "",
        scenario_system_prompt: str = "",
        compaction_llm_factory: Optional[Callable[[], BaseLLM]] = None,
        background_compaction_scheduler: Optional[Callable[[Session, str], Awaitable[None]]] = None,
        tool_filter: Optional[Callable[[BaseTool], bool]] = None,
        max_tool_rounds: int = 10,
        max_retries: int = 3,
        reference_library_roots: Optional[List[str]] = None,
    ):
        self.llm = llm
        self.tool_registry = tool_registry
        self.user_manager = user_manager
        self.skill_provider = skill_provider
        self.custom_system_prompt = custom_system_prompt.strip()
        self.scenario_system_prompt = scenario_system_prompt.strip()
        self.compaction_llm_factory = compaction_llm_factory
        self.background_compaction_scheduler = background_compaction_scheduler
        self.tool_filter = tool_filter
        self.max_tool_rounds = max_tool_rounds
        self.max_retries = max_retries
        self.reference_library_roots = reference_library_roots
        self._interrupt_event = asyncio.Event()
        self._stream_runner = LLMStreamRunner(
            llm=self.llm,
            user_manager=self.user_manager,
            interrupt_event=self._interrupt_event,
            emit_run_event=self._emit_run_event,
        )
        self._tool_execution = ToolExecutionCoordinator(
            tool_registry=self.tool_registry,
            user_manager=self.user_manager,
            interrupt_event=self._interrupt_event,
            emit_run_event=self._emit_run_event,
            reference_library_roots=self.reference_library_roots,
        )

    def interrupt(self) -> None:
        self._interrupt_event.set()

    def reset_interrupt(self) -> None:
        self._interrupt_event.clear()

    async def _emit_run_event(
        self,
        session: Session,
        run_id: str,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
        step_index: Optional[int] = None,
    ) -> None:
        event = RunEvent(
            event_type=event_type,
            session_id=session.session_id,
            run_id=run_id,
            step_index=step_index,
            payload=payload or {},
        )
        await append_run_event(session.workspace_path, session.session_id, event)
        await self.user_manager.send_to_frontend({
            "type": "run_event",
            "session_id": session.session_id,
            "event": event.model_dump(mode="json"),
        })

    async def run(
        self,
        user_message: str,
        session: Session,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        self.reset_interrupt()
        await session.add_message_async(Message(role="user", content=user_message, attachments=attachments))
        run_id = str(uuid.uuid4())

        await self.user_manager.send_to_frontend({
            "type": "started",
            "session_id": session.session_id
        })
        await self._emit_run_event(
            session,
            run_id,
            "run_started",
            {"user_message": user_message, "attachment_count": len(attachments or [])},
        )

        try:
            for _ in range(self.max_tool_rounds):
                if self._interrupt_event.is_set():
                    raise RunInterrupted()

                messages = await self._build_llm_messages(session, run_id)
                tools = list(self.tool_registry.tools.values())
                if not self.skill_provider:
                    tools = [tool for tool in tools if tool.name != "skill_loader"]
                if self.tool_filter:
                    tools = [tool for tool in tools if self.tool_filter(tool)]

                assistant_message = await self._stream_llm_with_retry(messages, tools, session, run_id)

                if not assistant_message:
                    continue

                if not assistant_message.tool_calls:
                    latest_usage = None
                    if callable(getattr(self.llm, "get_latest_usage", None)):
                        latest_usage = self.llm.get_latest_usage()
                    if latest_usage:
                        assistant_message.usage = latest_usage
                    await session.add_message_async(assistant_message)
                    completed_payload: Dict[str, Any] = {"finish_reason": "assistant_response"}
                    if latest_usage:
                        completed_payload["usage"] = latest_usage
                    await self._emit_run_event(
                        session,
                        run_id,
                        "run_completed",
                        completed_payload,
                    )
                    await self.user_manager.send_to_frontend({
                        "type": "completed",
                        "session_id": session.session_id,
                        "usage": latest_usage,
                    })
                    return

                await session.add_message_async(assistant_message)
                tool_results = await self._execute_tools(assistant_message.tool_calls, session, run_id)

                for result in tool_results:
                    if result.success:
                        content = result.output
                    else:
                        parts = [f"Error: {result.error}"]
                        if result.tool_name == "ask_question" and result.output is not None:
                            parts.append(
                                f"Question result: {self._serialize_tool_message_content(result.output)}"
                            )
                        elif result.output and isinstance(result.output, dict):
                            stderr = result.output.get("stderr", "")
                            if stderr:
                                parts.append(f"stderr: {stderr}")
                        content = "\n".join(parts)
                    await session.add_message_async(Message(
                        role="tool",
                        tool_call_id=result.tool_call_id,
                        name=result.tool_name,
                        content=self._serialize_tool_message_content(content),
                        success=result.success,
                    ))

            await self._emit_run_event(
                session,
                run_id,
                "run_max_rounds_reached",
                {"max_tool_rounds": self.max_tool_rounds},
            )
            await self.user_manager.send_to_frontend({
                "type": "max_rounds_reached",
                "session_id": session.session_id,
                "error": f"Tool call rounds exceeded limit ({self.max_tool_rounds})"
            })

        except RunInterrupted as interrupted:
            partial_message = getattr(interrupted, "partial_message", None)
            if partial_message is not None:
                await session.add_message_async(partial_message)
            await self._emit_run_event(session, run_id, "run_interrupted")
            await self.user_manager.send_to_frontend({
                "type": "interrupted",
                "session_id": session.session_id
            })
        except LLMStreamFailedWithPartial as partial_failure:
            if partial_failure.partial_message is not None:
                await session.add_message_async(partial_failure.partial_message)
            partial_preserved = partial_failure.partial_message is not None
            safe_error = (
                "LLM response stopped before completion. Partial response was preserved."
                if partial_preserved
                else "LLM response stopped before completion."
            )
            await self._emit_run_event(
                session,
                run_id,
                "run_failed",
                {"error": safe_error, "details": partial_failure.details},
            )
            await self.user_manager.send_to_frontend({
                "type": "error",
                "session_id": session.session_id,
                "error": safe_error,
                "details": partial_failure.details,
                "preserve_partial": partial_preserved,
            })
        except Exception as e:
            logger.exception(f"Agent run failed: {e}")
            safe_error = "Agent run failed. Check backend logs."
            await self._emit_run_event(
                session,
                run_id,
                "run_failed",
                {"error": safe_error},
            )
            await self.user_manager.send_to_frontend({
                "type": "error",
                "session_id": session.session_id,
                "error": safe_error
            })

    async def _stream_llm_with_retry(
        self,
        messages: List[Dict],
        tools: List[BaseTool],
        session: Session,
        run_id: str,
    ) -> Optional[Message]:
        return await self._stream_runner.stream_with_retry(
            messages,
            tools,
            session,
            run_id,
            max_retries=self.max_retries,
        )

    @staticmethod
    def _estimate_message_tokens(message: Dict[str, Any]) -> int:
        try:
            serialized = json.dumps(message, ensure_ascii=False)
        except TypeError:
            serialized = str(message)
        ascii_chars = sum(1 for char in serialized if ord(char) <= 127)
        non_ascii_chars = len(serialized) - ascii_chars
        return max(1, (ascii_chars // 4) + non_ascii_chars)

    def _trim_messages_to_context_window(
        self,
        history_messages: List[Dict[str, Any]],
        system_message: Optional[Dict[str, Any]] = None,
        fixed_messages: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        prefix_messages: List[Dict[str, Any]] = [message for message in (fixed_messages or []) if isinstance(message, dict)]
        if system_message is not None:
            prefix_messages = [system_message, *prefix_messages]

        get_context_length = getattr(self.llm, "_get_context_length", None)
        if not callable(get_context_length):
            return [*prefix_messages, *history_messages]

        context_length = get_context_length()
        if context_length is None or context_length <= 0:
            return [*prefix_messages, *history_messages]

        if not history_messages and not prefix_messages:
            return []

        get_max_output_tokens = getattr(self.llm, "_get_max_output_tokens", None)
        reserved_output_tokens = get_max_output_tokens() if callable(get_max_output_tokens) else None
        if reserved_output_tokens is None or reserved_output_tokens <= 0:
            reserved_output_tokens = min(2048, max(256, context_length // 8))

        fixed_tokens = sum(self._estimate_message_tokens(message) for message in prefix_messages)
        history_budget = max(context_length - reserved_output_tokens - fixed_tokens, 0)
        kept_reversed: List[Dict[str, Any]] = []
        used_tokens = 0

        for message in reversed(history_messages):
            message_tokens = self._estimate_message_tokens(message)
            if kept_reversed and used_tokens + message_tokens > history_budget:
                break
            kept_reversed.append(message)
            used_tokens += message_tokens

        if not kept_reversed:
            if history_messages:
                kept_reversed.append(history_messages[-1])
            else:
                return prefix_messages

        trimmed_history = list(reversed(kept_reversed))
        return [*prefix_messages, *trimmed_history]

    @staticmethod
    def _validate_tool_arguments(tool: BaseTool, arguments: Dict[str, Any]) -> Optional[str]:
        schema = getattr(tool, "parameters", None)
        if not isinstance(schema, dict):
            return None

        properties = schema.get("properties")
        if not isinstance(properties, dict):
            properties = {}
        required = schema.get("required")
        if not isinstance(required, list):
            required = []

        for key in required:
            if key not in arguments:
                return f"Missing required argument: {key}"

        additional_properties = schema.get("additionalProperties")
        if additional_properties is False:
            unexpected_keys = sorted(key for key in arguments.keys() if key not in properties)
            if unexpected_keys:
                return f"Unexpected argument(s): {', '.join(unexpected_keys)}"

        type_checkers = {
            "string": lambda value: isinstance(value, str),
            "integer": lambda value: isinstance(value, int) and not isinstance(value, bool),
            "number": lambda value: (isinstance(value, int) or isinstance(value, float)) and not isinstance(value, bool),
            "boolean": lambda value: isinstance(value, bool),
            "object": lambda value: isinstance(value, dict),
            "array": lambda value: isinstance(value, list),
        }

        for key, value in arguments.items():
            prop_schema = properties.get(key)
            if not isinstance(prop_schema, dict):
                continue

            expected_type = prop_schema.get("type")
            if isinstance(expected_type, str):
                checker = type_checkers.get(expected_type)
                if checker and not checker(value):
                    return f"Invalid type for '{key}': expected {expected_type}"

            enum_values = prop_schema.get("enum")
            if isinstance(enum_values, list) and value not in enum_values:
                return f"Invalid value for '{key}': {value}"

        return None

    async def _stream_llm_response(
        self,
        messages: List[Dict],
        tools: List[BaseTool],
        session: Session,
        run_id: str,
    ) -> Message:
        return await self._stream_runner.stream_response(
            messages,
            tools,
            session,
            run_id,
        )

    @staticmethod
    def _serialize_tool_message_content(content: Any) -> str:
        return LLMStreamRunner.serialize_tool_message_content(content)

    async def _execute_tools(
        self,
        tool_calls: List[Dict[str, Any]],
        session: Session,
        run_id: str,
    ) -> List[ToolResult]:
        return await self._tool_execution.execute_tools(tool_calls, session, run_id)

    async def _execute_tool_with_interrupt_timeout(
        self,
        tool: BaseTool,
        tool_call_id: str,
        workspace_path: str,
        timeout_seconds: int,
        arguments: Dict[str, Any],
    ) -> ToolResult:
        return await self._tool_execution.execute_tool_with_interrupt_timeout(
            tool=tool,
            tool_call_id=tool_call_id,
            workspace_path=workspace_path,
            timeout_seconds=timeout_seconds,
            arguments=arguments,
        )

    @staticmethod
    def _estimate_messages_tokens(messages: List[Dict[str, Any]]) -> int:
        return sum(Agent._estimate_message_tokens(message) for message in messages)

    def _get_context_length(self) -> int:
        get_context_length = getattr(self.llm, "_get_context_length", None)
        if callable(get_context_length):
            context_length = get_context_length()
            if isinstance(context_length, int) and context_length > 0:
                return context_length
        return 64000

    def _get_reserved_output_tokens(self, context_length: int) -> int:
        get_max_output_tokens = getattr(self.llm, "_get_max_output_tokens", None)
        reserved_output_tokens = get_max_output_tokens() if callable(get_max_output_tokens) else None
        if isinstance(reserved_output_tokens, int) and reserved_output_tokens > 0:
            return reserved_output_tokens
        return min(2048, max(256, context_length // 8))

    def _is_tool_available_to_model(self, tool_name: str) -> bool:
        tool = self.tool_registry.get_tool(tool_name)
        if tool is None:
            return False
        if self.tool_filter is None:
            return True
        return self.tool_filter(tool)

    async def _build_system_message(self, session: Session, run_id: str) -> Optional[Dict[str, Any]]:
        prompt_sections: List[str] = []

        if self.custom_system_prompt:
            prompt_sections.append(self._format_custom_system_prompt_section(self.custom_system_prompt))

        if self.scenario_system_prompt:
            prompt_sections.append(self._format_scenario_prompt_section(self.scenario_system_prompt))

        prompt_sections.append(self._format_runtime_environment_section(session))
        if self.reference_library_roots and self._is_tool_available_to_model("search_standard_catalog"):
            prompt_sections.append(
                self._format_reference_catalog_guidance_section(self.reference_library_roots)
            )
        if self._is_tool_available_to_model("delegate_task"):
            prompt_sections.append(self._format_delegation_guidance_section())

        if self.skill_provider and self._is_tool_available_to_model("skill_loader"):
            skills = self.skill_provider.list_skills(workspace_path=session.workspace_path)
            await self._emit_run_event(
                session,
                run_id,
                "skill_catalog_prepared",
                {
                    "skill_names": [skill.name for skill in skills],
                    "skill_count": len(skills),
                },
            )
            if skills:
                prompt_sections.append(self._format_skill_catalog_section(skills))

        return {"role": "system", "content": "\n\n".join(prompt_sections)} if prompt_sections else None

    @staticmethod
    def _format_memory_section(title: str, items: List[str]) -> List[str]:
        if not items:
            return []
        lines = [f"- {title}:"]
        lines.extend(f"  - {item}" for item in items if isinstance(item, str) and item.strip())
        return lines

    def _build_memory_message(self, memory: Optional[SessionMemorySnapshot]) -> Optional[Dict[str, Any]]:
        if memory is None:
            return None

        lines: List[str] = ["Session memory (compacted history):"]
        if memory.current_task:
            lines.append(f"- Current task: {memory.current_task}")
        lines.extend(self._format_memory_section("Completed milestones", memory.completed_milestones))
        lines.extend(self._format_memory_section("Decisions and constraints", memory.decisions_and_constraints))
        lines.extend(self._format_memory_section("Important user preferences", memory.important_user_preferences))
        lines.extend(self._format_memory_section("Important files and paths", memory.important_files_and_paths))
        lines.extend(self._format_memory_section("Key tool results", memory.key_tool_results))
        lines.extend(self._format_memory_section("Open loops", memory.open_loops))
        lines.extend(self._format_memory_section("Risks or unknowns", memory.risks_or_unknowns))
        if memory.raw_summary_text:
            lines.append(f"- Summary: {memory.raw_summary_text}")

        if len(lines) == 1:
            return None
        return {"role": "system", "content": "\n".join(lines)}

    def _build_replay_plan(
        self,
        session: Session,
        system_message: Optional[Dict[str, Any]],
    ) -> ReplayPlan:
        memory = session.load_memory()
        memory_message = self._build_memory_message(memory)
        history_start_index = 0 if memory is None else max(0, memory.covered_until_message_index + 1)
        history_messages = session.get_messages_for_llm(start_index=history_start_index)

        context_length = self._get_context_length()
        latest_usage = session.get_latest_usage()
        latest_prompt_tokens = 0
        usage_ratio = 0.0

        if isinstance(latest_usage, dict):
            try:
                latest_prompt_tokens = max(0, int(latest_usage.get("prompt_tokens") or 0))
            except (TypeError, ValueError):
                latest_prompt_tokens = 0

            latest_context_length = latest_usage.get("context_length")
            if isinstance(latest_context_length, int) and latest_context_length > 0:
                context_length = min(context_length, latest_context_length)

            if context_length > 0:
                usage_ratio = latest_prompt_tokens / context_length

        return ReplayPlan(
            system_message=system_message,
            memory_message=memory_message,
            history_messages=history_messages,
            latest_prompt_tokens=latest_prompt_tokens,
            context_length=context_length,
            usage_ratio=usage_ratio,
            forced_compaction_required=usage_ratio > FORCED_COMPACTION_USAGE_THRESHOLD,
            background_compaction_recommended=usage_ratio >= BACKGROUND_COMPACTION_USAGE_THRESHOLD,
        )

    def _select_compaction_source_range(
        self,
        session: Session,
        memory: Optional[SessionMemorySnapshot],
    ) -> Optional[Tuple[int, int]]:
        start_index = 0 if memory is None else max(0, memory.covered_until_message_index + 1)
        total_messages = len(session.messages)
        candidate_end_index = total_messages - RECENT_RAW_MESSAGE_COUNT
        if candidate_end_index <= start_index:
            candidate_end_index = total_messages - MIN_RECENT_RAW_MESSAGE_COUNT
            if candidate_end_index <= start_index:
                return None

        source_messages = session.get_messages_for_llm(start_index=start_index, end_index=candidate_end_index)
        if not source_messages:
            return None
        return start_index, candidate_end_index

    @staticmethod
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

    @staticmethod
    def _strip_json_fence(raw_text: str) -> str:
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines:
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        return cleaned

    async def _create_compaction_llm(self) -> Tuple[BaseLLM, bool]:
        if callable(self.compaction_llm_factory):
            return self.compaction_llm_factory(), True
        return self.llm, False

    async def _close_compaction_llm(self, llm: BaseLLM, should_close: bool) -> None:
        if not should_close:
            return
        aclose = getattr(llm, "aclose", None)
        if callable(aclose):
            await aclose()

    def _build_compaction_prompt(
        self,
        session: Session,
        memory: Optional[SessionMemorySnapshot],
        start_index: int,
        end_index: int,
    ) -> List[Dict[str, Any]]:
        source_messages = session.get_messages_for_llm(start_index=start_index, end_index=end_index)
        existing_memory = memory.model_dump(mode="json") if memory is not None else None
        source_payload = json.dumps(source_messages, ensure_ascii=False, indent=2)
        memory_payload = json.dumps(existing_memory, ensure_ascii=False, indent=2) if existing_memory else "null"

        return [
            {
                "role": "system",
                "content": (
                    "You are generating compact working memory for an agent session. "
                    "Return JSON only. Preserve only information that will matter for future task completion. "
                    "Do not include markdown fences. Do not invent facts. "
                    "Required keys: current_task, completed_milestones, decisions_and_constraints, "
                    "important_user_preferences, important_files_and_paths, key_tool_results, "
                    "open_loops, risks_or_unknowns, raw_summary_text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Existing memory JSON:\n{memory_payload}\n\n"
                    f"New source messages JSON:\n{source_payload}\n\n"
                    "Merge the existing memory with the new source messages into a single JSON object. "
                    "All list fields must contain concise strings. raw_summary_text must be brief."
                ),
            },
        ]

    def _coerce_memory_snapshot(
        self,
        session: Session,
        raw_content: str,
        covered_until_message_index: int,
        existing_memory: Optional[SessionMemorySnapshot],
    ) -> SessionMemorySnapshot:
        cleaned = self._strip_json_fence(raw_content)
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("Compaction response must be a JSON object")

        payload = {
            **parsed,
            "session_id": session.session_id,
            "covered_until_message_index": covered_until_message_index - 1,
            "version": existing_memory.version if existing_memory is not None else 1,
        }
        snapshot = SessionMemorySnapshot.model_validate(payload)
        snapshot.estimated_tokens = self._estimate_message_tokens(
            self._build_memory_message(snapshot) or {"role": "system", "content": snapshot.raw_summary_text}
        )
        return snapshot

    async def _run_compaction(
        self,
        session: Session,
        run_id: str,
        strategy: str,
    ) -> bool:
        memory = session.load_memory()
        source_range = self._select_compaction_source_range(session, memory)
        if source_range is None:
            await self._emit_run_event(
                session,
                run_id,
                "session_compaction_skipped",
                {"strategy": strategy, "reason": "insufficient_source_messages"},
            )
            return False

        start_index, end_index = source_range
        source_messages = session.get_messages_for_llm(start_index=start_index, end_index=end_index)
        compaction_llm, should_close = await self._create_compaction_llm()
        await self._emit_run_event(
            session,
            run_id,
            "session_compaction_started",
            {
                "strategy": strategy,
                "source_start_index": start_index,
                "source_end_index": end_index - 1,
                "pre_tokens_estimate": self._estimate_messages_tokens(source_messages),
            },
        )

        try:
            response = await compaction_llm.complete(
                self._build_compaction_prompt(session, memory, start_index, end_index)
            )
            raw_content = self._extract_completion_content(response)
            next_memory = self._coerce_memory_snapshot(session, raw_content, end_index, memory)
            await session.save_memory_async(next_memory)
            await session.append_compaction_record_async(
                SessionCompactionRecord(
                    compaction_id=str(uuid.uuid4()),
                    strategy=strategy,
                    source_start_index=start_index,
                    source_end_index=end_index - 1,
                    pre_tokens_estimate=self._estimate_messages_tokens(source_messages),
                    post_tokens_estimate=next_memory.estimated_tokens,
                    model={
                        "profile_name": str(getattr(compaction_llm, "config", {}).get("profile_name", "") or ""),
                        "provider": str(getattr(compaction_llm, "config", {}).get("provider", "") or ""),
                        "model": str(getattr(compaction_llm, "model", "") or ""),
                    },
                    notes=(
                        "Forced compaction before main request"
                        if strategy == "forced"
                        else "Background pre-compaction"
                    ),
                )
            )
            await self._emit_run_event(
                session,
                run_id,
                "session_compaction_completed",
                {
                    "strategy": strategy,
                    "source_start_index": start_index,
                    "source_end_index": end_index - 1,
                    "pre_tokens_estimate": self._estimate_messages_tokens(source_messages),
                    "post_tokens_estimate": next_memory.estimated_tokens,
                    "context_length": self._get_context_length(),
                    "memory_covered_until": next_memory.covered_until_message_index,
                },
            )
            return True
        except Exception as exc:
            logger.warning("Forced session compaction failed for %s: %s", session.session_id, exc)
            await self._emit_run_event(
                session,
                run_id,
                "session_compaction_failed",
                {
                    "strategy": strategy,
                    "source_start_index": start_index,
                    "source_end_index": end_index - 1,
                    "error": str(exc),
                },
            )
            return False
        finally:
            await self._close_compaction_llm(compaction_llm, should_close)

    async def _run_forced_compaction(
        self,
        session: Session,
        run_id: str,
        replay_plan: ReplayPlan,
    ) -> bool:
        return await self._run_compaction(session, run_id, "forced")

    async def run_background_compaction(
        self,
        session: Session,
        trigger_run_id: str,
    ) -> bool:
        return await self._run_compaction(session, trigger_run_id, "background")

    async def _build_llm_messages(self, session: Session, run_id: str) -> List[Dict[str, Any]]:
        system_message = await self._build_system_message(session, run_id)
        replay_plan = self._build_replay_plan(session, system_message)

        if replay_plan.forced_compaction_required:
            await self._run_forced_compaction(session, run_id, replay_plan)
            replay_plan = self._build_replay_plan(session, system_message)
        elif replay_plan.background_compaction_recommended:
            memory = session.load_memory()
            source_range = self._select_compaction_source_range(session, memory)
            if source_range is not None:
                scheduler = self.background_compaction_scheduler
                if callable(scheduler):
                    await scheduler(session, run_id)
            else:
                await self._emit_run_event(
                    session,
                    run_id,
                    "session_compaction_skipped",
                    {
                        "strategy": "background",
                        "reason": "no_compactable_prefix",
                    },
                )

        fixed_messages = [message for message in [replay_plan.memory_message] if message is not None]
        return self._trim_messages_to_context_window(
            replay_plan.history_messages,
            system_message=replay_plan.system_message,
            fixed_messages=fixed_messages,
        )

    @staticmethod
    def _format_custom_system_prompt_section(custom_system_prompt: str) -> str:
        return f"Additional user-configured system instructions:\n{custom_system_prompt}"

    @staticmethod
    def _format_scenario_prompt_section(scenario_system_prompt: str) -> str:
        return f"Scenario guidance:\n{scenario_system_prompt}"

    @staticmethod
    def _format_runtime_environment_section(session: Session) -> str:
        shell_runner = ShellExecuteTool._resolve_shell_runner("")
        runner_name = str(shell_runner.get("runner") or "shell")
        operating_system = platform.system() or "Unknown"

        parts = [
            "Runtime environment:",
            f"Workspace path: {session.workspace_path}",
            f"Operating system: {operating_system}",
            f"`shell_execute` runner: {runner_name}",
            "`python_execute` already uses the app-managed Python runtime automatically. "
            "Do not search for or hardcode an absolute Python path when using it.",
            "`shell_execute` injects runtime shims so `python`, `python3`, `pip`, `pip3`, `node`, `npm`, and `npx` resolve to the app-managed runtimes when configured. "
            "Prefer those plain command names instead of hardcoded system paths.",
            "When you need to run a Python script file, prefer `python_execute` with "
            "`exec(open('path/to/script.py').read())` or `subprocess.run([sys.executable, 'script.py', ...])` "
            "over `shell_execute` with `python script.py`. `python_execute` avoids shell quoting issues "
            "with paths containing spaces or special characters.",
        ]

        if operating_system.lower().startswith("windows"):
            parts.append(
                "When calling `shell_execute`, use Windows-native commands only. "
                "Prefer PowerShell syntax when available, and do not assume bash commands such as "
                "`ls`, `cat`, `grep`, `cp`, `mv`, or `rm` exist."
            )
        else:
            parts.append(
                "When calling `shell_execute`, use commands that match the current shell and operating system."
            )

        return "\n".join(parts)

    @staticmethod
    def _format_delegation_guidance_section() -> str:
        return "\n".join(
            [
                "Delegation guidance:",
                "- `delegate_task` is for bounded, read-only background subtasks.",
                "- Prefer direct reasoning when the task is short or does not benefit from a separate worker.",
                "- When delegating, pass only the minimal structured context needed: `messages`, `tool_results`, `constraints`, and `notes`.",
                "- Do not use `delegate_task` for user questions, file mutations, or image-dependent work unless that content is already reduced to text in context.",
                "- Expect the delegated worker to return a concise `summary` plus structured `data`.",
            ]
        )

    @staticmethod
    def _format_reference_catalog_guidance_section(reference_library_roots: List[str]) -> str:
        lines = [
            "Reference-library routing guidance:",
            "- When a catalog file exists for a reference-library root, use `search_standard_catalog` first to shortlist candidate standards before opening large documents.",
            "- After identifying a likely standard, inspect its structure with `pdf_get_info`, `pdf_get_outline`, `get_document_structure`, or a targeted `file_read` depending on file type.",
            "- Use targeted reads such as `pdf_read_lines`, `read_document_segment`, a narrow `pdf_read_pages` range, or scoped markdown reads to confirm the relevant clause.",
            "- Fall back to `search_documents` only when the catalog is unavailable, stale, or too coarse for the question.",
        ]
        for root_path in reference_library_roots:
            catalog_path = reference_root_catalog_path(root_path)
            lines.append(f"- Catalog path: {catalog_path}")
        return "\n".join(lines)

    @staticmethod
    def _format_skill_catalog_section(skills: List[SkillSummary]) -> str:
        parts = [
            "Local skill catalog:",
            "The following entries are YAML frontmatter scanned from the app skill directory and the current workspace `.agent/skills` directory.",
            "These entries are metadata only. If a skill is relevant, call the `skill_loader` tool with the skill name before following its instructions.",
            "Workspace skills override app skills when names collide.",
        ]
        for skill in skills:
            parts.append("")
            parts.append(f"Skill: {skill.name} ({skill.source})")
            if skill.description:
                parts.append(f"Description: {skill.description}")
            parts.append("```yaml")
            parts.append(skill.frontmatter)
            parts.append("```")
        return "\n".join(parts)

    async def _emit_skill_loaded_event(
        self,
        session: Session,
        run_id: str,
        result: ToolResult,
    ) -> None:
        output = result.output if isinstance(result.output, dict) else {}
        skill_payload = output.get("skill") if isinstance(output.get("skill"), dict) else {}
        skill_name = skill_payload.get("name")
        if not isinstance(skill_name, str) or not skill_name:
            return

        event_payload: Dict[str, Any] = {"skill_name": skill_name}
        source = skill_payload.get("source")
        if isinstance(source, str) and source:
            event_payload["source"] = source

        await self._emit_run_event(session, run_id, "skill_loaded", event_payload)
