import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from core.agent_streaming import RunInterrupted
from core.user import Message, Session, UserManager
from tools.base import BaseTool, ToolExecutionError, ToolRegistry, ToolResult

logger = logging.getLogger(__name__)
MAX_TOOL_EXECUTION_TIMEOUT_SECONDS = 120
MAX_DELEGATED_TASK_TIMEOUT_SECONDS = 600
TOOL_CANCEL_GRACE_SECONDS = 0.5
SERIAL_HEAVY_PDF_TOOLS = {"pdf_search", "pdf_read_pages", "read_document_segment"}
RunEventEmitter = Callable[
    [Session, str, str, Optional[Dict[str, Any]], Optional[int]], Awaitable[None]
]


class ToolExecutionCoordinator:
    def __init__(
        self,
        tool_registry: ToolRegistry,
        user_manager: UserManager,
        interrupt_event: asyncio.Event,
        emit_run_event: RunEventEmitter,
        reference_library_roots: Optional[List[str]] = None,
    ) -> None:
        self.tool_registry = tool_registry
        self.user_manager = user_manager
        self.interrupt_event = interrupt_event
        self.emit_run_event = emit_run_event
        self.reference_library_roots = reference_library_roots

    async def execute_tools(
        self,
        tool_calls: List[Dict[str, Any]],
        session: Session,
        run_id: str,
    ) -> List[ToolResult]:
        parallel_tasks: List[Tuple[int, str, str, asyncio.Task[ToolResult]]] = []
        serial_calls: List[Tuple[int, str, BaseTool, Dict[str, Any]]] = []
        indexed_results: Dict[int, ToolResult] = {}

        for index, tool_call in enumerate(tool_calls):
            if self.interrupt_event.is_set():
                break

            tool_call_id = tool_call["id"]
            function_name = tool_call["function"]["name"]
            arguments_str = tool_call["function"]["arguments"]

            try:
                arguments = json.loads(arguments_str) if arguments_str else {}
            except json.JSONDecodeError as exc:
                logger.error("Failed to parse tool arguments: %s", exc)
                result = ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=f"Invalid JSON in arguments: {exc}",
                )
                indexed_results[index] = result
                await self._emit_pre_execution_tool_failure(session, run_id, result)
                continue

            tool = self.tool_registry.get_tool(function_name)
            if not tool:
                logger.error("Unknown tool: %s", function_name)
                result = ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=f"Unknown tool: {function_name}",
                )
                indexed_results[index] = result
                await self._emit_pre_execution_tool_failure(session, run_id, result)
                continue

            validation_error = self._validate_tool_arguments(tool, arguments)
            if validation_error:
                logger.error(
                    "Invalid tool arguments for %s: %s",
                    function_name,
                    validation_error,
                )
                result = ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=validation_error,
                )
                indexed_results[index] = result
                await self._emit_pre_execution_tool_failure(session, run_id, result)
                continue

            if self._should_serialize_tool_execution(function_name, arguments):
                serial_calls.append((index, tool_call_id, tool, arguments))
            else:
                parallel_tasks.append(
                    (
                        index,
                        tool_call_id,
                        function_name,
                        asyncio.create_task(
                            self._execute_single_tool(
                                tool_call_id, tool, arguments, session, run_id
                            )
                        ),
                    )
                )

        if parallel_tasks:
            results = await asyncio.gather(
                *(task for _, _, _, task in parallel_tasks),
                return_exceptions=True,
            )

            for scheduled, result in zip(parallel_tasks, results):
                index, _, _, _ = scheduled
                if isinstance(result, RunInterrupted):
                    raise result
                if isinstance(result, Exception):
                    raise result
                if isinstance(result, ToolResult):
                    indexed_results[index] = result

        for index, tool_call_id, tool, arguments in serial_calls:
            result = await self._execute_single_tool(
                tool_call_id, tool, arguments, session, run_id
            )
            indexed_results[index] = result

        return [indexed_results[index] for index in sorted(indexed_results)]

    @staticmethod
    def _should_serialize_tool_execution(
        function_name: str, arguments: Dict[str, Any]
    ) -> bool:
        if function_name not in SERIAL_HEAVY_PDF_TOOLS:
            return False

        path = str(arguments.get("path") or "").strip().lower()
        if not path:
            return False
        if function_name == "read_document_segment":
            return path.endswith(".pdf")
        return True

    async def _emit_pre_execution_tool_failure(
        self,
        session: Session,
        run_id: str,
        result: ToolResult,
    ) -> None:
        await self.user_manager.send_to_frontend(
            {
                "type": "tool_result",
                "session_id": session.session_id,
                "tool_call_id": result.tool_call_id,
                "tool_name": result.tool_name,
                "success": False,
                "output": None,
                "error": result.error,
            }
        )
        await self.emit_run_event(
            session,
            run_id,
            "tool_execution_completed",
            {
                "tool_call_id": result.tool_call_id,
                "tool_name": result.tool_name,
                "success": False,
                "error": result.error,
            },
            None,
        )

    async def _emit_delegated_task_started(
        self,
        session: Session,
        run_id: str,
        tool_call_id: str,
        arguments: Dict[str, Any],
    ) -> None:
        await self.emit_run_event(
            session,
            run_id,
            "delegated_task_started",
            {
                "tool_call_id": tool_call_id,
                "tool_name": "delegate_task",
                "task": arguments.get("task"),
                "expected_output": arguments.get("expected_output", "text"),
            },
            None,
        )

    async def _emit_delegated_task_completed(
        self,
        session: Session,
        run_id: str,
        tool_call_id: str,
        result: ToolResult,
    ) -> None:
        metadata = result.metadata if isinstance(result.metadata, dict) else {}
        worker = metadata.get("worker") if isinstance(metadata.get("worker"), dict) else {}

        await self.emit_run_event(
            session,
            run_id,
            "delegated_task_completed",
            {
                "tool_call_id": tool_call_id,
                "tool_name": result.tool_name,
                "success": result.success,
                "error": result.error,
                "worker_profile_name": worker.get("profile_name"),
                "worker_provider": worker.get("provider"),
                "worker_model": worker.get("model"),
            },
            None,
        )

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

        await self.emit_run_event(session, run_id, "skill_loaded", event_payload, None)

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

        max_timeout = (
            MAX_DELEGATED_TASK_TIMEOUT_SECONDS
            if tool.name == "delegate_task"
            else MAX_TOOL_EXECUTION_TIMEOUT_SECONDS
        )
        return min(parsed_timeout, max_timeout)

    async def execute_tool_with_interrupt_timeout(
        self,
        tool: BaseTool,
        tool_call_id: str,
        workspace_path: str,
        timeout_seconds: int,
        arguments: Dict[str, Any],
    ) -> ToolResult:
        if self.interrupt_event.is_set():
            raise RunInterrupted()

        execution_task = asyncio.create_task(
            tool.execute(
                tool_call_id=tool_call_id,
                workspace_path=workspace_path,
                reference_library_roots=self.reference_library_roots,
                **arguments,
            )
        )
        interrupt_task = asyncio.create_task(self.interrupt_event.wait())
        cancel_context = f"tool task {tool.name}:{tool_call_id}"

        try:
            done, _ = await asyncio.wait(
                {execution_task, interrupt_task},
                timeout=timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )

            if interrupt_task in done and self.interrupt_event.is_set():
                await self._cancel_task_with_grace(execution_task, cancel_context)
                raise RunInterrupted()

            if execution_task in done:
                return await execution_task

            await self._cancel_task_with_grace(execution_task, cancel_context)
            raise asyncio.TimeoutError(
                f"{tool.name} timed out after {timeout_seconds} seconds"
            )
        except asyncio.CancelledError as exc:
            await self._cancel_task_with_grace(execution_task, cancel_context)
            raise RunInterrupted() from exc
        finally:
            interrupt_task.cancel()
            await asyncio.gather(interrupt_task, return_exceptions=True)

    @staticmethod
    async def _cancel_task_with_grace(task: asyncio.Task[Any], context: str) -> None:
        if task.done():
            await asyncio.gather(task, return_exceptions=True)
            return

        task.cancel()
        try:
            await asyncio.wait_for(
                asyncio.gather(task, return_exceptions=True),
                timeout=TOOL_CANCEL_GRACE_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Timed out waiting %.2fs for %s to cancel cleanly",
                TOOL_CANCEL_GRACE_SECONDS,
                context,
            )

    async def _execute_single_tool(
        self,
        tool_call_id: str,
        tool: BaseTool,
        arguments: Dict[str, Any],
        session: Session,
        run_id: str,
    ) -> ToolResult:
        await self.emit_run_event(
            session,
            run_id,
            "tool_execution_started",
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "arguments": arguments,
            },
            None,
        )

        execution_mode = self.user_manager.get_session_execution_mode(session.session_id)

        if tool.require_confirmation:
            if execution_mode == "free":
                await self.emit_run_event(
                    session,
                    run_id,
                    "tool_confirmation_skipped",
                    {
                        "tool_call_id": tool_call_id,
                        "tool_name": tool.name,
                        "reason": "execution_mode_free",
                        "execution_mode": execution_mode,
                    },
                    None,
                )
            elif self.user_manager.is_tool_auto_approved(
                session.session_id, session.workspace_path, tool.name
            ):
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
                    arguments=arguments,
                )

            if execution_mode != "free":
                decision = decision_data.get("decision", "reject")
                scope = decision_data.get("scope", "session")
                reason = decision_data.get("reason", "user_action")

                await self.user_manager.send_to_frontend(
                    {
                        "type": "tool_decision",
                        "session_id": session.session_id,
                        "tool_call_id": tool_call_id,
                        "name": tool.name,
                        "decision": decision,
                        "scope": scope,
                        "reason": reason,
                    }
                )

                await session.add_message_async(
                    Message(
                        role="tool",
                        tool_call_id=tool_call_id,
                        name="tool_decision",
                        content=f"decision={decision}; scope={scope}; reason={reason}",
                    )
                )

                if decision == "reject":
                    reject_result = ToolResult(
                        tool_call_id=tool_call_id,
                        tool_name=tool.name,
                        success=False,
                        output=None,
                        error="Tool execution was not approved by user",
                    )
                    await self.user_manager.send_to_frontend(
                        {
                            "type": "tool_result",
                            "session_id": session.session_id,
                            "tool_call_id": tool_call_id,
                            "tool_name": tool.name,
                            "success": False,
                            "output": None,
                            "error": reject_result.error,
                        }
                    )
                    await self.emit_run_event(
                        session,
                        run_id,
                        "tool_execution_completed",
                        {
                            "tool_call_id": tool_call_id,
                            "tool_name": tool.name,
                            "success": False,
                            "error": reject_result.error,
                        },
                        None,
                    )
                    return reject_result

        effective_timeout_seconds = self._clamp_tool_timeout_seconds(tool, arguments)
        arguments["timeout_seconds"] = effective_timeout_seconds

        try:
            if tool.name == "delegate_task":
                await self._emit_delegated_task_started(
                    session, run_id, tool_call_id, arguments
                )

            result = await self.execute_tool_with_interrupt_timeout(
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

            await self.user_manager.send_to_frontend(
                {
                    "type": "tool_result",
                    "session_id": session.session_id,
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": result.success,
                    "output": result.output,
                    "error": result.error,
                }
            )
            await self.emit_run_event(
                session,
                run_id,
                "tool_execution_completed",
                {
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": result.success,
                    "error": result.error,
                },
                None,
            )
            if tool.name == "delegate_task":
                await self._emit_delegated_task_completed(
                    session, run_id, tool_call_id, result
                )
            if tool.name == "skill_loader" and result.success:
                await self._emit_skill_loaded_event(session, run_id, result)

            return result
        except asyncio.TimeoutError as exc:
            error_message = str(exc)
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
            await self.user_manager.send_to_frontend(
                {
                    "type": "tool_result",
                    "session_id": session.session_id,
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": False,
                    "output": None,
                    "error": error_message,
                }
            )
            await self.emit_run_event(
                session,
                run_id,
                "tool_execution_completed",
                {
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": False,
                    "error": error_message,
                },
                None,
            )
            if tool.name == "delegate_task":
                await self._emit_delegated_task_completed(
                    session, run_id, tool_call_id, timeout_result
                )
            return timeout_result
        except RunInterrupted:
            raise
        except ToolExecutionError as exc:
            error_message = str(exc).strip() or "Tool execution failed."
            error_result = ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool.name,
                success=False,
                output=exc.output,
                error=error_message,
                metadata=dict(exc.metadata),
            )

            await self.user_manager.send_to_frontend(
                {
                    "type": "tool_result",
                    "session_id": session.session_id,
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": False,
                    "output": error_result.output,
                    "error": error_message,
                }
            )
            await self.emit_run_event(
                session,
                run_id,
                "tool_execution_completed",
                {
                    "tool_call_id": tool_call_id,
                    "tool_name": tool.name,
                    "success": False,
                    "error": error_message,
                },
                None,
            )
            if tool.name == "delegate_task":
                await self._emit_delegated_task_completed(
                    session, run_id, tool_call_id, error_result
                )

            return error_result
        except Exception:
            logger.exception("Tool execution failed: %s", tool.name)
            raise

    async def _resolve_question_tool_result(
        self,
        session: Session,
        run_id: str,
        tool_call_id: str,
        tool: BaseTool,
        initial_output: Any,
    ) -> ToolResult:
        if (
            not isinstance(initial_output, dict)
            or initial_output.get("event") != "pending_question"
        ):
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

        await self.emit_run_event(
            session,
            run_id,
            "question_requested",
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "question": question,
            },
            None,
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

        await self.emit_run_event(
            session,
            run_id,
            "question_answered",
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool.name,
                "action": action,
                "answer": answer,
            },
            None,
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

    @staticmethod
    def _validate_tool_arguments(
        tool: BaseTool, arguments: Dict[str, Any]
    ) -> Optional[str]:
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
            "number": lambda value: (
                isinstance(value, int) or isinstance(value, float)
            )
            and not isinstance(value, bool),
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
