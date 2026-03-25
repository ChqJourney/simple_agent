import asyncio
import json
import logging
import platform
import uuid
from typing import Any, Dict, List, Optional, Tuple

from core.user import Message, Session, UserManager
from llms.base import BaseLLM
from runtime.events import RunEvent
from runtime.logs import append_run_event
from skills.base import SkillProvider, SkillSummary
from tools.base import BaseTool, ToolRegistry, ToolResult
from tools.shell_execute import ShellExecuteTool

logger = logging.getLogger(__name__)
MAX_TOOL_EXECUTION_TIMEOUT_SECONDS = 120


class RunInterrupted(Exception):
    pass


class RunInterruptedWithPartial(RunInterrupted):
    def __init__(self, partial_message: Optional[Message] = None):
        super().__init__()
        self.partial_message = partial_message


class Agent:
    def __init__(
        self,
        llm: BaseLLM,
        tool_registry: ToolRegistry,
        user_manager: UserManager,
        skill_provider: Optional[SkillProvider] = None,
        max_tool_rounds: int = 10,
        max_retries: int = 3,
    ):
        self.llm = llm
        self.tool_registry = tool_registry
        self.user_manager = user_manager
        self.skill_provider = skill_provider
        self.max_tool_rounds = max_tool_rounds
        self.max_retries = max_retries
        self._interrupt_event = asyncio.Event()

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
        session.add_message(Message(role="user", content=user_message, attachments=attachments))
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

                assistant_message = await self._stream_llm_with_retry(messages, tools, session, run_id)

                if not assistant_message:
                    continue

                session.add_message(assistant_message)

                if not assistant_message.tool_calls:
                    latest_usage = None
                    if callable(getattr(self.llm, "get_latest_usage", None)):
                        latest_usage = self.llm.get_latest_usage()
                    if latest_usage:
                        assistant_message.usage = latest_usage
                    await self._emit_run_event(
                        session,
                        run_id,
                        "run_completed",
                        {"finish_reason": "assistant_response"},
                    )
                    await self.user_manager.send_to_frontend({
                        "type": "completed",
                        "session_id": session.session_id,
                        "usage": latest_usage,
                    })
                    return

                tool_results = await self._execute_tools(assistant_message.tool_calls, session, run_id)

                for result in tool_results:
                    if result.success:
                        content = result.output
                    else:
                        parts = [f"Error: {result.error}"]
                        if result.output and isinstance(result.output, dict):
                            stderr = result.output.get("stderr", "")
                            if stderr:
                                parts.append(f"stderr: {stderr}")
                        content = "\n".join(parts)
                    session.add_message(Message(
                        role="tool",
                        tool_call_id=result.tool_call_id,
                        name=result.tool_name,
                        content=self._serialize_tool_message_content(content)
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
                session.add_message(partial_message)
            await self._emit_run_event(session, run_id, "run_interrupted")
            await self.user_manager.send_to_frontend({
                "type": "interrupted",
                "session_id": session.session_id
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
        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries):
            if self._interrupt_event.is_set():
                raise RunInterrupted()

            try:
                return await self._stream_llm_response(messages, tools, session, run_id)
            except RunInterrupted:
                raise
            except Exception as e:
                last_error = e
                logger.warning(f"LLM call failed (attempt {attempt + 1}/{self.max_retries}): {e}")
                safe_error = "LLM request failed"
                await self._emit_run_event(
                    session,
                    run_id,
                    "retry_scheduled",
                    {
                        "attempt": attempt + 1,
                        "max_retries": self.max_retries,
                        "error": safe_error,
                    },
                )

                await self.user_manager.send_to_frontend({
                    "type": "retry",
                    "session_id": session.session_id,
                    "attempt": attempt + 1,
                    "max_retries": self.max_retries,
                    "error": safe_error
                })

                if attempt < self.max_retries - 1:
                    backoff = 2 ** attempt
                    await asyncio.sleep(backoff)

        if last_error:
            raise last_error
        return None

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
    def _serialize_tool_message_content(content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, (dict, list, int, float, bool)) or content is None:
            try:
                return json.dumps(content, ensure_ascii=False)
            except TypeError:
                return str(content)
        return str(content)

    @staticmethod
    def _estimate_message_tokens(message: Dict[str, Any]) -> int:
        try:
            serialized = json.dumps(message, ensure_ascii=False)
        except TypeError:
            serialized = str(message)
        return max(1, len(serialized) // 4)

    def _trim_messages_to_context_window(
        self,
        history_messages: List[Dict[str, Any]],
        system_message: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        get_context_length = getattr(self.llm, "_get_context_length", None)
        if not callable(get_context_length):
            if system_message is None:
                return history_messages
            return [system_message, *history_messages]

        context_length = get_context_length()
        if context_length is None or context_length <= 0:
            if system_message is None:
                return history_messages
            return [system_message, *history_messages]

        if not history_messages and system_message is None:
            return []

        get_max_output_tokens = getattr(self.llm, "_get_max_output_tokens", None)
        reserved_output_tokens = get_max_output_tokens() if callable(get_max_output_tokens) else None
        if reserved_output_tokens is None or reserved_output_tokens <= 0:
            reserved_output_tokens = min(2048, max(256, context_length // 8))

        system_tokens = self._estimate_message_tokens(system_message) if system_message is not None else 0
        history_budget = max(context_length - reserved_output_tokens - system_tokens, 0)
        kept_reversed: List[Dict[str, Any]] = []
        used_tokens = 0

        for message in reversed(history_messages):
            message_tokens = self._estimate_message_tokens(message)
            if kept_reversed and used_tokens + message_tokens > history_budget:
                break
            kept_reversed.append(message)
            used_tokens += message_tokens

        if not kept_reversed:
            kept_reversed.append(history_messages[-1])

        trimmed_history = list(reversed(kept_reversed))
        if system_message is None:
            return trimmed_history
        return [system_message, *trimmed_history]

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
        content_chunks: List[str] = []
        reasoning_chunks: List[str] = []
        tool_calls_data: Dict[int, Dict[str, Any]] = {}

        def interrupted_with_partial() -> RunInterrupted:
            partial_message = self._build_interrupted_assistant_message(
                content_chunks,
                reasoning_chunks,
            )
            if partial_message is not None:
                return RunInterruptedWithPartial(partial_message)
            return RunInterrupted()

        try:
            async for chunk in self.llm.stream(messages, tools):
                if self._interrupt_event.is_set():
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
                    await self.user_manager.send_to_frontend({
                        "type": "reasoning_token",
                        "session_id": session.session_id,
                        "content": reasoning_content
                    })

                content = self._get_delta_field(delta, "content")
                if content:
                    content_chunks.append(content)
                    await self.user_manager.send_to_frontend({
                        "type": "token",
                        "session_id": session.session_id,
                        "content": content
                    })

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
                                "function": {"name": "", "arguments": ""}
                            }

                        tool_call_id = self._get_tool_call_delta_field(tool_call_delta, "id")
                        if tool_call_id:
                            tool_calls_data[idx]["id"] = tool_call_id

                        function_delta = self._get_tool_call_delta_field(tool_call_delta, "function")
                        if function_delta:
                            function_name = self._get_delta_field(function_delta, "name")
                            if function_name:
                                tool_calls_data[idx]["function"]["name"] = function_name

                            function_args = self._get_delta_field(function_delta, "arguments")
                            if function_args:
                                tool_calls_data[idx]["function"]["arguments"] += function_args
        except asyncio.CancelledError as exc:
            raise interrupted_with_partial() from exc

        if reasoning_chunks:
            await self.user_manager.send_to_frontend({
                "type": "reasoning_complete",
                "session_id": session.session_id
            })

        content = "".join(content_chunks) if content_chunks else None
        reasoning_content = "".join(reasoning_chunks) if reasoning_chunks else None

        tool_calls: Optional[List[Dict[str, Any]]] = None
        if tool_calls_data:
            tool_calls = []
            for idx in sorted(tool_calls_data.keys()):
                tc = tool_calls_data[idx]
                tool_calls.append({
                    "id": tc["id"],
                    "type": tc["type"],
                    "function": {
                        "name": tc["function"]["name"],
                        "arguments": tc["function"]["arguments"]
                    }
                })

                try:
                    args = json.loads(tc["function"]["arguments"]) if tc["function"]["arguments"] else {}
                except json.JSONDecodeError:
                    args = {}

                await self.user_manager.send_to_frontend({
                    "type": "tool_call",
                    "session_id": session.session_id,
                    "tool_call_id": tc["id"],
                    "name": tc["function"]["name"],
                    "arguments": args
                })
                await self._emit_run_event(
                    session,
                    run_id,
                    "tool_call_requested",
                    {
                        "tool_call_id": tc["id"],
                        "tool_name": tc["function"]["name"],
                        "arguments": args,
                    },
                )

        return Message(
            role="assistant",
            content=content,
            tool_calls=tool_calls,
            reasoning_content=reasoning_content
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

    async def _execute_tools(
        self,
        tool_calls: List[Dict[str, Any]],
        session: Session,
        run_id: str,
    ) -> List[ToolResult]:
        tasks: List[asyncio.Task[ToolResult]] = []
        scheduled_calls: List[Tuple[str, str]] = []
        tool_results: List[ToolResult] = []

        for tool_call in tool_calls:
            if self._interrupt_event.is_set():
                break

            tool_call_id = tool_call["id"]
            function_name = tool_call["function"]["name"]
            arguments_str = tool_call["function"]["arguments"]

            try:
                arguments = json.loads(arguments_str) if arguments_str else {}
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse tool arguments: {e}")
                result = ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=f"Invalid JSON in arguments: {e}"
                )
                tool_results.append(result)
                await self._emit_pre_execution_tool_failure(session, run_id, result)
                continue

            tool = self.tool_registry.get_tool(function_name)
            if not tool:
                logger.error(f"Unknown tool: {function_name}")
                result = ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=f"Unknown tool: {function_name}"
                )
                tool_results.append(result)
                await self._emit_pre_execution_tool_failure(session, run_id, result)
                continue

            validation_error = self._validate_tool_arguments(tool, arguments)
            if validation_error:
                logger.error("Invalid tool arguments for %s: %s", function_name, validation_error)
                result = ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=validation_error,
                )
                tool_results.append(result)
                await self._emit_pre_execution_tool_failure(session, run_id, result)
                continue

            scheduled_calls.append((tool_call_id, function_name))
            tasks.append(asyncio.create_task(
                self._execute_single_tool(tool_call_id, tool, arguments, session, run_id)
            ))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for i, result in enumerate(results):
                call_id, call_name = scheduled_calls[i]
                if isinstance(result, RunInterrupted):
                    raise result
                if isinstance(result, Exception):
                    tool_results.append(ToolResult(
                        tool_call_id=call_id,
                        tool_name=call_name,
                        success=False,
                        output=None,
                        error=str(result)
                    ))
                elif isinstance(result, ToolResult):
                    tool_results.append(result)

        return tool_results

    async def _emit_pre_execution_tool_failure(
        self,
        session: Session,
        run_id: str,
        result: ToolResult,
    ) -> None:
        await self.user_manager.send_to_frontend({
            "type": "tool_result",
            "session_id": session.session_id,
            "tool_call_id": result.tool_call_id,
            "tool_name": result.tool_name,
            "success": False,
            "output": None,
            "error": result.error,
        })
        await self._emit_run_event(
            session,
            run_id,
            "tool_execution_completed",
            {
                "tool_call_id": result.tool_call_id,
                "tool_name": result.tool_name,
                "success": False,
                "error": result.error,
            },
        )

    @staticmethod
    def _clamp_tool_timeout_seconds(tool: BaseTool, arguments: Dict[str, Any]) -> int:
        policy_timeout = getattr(getattr(tool, "policy", None), "timeout_seconds", 30)
        try:
            default_timeout = int(policy_timeout)
        except (TypeError, ValueError):
            default_timeout = 30

        requested_timeout = arguments.get("timeout_seconds", default_timeout)
        try:
            parsed_timeout = int(requested_timeout)
        except (TypeError, ValueError):
            parsed_timeout = default_timeout

        if parsed_timeout < 1:
            parsed_timeout = default_timeout if default_timeout > 0 else 30

        return min(parsed_timeout, MAX_TOOL_EXECUTION_TIMEOUT_SECONDS)

    async def _execute_tool_with_interrupt_timeout(
        self,
        tool: BaseTool,
        tool_call_id: str,
        workspace_path: str,
        timeout_seconds: int,
        arguments: Dict[str, Any],
    ) -> ToolResult:
        if self._interrupt_event.is_set():
            raise RunInterrupted()

        execution_task = asyncio.create_task(
            tool.execute(
                tool_call_id=tool_call_id,
                workspace_path=workspace_path,
                **arguments,
            )
        )
        interrupt_task = asyncio.create_task(self._interrupt_event.wait())

        try:
            done, _ = await asyncio.wait(
                {execution_task, interrupt_task},
                timeout=timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )

            if interrupt_task in done and self._interrupt_event.is_set():
                execution_task.cancel()
                await asyncio.gather(execution_task, return_exceptions=True)
                raise RunInterrupted()

            if execution_task in done:
                return await execution_task

            execution_task.cancel()
            await asyncio.gather(execution_task, return_exceptions=True)
            raise asyncio.TimeoutError(f"{tool.name} timed out after {timeout_seconds} seconds")
        finally:
            interrupt_task.cancel()
            await asyncio.gather(interrupt_task, return_exceptions=True)

    async def _execute_single_tool(
        self,
        tool_call_id: str,
        tool: BaseTool,
        arguments: Dict[str, Any],
        session: Session,
        run_id: str,
    ) -> ToolResult:
        await self._emit_run_event(
            session,
            run_id,
            "tool_execution_started",
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "arguments": arguments,
            },
        )

        execution_mode = self.user_manager.get_session_execution_mode(session.session_id)

        if tool.require_confirmation:
            if execution_mode == "free":
                await self._emit_run_event(
                    session,
                    run_id,
                    "tool_confirmation_skipped",
                    {
                        "tool_call_id": tool_call_id,
                        "tool_name": tool.name,
                        "reason": "execution_mode_free",
                        "execution_mode": execution_mode,
                    },
                )
            elif self.user_manager.is_tool_auto_approved(session.session_id, session.workspace_path, tool.name):
                decision_data = {
                    "decision": "approve_always",
                    "scope": "workspace",
                    "reason": "policy",
                }
            else:
                decision_data = await self.user_manager.request_tool_confirmation(
                    session_id=session.session_id,
                    tool_call_id=tool_call_id,
                    tool_name=tool.name,
                    workspace_path=session.workspace_path,
                    arguments=arguments
                )

            if execution_mode != "free":
                decision = decision_data.get("decision", "reject")
                scope = decision_data.get("scope", "session")
                reason = decision_data.get("reason", "user_action")

                await self.user_manager.send_to_frontend({
                    "type": "tool_decision",
                    "session_id": session.session_id,
                    "tool_call_id": tool_call_id,
                    "name": tool.name,
                    "decision": decision,
                    "scope": scope,
                    "reason": reason
                })

                session.add_message(Message(
                    role="tool",
                    tool_call_id=tool_call_id,
                    name="tool_decision",
                    content=f"decision={decision}; scope={scope}; reason={reason}"
                ))

                if decision == "reject":
                    reject_result = ToolResult(
                        tool_call_id=tool_call_id,
                        tool_name=tool.name,
                        success=False,
                        output=None,
                        error="Tool execution was not approved by user"
                    )
                    await self.user_manager.send_to_frontend({
                        "type": "tool_result",
                        "session_id": session.session_id,
                        "tool_call_id": tool_call_id,
                        "tool_name": tool.name,
                        "success": False,
                        "output": None,
                        "error": reject_result.error
                    })
                    await self._emit_run_event(
                        session,
                        run_id,
                        "tool_execution_completed",
                        {
                            "tool_call_id": tool_call_id,
                            "tool_name": tool.name,
                            "success": False,
                            "error": reject_result.error,
                        },
                    )
                    return reject_result

        effective_timeout_seconds = self._clamp_tool_timeout_seconds(tool, arguments)
        arguments["timeout_seconds"] = effective_timeout_seconds

        try:
            result = await self._execute_tool_with_interrupt_timeout(
                tool=tool,
                tool_call_id=tool_call_id,
                workspace_path=session.workspace_path,
                timeout_seconds=effective_timeout_seconds,
                arguments=arguments,
            )

            if tool.name == "ask_question" and result.success:
                result = await self._resolve_question_tool_result(
                    session=session,
                    run_id=run_id,
                    tool_call_id=tool_call_id,
                    tool=tool,
                    initial_output=result.output,
                )

            await self.user_manager.send_to_frontend({
                "type": "tool_result",
                "session_id": session.session_id,
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "success": result.success,
                "output": result.output,
                "error": result.error
            })
            await self._emit_run_event(
                session,
                run_id,
                "tool_execution_completed",
                {
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": result.success,
                    "error": result.error,
                },
            )
            if tool.name == "skill_loader" and result.success:
                await self._emit_skill_loaded_event(session, run_id, result)

            return result
        except asyncio.TimeoutError as e:
            error_message = str(e)
            logger.warning(
                "Tool execution timed out: %s (%s seconds)",
                tool.name,
                effective_timeout_seconds,
            )
            timeout_result = ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool.name,
                success=False,
                output=None,
                error=error_message,
            )
            await self.user_manager.send_to_frontend({
                "type": "tool_result",
                "session_id": session.session_id,
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "success": False,
                "output": None,
                "error": error_message,
            })
            await self._emit_run_event(
                session,
                run_id,
                "tool_execution_completed",
                {
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": False,
                    "error": error_message,
                },
            )
            return timeout_result
        except RunInterrupted:
            raise
        except Exception as e:
            logger.exception(f"Tool execution failed: {tool.name}")
            safe_error = "Tool execution failed. Check backend logs."
            error_result = ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool.name,
                success=False,
                output=None,
                error=safe_error
            )

            await self.user_manager.send_to_frontend({
                "type": "tool_result",
                "session_id": session.session_id,
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "success": False,
                "output": None,
                "error": safe_error
            })
            await self._emit_run_event(
                session,
                run_id,
                "tool_execution_completed",
                {
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": False,
                    "error": safe_error,
                },
            )

            return error_result

    async def _resolve_question_tool_result(
        self,
        session: Session,
        run_id: str,
        tool_call_id: str,
        tool: BaseTool,
        initial_output: Any,
    ) -> ToolResult:
        if not isinstance(initial_output, dict) or initial_output.get("event") != "pending_question":
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool.name,
                success=False,
                output=None,
                error="ask_question returned invalid payload",
            )

        question = str(initial_output.get("question") or "")
        details = str(initial_output.get("details") or "")
        options = initial_output.get("options")
        if not isinstance(options, list):
            options = []

        await self._emit_run_event(
            session,
            run_id,
            "question_requested",
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "question": question,
            },
        )

        response = await self.user_manager.request_question_response(
            session_id=session.session_id,
            tool_call_id=tool_call_id,
            tool_name=tool.name,
            question=question,
            details=details,
            options=[str(option) for option in options],
        )

        action = response.get("action", "dismiss")
        answer = response.get("answer")

        await self._emit_run_event(
            session,
            run_id,
            "question_answered",
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "action": action,
                "answer": answer,
            },
        )

        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=tool.name,
            success=action == "submit",
            output={
                "event": "question_response",
                "question": question,
                "details": details,
                "options": [str(option) for option in options],
                "answer": answer,
                "action": action,
            },
            error=None if action == "submit" else "Question dismissed by user",
            metadata={"ui_target": "question_prompt"},
        )

    async def _build_llm_messages(self, session: Session, run_id: str) -> List[Dict[str, Any]]:
        messages = session.get_messages_for_llm()
        prompt_sections: List[str] = [self._format_runtime_environment_section(session)]

        if self.skill_provider:
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

        system_message = {"role": "system", "content": "\n\n".join(prompt_sections)} if prompt_sections else None
        return self._trim_messages_to_context_window(messages, system_message)

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
