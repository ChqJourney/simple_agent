import asyncio
import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Set

import httpx

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.agent import Agent
from core.user import Session, UserManager
from llms.base import BaseLLM
from llms.openai import OpenAILLM
from llms.qwen import QwenLLM
from llms.ollama import OllamaLLM
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
active_agents: Dict[str, Agent] = {}
current_llm: Optional[BaseLLM] = None
current_config: Optional[Dict[str, Any]] = None
current_workspace: str = str(Path.cwd())
pending_tasks: Set[asyncio.Task] = set()


def create_llm(config: Dict[str, Any]) -> BaseLLM:
    provider = config.get("provider", "openai").lower()

    if provider == "openai":
        return OpenAILLM(config)
    if provider == "qwen":
        return QwenLLM(config)
    if provider == "ollama":
        return OllamaLLM(config)
    raise ValueError(f"Unknown provider: {provider}")


async def get_or_create_agent(session_id: str) -> Optional[Agent]:
    async with state_lock:
        if not current_llm:
            return None

        if session_id not in active_agents:
            agent = Agent(
                llm=current_llm,
                tool_registry=tool_registry,
                user_manager=user_manager
            )
            active_agents[session_id] = agent

        return active_agents.get(session_id)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected")

    async def send_callback(message: Dict[str, Any]) -> None:
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Failed to send message: {e}")

    user_manager.set_ws_callback(send_callback)

    try:
        while True:
            try:
                data = await websocket.receive_json()
                await handle_message(websocket, data, send_callback)
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
        user_manager.set_ws_callback(None)
        await user_manager.clear_all_confirmations()


async def handle_message(
    websocket: WebSocket,
    data: Dict[str, Any],
    send_callback: SendCallback
) -> None:
    message_type = data.get("type")

    if message_type == "config":
        await handle_config(data, send_callback)
    elif message_type == "message":
        await handle_user_message(data, send_callback)
    elif message_type == "tool_confirm":
        await handle_tool_confirm(data)
    elif message_type == "interrupt":
        await handle_interrupt(data)
    elif message_type == "set_workspace":
        await handle_set_workspace(data, send_callback)
    else:
        await send_callback({
            "type": "error",
            "session_id": data.get("session_id"),
            "error": f"Unknown message type: {message_type}"
        })


async def handle_config(data: Dict[str, Any], send_callback: SendCallback) -> None:
    try:
        config = {
            "provider": data.get("provider", "openai"),
            "model": data.get("model", "gpt-4"),
            "api_key": data.get("api_key"),
            "base_url": data.get("base_url"),
            "enable_reasoning": data.get("enable_reasoning", False)
        }

        new_llm = create_llm(config)

        async with state_lock:
            global current_llm, current_config
            current_config = config
            current_llm = new_llm
            active_agents.clear()

        await send_callback({
            "type": "config_updated",
            "provider": current_config["provider"],
            "model": current_config["model"]
        })

        logger.info(f"Configuration updated: provider={current_config['provider']}, model={current_config['model']}")

    except Exception as e:
        logger.exception(f"Failed to configure LLM: {e}")
        await send_callback({
            "type": "error",
            "error": f"Failed to configure LLM: {str(e)}"
        })


async def handle_user_message(data: Dict[str, Any], send_callback: SendCallback) -> None:
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
        llm = current_llm
        workspace = workspace_path if workspace_path else current_workspace

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
        pending_tasks.add(task)
        task.add_done_callback(pending_tasks.discard)

    except Exception as e:
        logger.exception(f"Failed to handle user message: {e}")
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": str(e)
        })


async def run_agent_task(agent: Agent, content: str, session: Session, send_callback: SendCallback) -> None:
    try:
        await agent.run(content, session)
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
        agent = active_agents.get(session_id)

    if agent:
        agent.interrupt()
        logger.info(f"Agent interrupted for session: {session_id}")


async def handle_set_workspace(data: Dict[str, Any], send_callback: SendCallback) -> None:
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
        global current_workspace
        current_workspace = resolved_workspace

    await send_callback({
        "type": "workspace_updated",
        "workspace_path": resolved_workspace
    })

    logger.info(f"Workspace updated: {resolved_workspace}")


@app.get("/")
async def root():
    async with state_lock:
        config = current_config
    return {
        "message": "AI Agent Backend",
        "status": "running",
        "provider": config.get("provider") if config else None,
        "model": config.get("model") if config else None
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}



def _default_base_url(provider: str) -> str:
    provider_lower = provider.lower()
    if provider_lower == "openai":
        return "https://api.openai.com/v1"
    if provider_lower == "qwen":
        return "https://dashscope.aliyuncs.com/compatible-mode/v1"
    if provider_lower == "ollama":
        return "http://localhost:11434"
    return ""


@app.post("/test-config")
async def test_config(data: Dict[str, Any]):
    provider = str(data.get("provider") or "").lower()
    api_key = data.get("api_key")
    model = str(data.get("model") or "").strip()
    base_url = str(data.get("base_url") or "").strip() or _default_base_url(provider)

    if not provider:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing provider"})

    if provider not in ("openai", "qwen", "ollama"):
        return JSONResponse(status_code=400, content={"ok": False, "error": f"Unsupported provider: {provider}"})

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
                normalized = base_url.rstrip("/")
                if normalized.endswith("/v1"):
                    normalized = normalized[:-3]
                target_url = f"{normalized}/api/tags"
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




