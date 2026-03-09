import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from core.user import Message, Session, UserManager
from llms.base import BaseLLM
from tools.base import BaseTool, ToolRegistry, ToolResult

logger = logging.getLogger(__name__)


class Agent:
    def __init__(
        self,
        llm: BaseLLM,
        tool_registry: ToolRegistry,
        user_manager: UserManager
    ):
        self.llm = llm
        self.tool_registry = tool_registry
        self.user_manager = user_manager
        self.max_tool_rounds = 10
        self.max_retries = 3
        self.interrupted = False
        self._interrupt_event = asyncio.Event()
        self._running_task: Optional[asyncio.Task] = None

    def interrupt(self) -> None:
        self.interrupted = True
        self._interrupt_event.set()

    def reset_interrupt(self) -> None:
        self.interrupted = False
        self._interrupt_event.clear()

    async def run(self, user_message: str, session: Session) -> None:
        self.reset_interrupt()
        session.add_message(Message(role="user", content=user_message))

        await self.user_manager.send_to_frontend({
            "type": "started",
            "session_id": session.session_id
        })

        try:
            for round_num in range(self.max_tool_rounds):
                if self.interrupted:
                    await self.user_manager.send_to_frontend({
                        "type": "interrupted",
                        "session_id": session.session_id
                    })
                    return

                messages = session.get_messages_for_llm()
                tools = list(self.tool_registry.tools.values())

                assistant_message = await self._stream_llm_with_retry(messages, tools, session)

                if not assistant_message:
                    continue

                session.add_message(assistant_message)

                if not assistant_message.tool_calls:
                    await self.user_manager.send_to_frontend({
                        "type": "completed",
                        "session_id": session.session_id
                    })
                    return

                tool_results = await self._execute_tools(assistant_message.tool_calls, session)

                for result in tool_results:
                    content = result.output if result.success else f"Error: {result.error}"
                    session.add_message(Message(
                        role="tool",
                        tool_call_id=result.tool_call_id,
                        name=result.tool_name,
                        content=str(content)
                    ))

            await self.user_manager.send_to_frontend({
                "type": "max_rounds_reached",
                "session_id": session.session_id
            })

        except Exception as e:
            logger.exception(f"Agent run failed: {e}")
            await self.user_manager.send_to_frontend({
                "type": "error",
                "session_id": session.session_id,
                "error": str(e)
            })

    async def _stream_llm_with_retry(
        self,
        messages: List[Dict],
        tools: List[BaseTool],
        session: Session
    ) -> Optional[Message]:
        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries):
            if self.interrupted:
                return None

            try:
                return await self._stream_llm_response(messages, tools, session)
            except Exception as e:
                last_error = e
                logger.warning(f"LLM call failed (attempt {attempt + 1}/{self.max_retries}): {e}")

                await self.user_manager.send_to_frontend({
                    "type": "retry",
                    "session_id": session.session_id,
                    "attempt": attempt + 1,
                    "max_retries": self.max_retries,
                    "error": str(e)
                })

                if attempt < self.max_retries - 1:
                    backoff = 2 ** attempt
                    await asyncio.sleep(backoff)

        if last_error:
            raise last_error
        return None

    async def _stream_llm_response(
        self,
        messages: List[Dict],
        tools: List[BaseTool],
        session: Session
    ) -> Message:
        content_chunks: List[str] = []
        reasoning_chunks: List[str] = []
        tool_calls_data: Dict[int, Dict[str, Any]] = {}
        finish_reason: Optional[str] = None

        async for chunk in self.llm.stream(messages, tools):
            if self.interrupted:
                return Message(role="assistant", content="")

            if not chunk.choices:
                continue

            delta = chunk.choices[0].delta

            if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
                reasoning_chunks.append(delta.reasoning_content)
                await self.user_manager.send_to_frontend({
                    "type": "reasoning_token",
                    "session_id": session.session_id,
                    "content": delta.reasoning_content
                })

            if delta.content:
                content_chunks.append(delta.content)
                await self.user_manager.send_to_frontend({
                    "type": "token",
                    "session_id": session.session_id,
                    "content": delta.content
                })

            if delta.tool_calls:
                for tool_call_delta in delta.tool_calls:
                    idx = tool_call_delta.index
                    if idx not in tool_calls_data:
                        tool_calls_data[idx] = {
                            "id": "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""}
                        }

                    if tool_call_delta.id:
                        tool_calls_data[idx]["id"] = tool_call_delta.id
                    if tool_call_delta.function:
                        if tool_call_delta.function.name:
                            tool_calls_data[idx]["function"]["name"] = tool_call_delta.function.name
                        if tool_call_delta.function.arguments:
                            tool_calls_data[idx]["function"]["arguments"] += tool_call_delta.function.arguments

            if chunk.choices[0].finish_reason:
                finish_reason = chunk.choices[0].finish_reason

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

                await self.user_manager.send_to_frontend({
                    "type": "tool_call",
                    "session_id": session.session_id,
                    "tool_call_id": tc["id"],
                    "name": tc["function"]["name"],
                    "arguments": json.loads(tc["function"]["arguments"]) if tc["function"]["arguments"] else {}
                })

        return Message(
            role="assistant",
            content=content,
            tool_calls=tool_calls,
            reasoning_content=reasoning_content
        )

    async def _execute_tools(
        self,
        tool_calls: List[Dict[str, Any]],
        session: Session
    ) -> List[ToolResult]:
        tasks: List[asyncio.Task[ToolResult]] = []

        for tool_call in tool_calls:
            if self.interrupted:
                break

            tool_call_id = tool_call["id"]
            function_name = tool_call["function"]["name"]
            arguments_str = tool_call["function"]["arguments"]

            try:
                arguments = json.loads(arguments_str) if arguments_str else {}
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse tool arguments: {e}")
                return [ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=f"Invalid JSON in arguments: {e}"
                )]

            tool = self.tool_registry.get_tool(function_name)
            if not tool:
                logger.error(f"Unknown tool: {function_name}")
                return [ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=function_name,
                    success=False,
                    output=None,
                    error=f"Unknown tool: {function_name}"
                )]

            tasks.append(asyncio.create_task(
                self._execute_single_tool(tool_call_id, tool, arguments, session)
            ))

        if not tasks:
            return []

        results = await asyncio.gather(*tasks, return_exceptions=True)

        tool_results: List[ToolResult] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                tc = tool_calls[i]
                tool_results.append(ToolResult(
                    tool_call_id=tc["id"],
                    tool_name=tc["function"]["name"],
                    success=False,
                    output=None,
                    error=str(result)
                ))
            elif isinstance(result, ToolResult):
                tool_results.append(result)

        return tool_results

    async def _execute_single_tool(
        self,
        tool_call_id: str,
        tool: BaseTool,
        arguments: Dict[str, Any],
        session: Session
    ) -> ToolResult:
        if tool.require_confirmation:
            approved = await self.user_manager.request_tool_confirmation(
                session_id=session.session_id,
                tool_call_id=tool_call_id,
                tool_name=tool.name,
                arguments=arguments
            )

            if not approved:
                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=tool.name,
                    success=False,
                    output=None,
                    error="Tool execution was not approved by user"
                )

        try:
            result = await tool.execute(**arguments)

            await self.user_manager.send_to_frontend({
                "type": "tool_result",
                "session_id": session.session_id,
                "tool_call_id": tool_call_id,
                "success": result.success,
                "output": result.output
            })

            return result
        except Exception as e:
            logger.exception(f"Tool execution failed: {tool.name}")
            error_result = ToolResult(
                tool_call_id=tool_call_id,
                tool_name=tool.name,
                success=False,
                output=None,
                error=str(e)
            )

            await self.user_manager.send_to_frontend({
                "type": "tool_result",
                "session_id": session.session_id,
                "tool_call_id": tool_call_id,
                "success": False,
                "output": None,
                "error": str(e)
            })

            return error_result