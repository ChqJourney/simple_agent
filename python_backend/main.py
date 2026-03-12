import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Set

import httpx

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.agent import Agent
from core.user import Session, UserManager
from llms.base import BaseLLM
from llms.capabilities import coerce_reasoning_enabled
from llms.openai import OpenAILLM
from llms.ollama import OLLAMA_DEFAULT_BASE_URL, OllamaLLM, normalize_ollama_base_url
from llms.qwen import QwenLLM
from tools.base import ToolRegistry
from tools.file_read import FileReadTool
from tools.file_write import FileWriteTool

SendCallback = Callable[[Dict[str, Any]], Any]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tool_registry = ToolRegistry()
tool_registry.register(FileReadTool())
tool_registry.register(FileWriteTool())

user_manager = UserManager()
state_lock = asyncio.Lock()


@dataclass
class BackendRuntimeState:
    active_agents: Dict[str, Agent] = field(default_factory=dict)
    current_llm: Optional[BaseLLM] = None
    current_config: Optional[Dict[str, Any]] = None
    default_workspace: str = field(default_factory=lambda: str(Path.cwd()))
    connection_workspaces: Dict[str, str] = field(default_factory=dict)
    pending_tasks: Set[asyncio.Task] = field(default_factory=set)
    active_session_tasks: Dict[str, object] = field(default_factory=dict)
    task_connections: Dict[asyncio.Task, str] = field(default_factory=dict)
    task_sessions: Dict[asyncio.Task, str] = field(default_factory=dict)


runtime_state = BackendRuntimeState()
SESSION_TASK_RESERVED = object()

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "ollama": OLLAMA_DEFAULT_BASE_URL,
}


def _default_base_url(provider: str) -> str:
    return DEFAULT_BASE_URLS.get(provider.lower(), "")


def _normalize_provider_config(data: Dict[str, Any]) -> Dict[str, Any]:
    provider = str(data.get("provider") or "openai").strip().lower() or "openai"
    default_model = "gpt-4" if provider == "openai" else ""
    model = str(data.get("model") or default_model).strip()
    api_key = str(data.get("api_key") or "").strip()
    base_url = str(data.get("base_url") or "").strip() or _default_base_url(provider)

    if provider == "ollama":
        base_url = normalize_ollama_base_url(base_url)

    normalized = coerce_reasoning_enabled({
        "provider": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
        "enable_reasoning": bool(data.get("enable_reasoning", False)),
        "input_type": data.get("input_type") or "text",
    })

    normalized["provider"] = provider
    normalized["model"] = model
    normalized["api_key"] = api_key
    normalized["base_url"] = base_url
    return normalized


def create_llm(config: Dict[str, Any]) -> BaseLLM:
    normalized_config = _normalize_provider_config(config)
    provider = normalized_config.get("provider", "openai")

    if provider == "openai":
        return OpenAILLM(normalized_config)
    if provider == "qwen":
        return QwenLLM(normalized_config)
    if provider == "ollama":
        return OllamaLLM(normalized_config)
    raise ValueError(f"Unknown provider: {provider}")


def _forget_task(task: asyncio.Task) -> None:
    runtime_state.pending_tasks.discard(task)
    connection_id = runtime_state.task_connections.pop(task, None)
    session_id = runtime_state.task_sessions.pop(task, None)

    if connection_id:
        logger.debug("Task released for connection %s", connection_id)

    if session_id and runtime_state.active_session_tasks.get(session_id) is task:
        runtime_state.active_session_tasks.pop(session_id, None)


async def cleanup_connection_tasks(connection_id: str) -> None:
    async with state_lock:
        task_contexts = [
            (task, runtime_state.task_sessions.get(task))
            for task, task_connection_id in list(runtime_state.task_connections.items())
            if task_connection_id == connection_id
        ]
        runtime_state.connection_workspaces.pop(connection_id, None)

    for task, session_id in task_contexts:
        if session_id:
            agent = runtime_state.active_agents.get(session_id)
            if agent:
                agent.interrupt()
        task.cancel()

    if task_contexts:
        await asyncio.gather(*(task for task, _ in task_contexts), return_exceptions=True)


async def cleanup_all_tasks() -> None:
    async with state_lock:
        task_contexts = [
            (task, runtime_state.task_sessions.get(task))
            for task in list(runtime_state.pending_tasks)
        ]

    for task, session_id in task_contexts:
        if session_id:
            agent = runtime_state.active_agents.get(session_id)
            if agent:
                agent.interrupt()
        task.cancel()

    if task_contexts:
        await asyncio.gather(*(task for task, _ in task_contexts), return_exceptions=True)


async def get_or_create_agent(session_id: str) -> Optional[Agent]:
    async with state_lock:
        if not runtime_state.current_llm:
            return None

        if session_id not in runtime_state.active_agents:
            agent = Agent(
                llm=runtime_state.current_llm,
                tool_registry=tool_registry,
                user_manager=user_manager
            )
            runtime_state.active_agents[session_id] = agent

        return runtime_state.active_agents.get(session_id)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected")
    connection_id = str(uuid.uuid4())

    async def send_callback(message: Dict[str, Any]) -> None:
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Failed to send message: {e}")

    await user_manager.register_connection(connection_id, send_callback)

    try:
        while True:
            try:
                data = await websocket.receive_json()
                await handle_message(websocket, data, send_callback, connection_id)
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.exception(f"Error processing message: {e}")
                try:
                    await websocket.send_json({
                        "type": "error",
                        "error": str(e)
                    })
                except Exception:
                    pass
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.exception(f"WebSocket error: {e}")
    finally:
        await cleanup_connection_tasks(connection_id)
        await user_manager.unregister_connection(connection_id)


async def handle_message(
    websocket: WebSocket,
    data: Dict[str, Any],
    send_callback: SendCallback,
    connection_id: str,
) -> None:
    message_type = data.get("type")

    if message_type == "config":
        await handle_config(data, send_callback)
    elif message_type == "message":
        await handle_user_message(data, send_callback, connection_id)
    elif message_type == "tool_confirm":
        await handle_tool_confirm(data)
    elif message_type == "interrupt":
        await handle_interrupt(data)
    elif message_type == "set_workspace":
        await handle_set_workspace(data, send_callback, connection_id)
    else:
        await send_callback({
            "type": "error",
            "session_id": data.get("session_id"),
            "error": f"Unknown message type: {message_type}"
        })


async def handle_config(data: Dict[str, Any], send_callback: SendCallback) -> None:
    try:
        config = _normalize_provider_config(data)

        await cleanup_all_tasks()

        new_llm = create_llm(config)

        async with state_lock:
            runtime_state.current_config = config
            runtime_state.current_llm = new_llm
            runtime_state.active_agents.clear()

        await send_callback({
            "type": "config_updated",
            "provider": runtime_state.current_config["provider"],
            "model": runtime_state.current_config["model"]
        })

        logger.info(
            "Configuration updated: provider=%s, model=%s",
            runtime_state.current_config["provider"],
            runtime_state.current_config["model"],
        )

    except Exception as e:
        logger.exception(f"Failed to configure LLM: {e}")
        await send_callback({
            "type": "error",
            "error": f"Failed to configure LLM: {str(e)}"
        })


async def handle_user_message(
    data: Dict[str, Any],
    send_callback: SendCallback,
    connection_id: str,
) -> None:
    session_id = data.get("session_id")
    content = data.get("content")
    workspace_path = data.get("workspace_path")

    if not session_id:
        await send_callback({
            "type": "error",
            "error": "Missing session_id"
        })
        return

    if not content:
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": "Missing content"
        })
        return

    async with state_lock:
        llm = runtime_state.current_llm
        workspace = (
            workspace_path
            if workspace_path
            else runtime_state.connection_workspaces.get(connection_id, runtime_state.default_workspace)
        )
        existing_task = runtime_state.active_session_tasks.get(session_id)

        if existing_task is not None and (
            existing_task is SESSION_TASK_RESERVED
            or not existing_task.done()
        ):
            llm = None
            workspace = None
            session_reserved = False
            duplicate_run = True
        else:
            duplicate_run = False
            session_reserved = llm is not None
            if session_reserved:
                runtime_state.active_session_tasks[session_id] = SESSION_TASK_RESERVED

    if duplicate_run:
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": f"Session {session_id} already has an active run"
        })
        return

    if not llm:
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": "LLM not configured. Please send a config message first."
        })
        return

    try:
        session = user_manager.get_session(session_id)
        if not session:
            session = await user_manager.create_session(workspace, session_id)

        await user_manager.bind_session_to_connection(session_id, connection_id)

        agent = await get_or_create_agent(session_id)
        if not agent:
            await send_callback({
                "type": "error",
                "session_id": session_id,
                "error": "Failed to create agent"
            })
            return

        agent.reset_interrupt()

        task = asyncio.create_task(run_agent_task(agent, content, session, send_callback))
        async with state_lock:
            runtime_state.pending_tasks.add(task)
            runtime_state.active_session_tasks[session_id] = task
            runtime_state.task_connections[task] = connection_id
            runtime_state.task_sessions[task] = session_id
        task.add_done_callback(_forget_task)

    except Exception as e:
        if session_reserved:
            async with state_lock:
                if runtime_state.active_session_tasks.get(session_id) is SESSION_TASK_RESERVED:
                    runtime_state.active_session_tasks.pop(session_id, None)
        logger.exception(f"Failed to handle user message: {e}")
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": str(e)
        })


async def run_agent_task(agent: Agent, content: str, session: Session, send_callback: SendCallback) -> None:
    try:
        await agent.run(content, session)
    except asyncio.CancelledError:
        logger.info("Agent task cancelled for session: %s", session.session_id)
        raise
    except Exception as e:
        logger.exception(f"Agent run failed: {e}")
        await send_callback({
            "type": "error",
            "session_id": session.session_id,
            "error": str(e)
        })


async def handle_tool_confirm(data: Dict[str, Any]) -> None:
    tool_call_id = data.get("tool_call_id")
    approved = data.get("approved")
    decision = data.get("decision")
    scope = data.get("scope", "session")

    if not tool_call_id:
        logger.warning("Tool confirm received without tool_call_id")
        return

    if decision not in ("approve_once", "approve_always", "reject", None):
        decision = None

    if scope not in ("session", "workspace"):
        scope = "session"

    await user_manager.handle_tool_confirmation(
        tool_call_id=tool_call_id,
        approved=approved,
        decision=decision,
        scope=scope
    )

    logger.info(
        "Tool confirmation processed: %s -> decision=%s approved=%s scope=%s",
        tool_call_id,
        decision,
        approved,
        scope,
    )


async def handle_interrupt(data: Dict[str, Any]) -> None:
    session_id = data.get("session_id")

    if not session_id:
        logger.warning("Interrupt received without session_id")
        return

    async with state_lock:
        agent = runtime_state.active_agents.get(session_id)

    if agent:
        agent.interrupt()
        logger.info(f"Agent interrupted for session: {session_id}")


async def handle_set_workspace(
    data: Dict[str, Any],
    send_callback: SendCallback,
    connection_id: Optional[str] = None,
) -> None:
    workspace_path = data.get("workspace_path")

    if not workspace_path:
        await send_callback({
            "type": "error",
            "error": "Missing workspace_path"
        })
        return

    workspace = Path(workspace_path)
    if not workspace.exists():
        await send_callback({
            "type": "error",
            "error": f"Workspace path does not exist: {workspace_path}"
        })
        return

    if not workspace.is_dir():
        await send_callback({
            "type": "error",
            "error": f"Workspace path is not a directory: {workspace_path}"
        })
        return

    resolved_workspace = str(workspace.resolve())

    async with state_lock:
        if connection_id:
            runtime_state.connection_workspaces[connection_id] = resolved_workspace

    await send_callback({
        "type": "workspace_updated",
        "workspace_path": resolved_workspace
    })

    logger.info(f"Workspace updated: {resolved_workspace}")


@app.get("/")
async def root():
    async with state_lock:
        config = runtime_state.current_config
    return {
        "message": "AI Agent Backend",
        "status": "running",
        "provider": config.get("provider") if config else None,
        "model": config.get("model") if config else None
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/test-config")
async def test_config(data: Dict[str, Any]):
    raw_provider = str(data.get("provider") or "").strip().lower()
    if not raw_provider:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing provider"})

    if raw_provider not in ("openai", "qwen", "ollama"):
        return JSONResponse(status_code=400, content={"ok": False, "error": f"Unsupported provider: {raw_provider}"})

    config = _normalize_provider_config({**data, "provider": raw_provider})
    provider = config["provider"]
    api_key = config["api_key"]
    model = config["model"]
    base_url = config["base_url"]

    if provider != "ollama" and not api_key:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing api_key"})

    if not base_url:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing base_url"})

    headers: Dict[str, str] = {}
    if provider != "ollama":
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if provider == "ollama":
                target_url = f"{base_url}/api/tags"
                response = await client.get(target_url, headers=headers)
                if response.is_success:
                    return {"ok": True}

                error_text = response.text[:500] if response.text else f"HTTP {response.status_code}"
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "error": f"Ollama probe failed ({response.status_code}): {error_text}"
                    },
                )

            models_url = f"{base_url.rstrip('/')}/models"
            response = await client.get(models_url, headers=headers)
            if response.is_success:
                return {"ok": True}

            fallback_allowed = (
                response.status_code in (404, 405, 501)
                or "coding.dashscope.aliyuncs.com" in base_url
            )

            if fallback_allowed:
                if not model:
                    return JSONResponse(
                        status_code=400,
                        content={
                            "ok": False,
                            "error": (
                                "Models endpoint is not available for this base_url, "
                                "and model is required for chat-completions probe."
                            ),
                        },
                    )

                chat_url = f"{base_url.rstrip('/')}/chat/completions"
                chat_headers = {**headers, "Content-Type": "application/json"}
                chat_payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "stream": False,
                    "max_tokens": 1,
                }
                chat_response = await client.post(chat_url, headers=chat_headers, json=chat_payload)
                if chat_response.is_success:
                    return {"ok": True}

                chat_error = chat_response.text[:500] if chat_response.text else f"HTTP {chat_response.status_code}"
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "error": (
                            f"Models probe failed ({response.status_code}) and chat-completions probe "
                            f"failed ({chat_response.status_code}): {chat_error}"
                        ),
                    },
                )

            error_text = response.text[:500] if response.text else f"HTTP {response.status_code}"
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "error": f"Models probe failed ({response.status_code}): {error_text}"
                },
            )
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
