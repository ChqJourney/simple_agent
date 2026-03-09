import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from core.agent import Agent
from core.user import Session, UserManager
from llms.base import BaseLLM
from llms.openai import OpenAILLM
from llms.qwen import QwenLLM
from llms.ollama import OllamaLLM
from tools.base import ToolRegistry
from tools.file_read import FileReadTool
from tools.file_write import FileWriteTool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tool_registry = ToolRegistry()
tool_registry.register(FileReadTool())
tool_registry.register(FileWriteTool())

user_manager = UserManager()
active_agents: Dict[str, Agent] = {}
current_llm: Optional[BaseLLM] = None
current_config: Optional[Dict[str, Any]] = None
current_workspace: str = str(Path.cwd())


def create_llm(config: Dict[str, Any]) -> BaseLLM:
    provider = config.get("provider", "openai").lower()
    
    if provider == "openai":
        return OpenAILLM(config)
    elif provider == "qwen":
        return QwenLLM(config)
    elif provider == "ollama":
        return OllamaLLM(config)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def get_or_create_agent(session_id: str) -> Optional[Agent]:
    global current_llm
    
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
    global current_llm, current_config, current_workspace
    
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
            except Exception as e:
                logger.exception(f"Error processing message: {e}")
                await websocket.send_json({
                    "type": "error",
                    "error": str(e)
                })
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
    send_callback: Any
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
            "error": f"Unknown message type: {message_type}"
        })


async def handle_config(data: Dict[str, Any], send_callback: Any) -> None:
    global current_llm, current_config
    
    try:
        current_config = {
            "provider": data.get("provider", "openai"),
            "model": data.get("model", "gpt-4"),
            "api_key": data.get("api_key"),
            "base_url": data.get("base_url"),
            "enable_reasoning": data.get("enable_reasoning", False)
        }
        
        current_llm = create_llm(current_config)
        
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


async def handle_user_message(data: Dict[str, Any], send_callback: Any) -> None:
    global current_llm, current_workspace
    
    session_id = data.get("session_id")
    content = data.get("content")
    
    if not session_id:
        await send_callback({
            "type": "error",
            "error": "Missing session_id"
        })
        return
    
    if not content:
        await send_callback({
            "type": "error",
            "error": "Missing content"
        })
        return
    
    if not current_llm:
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": "LLM not configured. Please send a config message first."
        })
        return
    
    try:
        session = user_manager.get_session(session_id)
        if not session:
            session = await user_manager.create_session(current_workspace, session_id)
        
        agent = get_or_create_agent(session_id)
        if not agent:
            await send_callback({
                "type": "error",
                "session_id": session_id,
                "error": "Failed to create agent"
            })
            return
        
        agent.reset_interrupt()
        
        asyncio.create_task(run_agent_task(agent, content, session))
        
    except Exception as e:
        logger.exception(f"Failed to handle user message: {e}")
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": str(e)
        })


async def run_agent_task(agent: Agent, content: str, session: Session) -> None:
    try:
        await agent.run(content, session)
    except Exception as e:
        logger.exception(f"Agent run failed: {e}")


async def handle_tool_confirm(data: Dict[str, Any]) -> None:
    tool_call_id = data.get("tool_call_id")
    approved = data.get("approved", False)
    
    if not tool_call_id:
        logger.warning("Tool confirm received without tool_call_id")
        return
    
    await user_manager.handle_tool_confirmation(tool_call_id, approved)
    logger.info(f"Tool confirmation processed: {tool_call_id} -> {approved}")


async def handle_interrupt(data: Dict[str, Any]) -> None:
    session_id = data.get("session_id")
    
    if not session_id:
        logger.warning("Interrupt received without session_id")
        return
    
    agent = active_agents.get(session_id)
    if agent:
        agent.interrupt()
        logger.info(f"Agent interrupted for session: {session_id}")


async def handle_set_workspace(data: Dict[str, Any], send_callback: Any) -> None:
    global current_workspace
    
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
    
    current_workspace = str(workspace.resolve())
    
    await send_callback({
        "type": "workspace_updated",
        "workspace_path": current_workspace
    })
    
    logger.info(f"Workspace updated: {current_workspace}")


@app.get("/")
async def root():
    return {
        "message": "AI Agent Backend",
        "status": "running",
        "provider": current_config.get("provider") if current_config else None,
        "model": current_config.get("model") if current_config else None
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)