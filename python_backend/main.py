import asyncio
import inspect
import logging
import os
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Set, cast

import httpx

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.agent import Agent
from core.user import Session, UserManager
from llms.base import BaseLLM
from llms.capabilities import get_supported_input_types
from llms.deepseek import DeepSeekLLM
from llms.glm import GLMLLM
from llms.kimi import KimiLLM
from llms.minimax import MiniMaxLLM
from llms.openai import OpenAILLM
from llms.ollama import OLLAMA_DEFAULT_BASE_URL, OllamaLLM
from llms.qwen import QwenLLM
from runtime.config import DEFAULT_RUNTIME_POLICY, get_primary_profile_config, normalize_runtime_config
from runtime.provider_registry import ContextProviderBundle, ContextProviderRegistry
from runtime.router import (
    lock_ref_from_profile,
    resolve_compaction_profile,
    resolve_background_profile,
    resolve_conversation_profile,
    session_lock_matches_profile,
)
from runtime.session_titles import run_session_title_task
from skills.local_loader import LocalSkillLoader, default_skill_search_roots
from tools.base import ToolRegistry
from tools.ask_question import AskQuestionTool
from tools.file_read import FileReadTool
from tools.file_write import FileWriteTool
from tools.get_document_structure import GetDocumentStructureTool
from tools.list_directory_tree import ListDirectoryTreeTool
from tools.node_execute import NodeExecuteTool
from tools.pdf_tools import PdfGetInfoTool, PdfGetOutlineTool, PdfReadLinesTool, PdfReadPagesTool, PdfSearchTool
from tools.python_execute import PythonExecuteTool
from tools.read_document_segment import ReadDocumentSegmentTool
from tools.search_documents import SearchDocumentsTool
from tools.skill_loader import SkillLoaderTool
from tools.shell_execute import ShellExecuteTool
from tools.todo_task import TodoTaskTool

SendCallback = Callable[[Dict[str, Any]], Any]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

ALLOWED_BROWSER_ORIGINS = {
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://tauri.localhost",
    "tauri://localhost",
    "https://tauri.localhost",
}
AUTH_TOKEN_ENV_VAR = "TAURI_AGENT_AUTH_TOKEN"
HTTP_AUTH_HEADER = "x-tauri-agent-auth"


def _load_auth_token() -> tuple[str, bool]:
    configured_token = str(os.environ.get(AUTH_TOKEN_ENV_VAR) or "").strip()
    if configured_token:
        return configured_token, True
    return uuid.uuid4().hex, False

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: nothing extra needed
    yield
    # shutdown: interrupt all active agents so uvicorn can exit cleanly
    for agent in list(runtime_state.active_agents.values()):
        try:
            agent.interrupt()
        except Exception:
            pass
    await cleanup_all_tasks()
    await _close_runtime_llms()

app = FastAPI(title="AI Agent Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_BROWSER_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tool_registry = ToolRegistry()
tool_registry.register(ListDirectoryTreeTool())
tool_registry.register(SearchDocumentsTool())
tool_registry.register(ReadDocumentSegmentTool())
tool_registry.register(GetDocumentStructureTool())
tool_registry.register(PdfGetInfoTool())
tool_registry.register(PdfGetOutlineTool())
tool_registry.register(PdfReadPagesTool())
tool_registry.register(PdfReadLinesTool())
tool_registry.register(PdfSearchTool())
tool_registry.register(FileReadTool())
tool_registry.register(FileWriteTool())
tool_registry.register(ShellExecuteTool())
tool_registry.register(PythonExecuteTool())
tool_registry.register(NodeExecuteTool())
tool_registry.register(TodoTaskTool())
tool_registry.register(AskQuestionTool())
skill_search_roots = default_skill_search_roots()
tool_registry.register(SkillLoaderTool(LocalSkillLoader(search_roots=skill_search_roots)))

user_manager = UserManager()
context_provider_registry = ContextProviderRegistry(
    skill_search_roots=skill_search_roots,
)
state_lock = asyncio.Lock()


@dataclass
class BackendRuntimeState:
    active_agents: Dict[str, Agent] = field(default_factory=dict)
    current_llm: Optional[BaseLLM] = None
    current_config: Optional[Dict[str, Any]] = None
    current_context_bundle: ContextProviderBundle = field(default_factory=ContextProviderBundle)
    default_workspace: str = field(default_factory=lambda: str(Path.cwd()))
    connection_workspaces: Dict[str, str] = field(default_factory=dict)
    pending_tasks: Set[asyncio.Task] = field(default_factory=set)
    active_session_tasks: Dict[str, object] = field(default_factory=dict)
    active_session_compaction_tasks: Dict[str, asyncio.Task] = field(default_factory=dict)
    task_connections: Dict[asyncio.Task, str] = field(default_factory=dict)
    task_sessions: Dict[asyncio.Task, str] = field(default_factory=dict)
    auth_token: str = ""
    auth_token_host_managed: bool = False
    authenticated_connections: Set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if not self.auth_token:
            self.auth_token, self.auth_token_host_managed = _load_auth_token()


runtime_state = BackendRuntimeState()
SESSION_TASK_RESERVED = object()
TOOL_CONFIRM_DECISIONS: Set[str] = {"approve_once", "approve_always", "reject"}
TOOL_CONFIRM_SCOPES: Set[str] = {"session", "workspace"}
EXECUTION_MODES: Set[str] = {"regular", "free"}


def _normalize_non_empty_string(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_optional_bool(value: Any) -> Optional[bool]:
    return value if isinstance(value, bool) else None


def _normalize_tool_decision(value: Any) -> Optional[Literal["approve_once", "approve_always", "reject"]]:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in TOOL_CONFIRM_DECISIONS:
        return cast(Literal["approve_once", "approve_always", "reject"], normalized)
    return None


def _normalize_tool_scope(value: Any) -> Literal["session", "workspace"]:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in TOOL_CONFIRM_SCOPES:
            return cast(Literal["session", "workspace"], normalized)
    return "session"


def _normalize_execution_mode(value: Any) -> Optional[Literal["regular", "free"]]:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in EXECUTION_MODES:
        return cast(Literal["regular", "free"], normalized)
    return None

def _normalize_provider_config(data: Dict[str, Any]) -> Dict[str, Any]:
    return normalize_runtime_config(data)


def create_llm_for_profile(profile: Dict[str, Any], runtime_policy: Optional[Dict[str, Any]] = None) -> BaseLLM:
    provider = profile.get("provider", "openai")
    profile_config = {
        **profile,
        **(runtime_policy or {}),
        "runtime": dict(runtime_policy or {}),
    }

    if provider == "openai":
        return OpenAILLM(profile_config)
    if provider == "deepseek":
        return DeepSeekLLM(profile_config)
    if provider == "kimi":
        return KimiLLM(profile_config)
    if provider == "glm":
        return GLMLLM(profile_config)
    if provider == "minimax":
        return MiniMaxLLM(profile_config)
    if provider == "qwen":
        return QwenLLM(profile_config)
    if provider == "ollama":
        return OllamaLLM(profile_config)
    raise ValueError(f"Unknown provider: {provider}")


def create_llm(config: Dict[str, Any]) -> BaseLLM:
    normalized_config = _normalize_provider_config(config)
    active_profile = get_primary_profile_config(normalized_config)
    runtime_policy = normalized_config.get("runtime") if isinstance(normalized_config.get("runtime"), dict) else {}
    return create_llm_for_profile(active_profile, runtime_policy)


def _forget_task(task: asyncio.Task) -> None:
    runtime_state.pending_tasks.discard(task)
    connection_id = runtime_state.task_connections.pop(task, None)
    session_id = runtime_state.task_sessions.pop(task, None)

    if connection_id:
        logger.debug("Task released for connection %s", connection_id)

    if session_id and runtime_state.active_session_compaction_tasks.get(session_id) is task:
        runtime_state.active_session_compaction_tasks.pop(session_id, None)

    if session_id and runtime_state.active_session_tasks.get(session_id) is task:
        runtime_state.active_session_tasks.pop(session_id, None)
        agent = runtime_state.active_agents.pop(session_id, None)
        llm = getattr(agent, "llm", None) if agent is not None else None
        if llm is not None:
            try:
                asyncio.get_running_loop().create_task(_close_llm_instance(llm))
            except RuntimeError:
                logger.debug("No running loop available to close agent llm for session %s", session_id)


def _origin_allowed(origin: Optional[str]) -> bool:
    if not origin:
        return False
    return origin in ALLOWED_BROWSER_ORIGINS


def _error_payload(
    error: str,
    *,
    session_id: Optional[str] = None,
    details: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"type": "error", "error": error}
    if session_id:
        payload["session_id"] = session_id
    if details:
        payload["details"] = details
    return payload


async def _require_http_auth(request: Request) -> Optional[JSONResponse]:
    provided_token = str(request.headers.get(HTTP_AUTH_HEADER) or "").strip()
    async with state_lock:
        expected_token = runtime_state.auth_token

    if provided_token and provided_token == expected_token:
        return None

    return JSONResponse(status_code=401, content={"ok": False, "error": "Unauthorized"})


async def _close_llm_instance(llm: Optional[BaseLLM]) -> None:
    if llm is None:
        return

    close_candidates = [
        getattr(llm, "aclose", None),
        getattr(llm, "close", None),
    ]
    client = getattr(llm, "client", None)
    if client is not None:
        close_candidates.extend(
            [
                getattr(client, "aclose", None),
                getattr(client, "close", None),
            ]
        )

    attempted: Set[int] = set()
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
            logger.debug("Failed to close llm resource cleanly: %s", exc)


async def _close_runtime_llms() -> None:
    async with state_lock:
        llm_instances: List[BaseLLM] = []
        if runtime_state.current_llm is not None:
            llm_instances.append(runtime_state.current_llm)
        for agent in runtime_state.active_agents.values():
            if getattr(agent, "llm", None) is not None:
                llm_instances.append(agent.llm)

    seen: Set[int] = set()
    for llm in llm_instances:
        llm_id = id(llm)
        if llm_id in seen:
            continue
        seen.add(llm_id)
        await _close_llm_instance(llm)


async def cleanup_connection_tasks(connection_id: str) -> None:
    async with state_lock:
        task_contexts = [
            (task, runtime_state.task_sessions.get(task))
            for task, task_connection_id in list(runtime_state.task_connections.items())
            if task_connection_id == connection_id
        ]
        runtime_state.connection_workspaces.pop(connection_id, None)
        runtime_state.authenticated_connections.discard(connection_id)

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


def _runtime_policy_value(runtime_policy: Dict[str, Any], key: str, default: int) -> int:
    value = runtime_policy.get(key)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


async def _release_reserved_session(session_id: str) -> None:
    async with state_lock:
        if runtime_state.active_session_tasks.get(session_id) is SESSION_TASK_RESERVED:
            runtime_state.active_session_tasks.pop(session_id, None)


async def _run_title_task_with_cleanup(
    session: Session,
    llm: BaseLLM,
    first_message: str,
    send_callback: SendCallback,
) -> None:
    try:
        await run_session_title_task(session, llm, first_message, send_callback)
    finally:
        await _close_llm_instance(llm)


async def _run_background_compaction_task(agent: Agent, session: Session, trigger_run_id: str) -> None:
    try:
        await agent.run_background_compaction(session, trigger_run_id)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Background compaction task failed for %s: %s", session.session_id, exc)


async def _schedule_background_compaction_task(
    agent: Agent,
    session: Session,
    trigger_run_id: str,
) -> None:
    connection_id = user_manager.session_connections.get(session.session_id)

    async with state_lock:
        existing_task = runtime_state.active_session_compaction_tasks.get(session.session_id)
        if existing_task is not None and not existing_task.done():
            return

        task = asyncio.create_task(_run_background_compaction_task(agent, session, trigger_run_id))
        runtime_state.pending_tasks.add(task)
        runtime_state.active_session_compaction_tasks[session.session_id] = task
        runtime_state.task_sessions[task] = session.session_id
        if connection_id:
            runtime_state.task_connections[task] = connection_id
        task.add_done_callback(_forget_task)


async def get_or_create_agent(
    session_id: str,
    profile_config: Dict[str, Any],
    runtime_policy: Optional[Dict[str, Any]] = None,
) -> Optional[Agent]:
    async with state_lock:
        if not runtime_state.current_config:
            return None

        if session_id not in runtime_state.active_agents:
            effective_runtime_policy = runtime_policy if isinstance(runtime_policy, dict) else {}
            agent = Agent(
                llm=create_llm_for_profile(profile_config, effective_runtime_policy),
                tool_registry=tool_registry,
                user_manager=user_manager,
                skill_provider=runtime_state.current_context_bundle.skill_provider,
                custom_system_prompt=str(runtime_state.current_config.get("system_prompt") or ""),
                compaction_llm_factory=(
                    lambda current_config=dict(runtime_state.current_config), runtime_policy=dict(effective_runtime_policy): (
                        create_llm_for_profile(
                            resolve_compaction_profile(current_config),
                            runtime_policy,
                        )
                    )
                ),
                max_tool_rounds=_runtime_policy_value(
                    effective_runtime_policy,
                    "max_tool_rounds",
                    DEFAULT_RUNTIME_POLICY["max_tool_rounds"],
                ),
                max_retries=_runtime_policy_value(effective_runtime_policy, "max_retries", 3),
            )
            agent.background_compaction_scheduler = (
                lambda session, run_id, current_agent=agent: _schedule_background_compaction_task(
                    current_agent,
                    session,
                    run_id,
                )
            )
            runtime_state.active_agents[session_id] = agent

        return runtime_state.active_agents.get(session_id)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    if not _origin_allowed(origin):
        logger.warning("Rejected WebSocket connection with invalid origin: %s", origin)
        await websocket.close(code=1008)
        return

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

                async with state_lock:
                    is_authenticated = connection_id in runtime_state.authenticated_connections

                message_type = data.get("type")
                if not is_authenticated:
                    if message_type != "config":
                        await websocket.send_json({
                            "type": "error",
                            "error": "Connection not authenticated. Send config with auth_token first.",
                        })
                        continue
                    provided_token = str(data.get("auth_token") or "")
                    if provided_token != runtime_state.auth_token:
                        await websocket.send_json({
                            "type": "error",
                            "error": "Invalid auth_token in config handshake.",
                        })
                        continue
                    async with state_lock:
                        runtime_state.authenticated_connections.add(connection_id)

                if message_type == "message":
                    async with state_lock:
                        has_bound_workspace = connection_id in runtime_state.connection_workspaces
                    if not has_bound_workspace:
                        await websocket.send_json({
                            "type": "error",
                            "error": "Workspace not set. Send set_workspace before message.",
                        })
                        continue
                    # Never trust per-message workspace overrides over connection binding.
                    data["workspace_path"] = None

                await handle_message(websocket, data, send_callback, connection_id)
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.exception(f"Error processing message: {e}")
                try:
                    await websocket.send_json(
                        _error_payload("Failed to process message. Check backend logs.")
                    )
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
        await handle_tool_confirm(data, connection_id)
    elif message_type == "question_response":
        await handle_question_response(data)
    elif message_type == "interrupt":
        await handle_interrupt(data)
    elif message_type == "set_execution_mode":
        await handle_set_execution_mode(data, send_callback)
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
        await _close_runtime_llms()

        new_llm = create_llm(config)
        context_bundle = context_provider_registry.build_bundle(config)

        async with state_lock:
            runtime_state.current_config = config
            runtime_state.current_llm = new_llm
            runtime_state.current_context_bundle = context_bundle
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
        await send_callback(
            _error_payload("Failed to configure LLM. Check your settings and backend logs.")
        )


async def handle_user_message(
    data: Dict[str, Any],
    send_callback: SendCallback,
    connection_id: str,
) -> None:
    session_id = data.get("session_id")
    content = data.get("content")
    attachments = data.get("attachments")
    workspace_path = data.get("workspace_path")
    normalized_content = content if isinstance(content, str) else ""

    if not session_id:
        await send_callback({
            "type": "error",
            "error": "Missing session_id"
        })
        return

    if not normalized_content and not attachments:
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": "Missing content"
        })
        return

    async with state_lock:
        current_config = runtime_state.current_config
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
            session_reserved = current_config is not None
            if session_reserved:
                runtime_state.active_session_tasks[session_id] = SESSION_TASK_RESERVED

    if duplicate_run:
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": f"Session {session_id} already has an active run"
        })
        return

    if not current_config:
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

        runtime_policy = current_config.get("runtime") if isinstance(current_config.get("runtime"), dict) else {}

        if current_config:
            active_profile = resolve_conversation_profile(current_config)
            active_lock_ref = lock_ref_from_profile(active_profile) if active_profile else None

            if session.locked_model and (not active_profile or not session_lock_matches_profile(session.locked_model, active_profile)):
                await _release_reserved_session(session_id)
                await send_callback({
                    "type": "error",
                    "session_id": session_id,
                    "error": (
                        f"Session {session_id} is locked to "
                        f"{session.locked_model.provider}/{session.locked_model.model}"
                    ),
                })
                return

            if session.locked_model is None and active_lock_ref is not None:
                session.locked_model = active_lock_ref
                await session.save_metadata_async()
                await send_callback({
                    "type": "session_lock_updated",
                    "session_id": session_id,
                    "locked_model": active_lock_ref.model_dump(mode="json"),
                })

        await user_manager.bind_session_to_connection(session_id, connection_id)

        if not active_profile:
            await _release_reserved_session(session_id)
            await send_callback({
                "type": "error",
                "session_id": session_id,
                "error": "Failed to resolve active model profile for this session.",
            })
            return

        has_image_attachments = isinstance(attachments, list) and any(
            isinstance(attachment, dict) and attachment.get("kind") == "image"
            for attachment in attachments
        )
        if has_image_attachments:
            supported_input_types = get_supported_input_types(
                str(active_profile.get("provider") or ""),
                str(active_profile.get("model") or ""),
            )
            if "image" not in supported_input_types:
                await _release_reserved_session(session_id)
                await send_callback({
                    "type": "error",
                    "session_id": session_id,
                    "error": (
                        f"Model {active_profile.get('provider')}/{active_profile.get('model')} "
                        "does not support image input."
                    ),
                })
                return

        agent = await get_or_create_agent(session_id, active_profile, runtime_policy)
        if not agent:
            await _release_reserved_session(session_id)
            await send_callback({
                "type": "error",
                "session_id": session_id,
                "error": "Failed to create agent"
            })
            return

        agent.reset_interrupt()

        if isinstance(attachments, list) and attachments:
            task = asyncio.create_task(
                run_agent_task(agent, normalized_content, session, send_callback, attachments=attachments)
            )
        else:
            task = asyncio.create_task(run_agent_task(agent, normalized_content, session, send_callback))

        should_generate_title = (
            bool(normalized_content.strip())
            and not session.title
        )
        title_task = None
        if should_generate_title:
            title_profile = resolve_background_profile(current_config)
            title_llm = create_llm_for_profile(title_profile, runtime_policy)
            if callable(getattr(title_llm, "complete", None)):
                title_task = asyncio.create_task(
                    _run_title_task_with_cleanup(session, title_llm, normalized_content, send_callback)
                )

        async with state_lock:
            runtime_state.pending_tasks.add(task)
            runtime_state.active_session_tasks[session_id] = task
            runtime_state.task_connections[task] = connection_id
            runtime_state.task_sessions[task] = session_id
            if title_task is not None:
                runtime_state.pending_tasks.add(title_task)
                runtime_state.task_connections[title_task] = connection_id
                runtime_state.task_sessions[title_task] = session_id
        task.add_done_callback(_forget_task)
        if title_task is not None:
            title_task.add_done_callback(_forget_task)

    except Exception as e:
        if session_reserved:
            await _release_reserved_session(session_id)
        logger.exception(f"Failed to handle user message: {e}")
        await send_callback(
            _error_payload(
                "Failed to start the agent run. Check backend logs.",
                session_id=session_id,
            )
        )


async def run_agent_task(
    agent: Agent,
    content: str,
    session: Session,
    send_callback: SendCallback,
    attachments: Optional[Any] = None,
) -> None:
    try:
        normalized_attachments = attachments if isinstance(attachments, list) else None
        await agent.run(content, session, attachments=normalized_attachments)
    except asyncio.CancelledError:
        logger.info("Agent task cancelled for session: %s", session.session_id)
        raise
    except Exception as e:
        logger.exception(f"Agent run failed: {e}")
        await send_callback(
            _error_payload(
                "Agent run failed. Check backend logs.",
                session_id=session.session_id,
            )
        )


async def handle_tool_confirm(data: Dict[str, Any], connection_id: str) -> None:
    session_id = _normalize_non_empty_string(data.get("session_id"))
    tool_call_id = _normalize_non_empty_string(data.get("tool_call_id"))
    approved = _normalize_optional_bool(data.get("approved"))
    decision = _normalize_tool_decision(data.get("decision"))
    scope = _normalize_tool_scope(data.get("scope"))

    if not session_id:
        logger.warning("Tool confirm received without session_id")
        return

    if not tool_call_id:
        logger.warning("Tool confirm received without tool_call_id")
        return

    await user_manager.handle_tool_confirmation(
        tool_call_id=tool_call_id,
        approved=approved,
        decision=decision,
        scope=scope,
        session_id=session_id,
        connection_id=connection_id,
    )

    logger.info(
        "Tool confirmation processed: session=%s tool_call=%s -> decision=%s approved=%s scope=%s",
        session_id,
        tool_call_id,
        decision,
        approved,
        scope,
    )


async def handle_question_response(data: Dict[str, Any]) -> None:
    tool_call_id = data.get("tool_call_id")
    answer = data.get("answer")
    action = data.get("action", "submit")

    if not tool_call_id:
        logger.warning("Question response received without tool_call_id")
        return

    if action not in ("submit", "dismiss"):
        action = "submit"

    if answer is not None and not isinstance(answer, str):
        answer = str(answer)

    await user_manager.handle_question_response(
        tool_call_id=tool_call_id,
        answer=answer,
        action=action,
    )

    logger.info(
        "Question response processed: %s -> action=%s answer=%s",
        tool_call_id,
        action,
        answer,
    )


async def handle_interrupt(data: Dict[str, Any]) -> None:
    session_id = data.get("session_id")

    if not session_id:
        logger.warning("Interrupt received without session_id")
        return

    async with state_lock:
        agent = runtime_state.active_agents.get(session_id)
        compaction_task = runtime_state.active_session_compaction_tasks.get(session_id)

    if agent:
        agent.interrupt()

    if compaction_task is not None and not compaction_task.done():
        compaction_task.cancel()
        await asyncio.gather(compaction_task, return_exceptions=True)

    if agent or compaction_task is not None:
        await user_manager.cancel_pending_for_session(session_id, reason="interrupted")
        logger.info(f"Agent interrupted for session: {session_id}")


async def handle_set_execution_mode(data: Dict[str, Any], send_callback: SendCallback) -> None:
    session_id = _normalize_non_empty_string(data.get("session_id"))
    mode = _normalize_execution_mode(data.get("execution_mode"))

    if not session_id:
        await send_callback({
            "type": "error",
            "error": "Missing or invalid session_id",
        })
        return

    if mode is None:
        await send_callback({
            "type": "error",
            "session_id": session_id,
            "error": f"Invalid execution_mode: {data.get('execution_mode')}",
        })
        return

    effective_mode = user_manager.set_session_execution_mode(session_id, mode)

    await send_callback({
        "type": "execution_mode_updated",
        "session_id": session_id,
        "execution_mode": effective_mode,
    })

    logger.info(
        "Execution mode updated: session=%s mode=%s",
        session_id,
        effective_mode,
    )


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


@app.get("/auth-token")
async def auth_token():
    async with state_lock:
        if runtime_state.auth_token_host_managed:
            return JSONResponse(status_code=404, content={"error": "Not found"})
        token = runtime_state.auth_token
    return {"auth_token": token}


@app.post("/test-config")
async def test_config(request: Request, data: Dict[str, Any]):
    auth_error = await _require_http_auth(request)
    if auth_error is not None:
        return auth_error

    raw_provider = str(data.get("provider") or "").strip().lower()
    if not raw_provider:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing provider"})

    if raw_provider not in ("openai", "deepseek", "kimi", "glm", "minimax", "qwen", "ollama"):
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

                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "error": f"Ollama probe failed with HTTP {response.status_code}"
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
                if provider == "kimi" and str(model).strip().lower().startswith("kimi-k2.5"):
                    chat_payload["temperature"] = 1.0 if config.get("enable_reasoning") else 0.6
                chat_response = await client.post(chat_url, headers=chat_headers, json=chat_payload)
                if chat_response.is_success:
                    return {"ok": True}

                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "error": (
                            f"Models probe failed ({response.status_code}) and chat-completions probe "
                            f"failed ({chat_response.status_code})"
                        ),
                    },
                )

            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "error": f"Models probe failed with HTTP {response.status_code}"
                },
            )
    except Exception as e:
        logger.exception("Test config probe failed: %s", e)
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Connection test failed before the provider returned a response"},
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
