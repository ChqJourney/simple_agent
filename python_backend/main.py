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
from llms.deepseek import DeepSeekLLM
from llms.glm import GLMLLM
from llms.kimi import KimiLLM
from llms.minimax import MiniMaxLLM
from llms.openai import OpenAILLM
from llms.qwen import QwenLLM
from ocr.manager import OcrSidecarManager
from runtime.config import (
    DEFAULT_BASE_URLS,
    DEFAULT_RUNTIME_POLICY,
    get_disabled_tool_names,
    get_primary_profile_config,
    is_ocr_enabled,
    normalize_runtime_config,
)
from runtime.delegation import DelegatedTaskRunner
from runtime.provider_registry import ContextProviderBundle, ContextProviderRegistry
from runtime.router import (
    build_execution_spec,
    lock_ref_from_profile,
    session_lock_matches_profile,
)
from runtime.scenarios import get_scenario_spec
from runtime.session_titles import run_session_title_task
from skills.local_loader import default_skill_search_roots
from tools.base import BaseTool, ToolRegistry
from tools.ask_question import AskQuestionTool
from tools.delegate_task import DelegateTaskTool
from tools.extract_checklist_rows import ExtractChecklistRowsTool
from tools.file_read import FileReadTool
from tools.file_write import FileWriteTool
from tools.get_document_structure import GetDocumentStructureTool
from tools.list_directory_tree import ListDirectoryTreeTool
from tools.node_execute import NodeExecuteTool
from tools.ocr_extract import OcrExtractTool
from tools.pdf_tools import (
    PdfGetInfoTool,
    PdfGetOutlineTool,
    PdfReadLinesTool,
    PdfReadPagesTool,
    PdfSearchTool,
)
from tools.python_execute import PythonExecuteTool
from tools.read_document_segment import ReadDocumentSegmentTool
from tools.reference_library import ReadReferenceSegmentTool, SearchReferenceLibraryTool
from tools.search_documents import SearchDocumentsTool
from tools.skill_loader import SkillLoaderTool
from tools.shell_execute import ShellExecuteTool
from tools.todo_task import TodoTaskTool
from tools.web_fetch import WebFetchTool

SendCallback = Callable[[Dict[str, Any]], Any]

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)
INTERRUPT_TASK_CANCEL_GRACE_SECONDS = 0.5

ALLOWED_BROWSER_ORIGINS = {
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://tauri.localhost",
    "tauri://localhost",
    "https://tauri.localhost",
}
AUTH_TOKEN_ENV_VAR = "TAURI_AGENT_AUTH_TOKEN"
HTTP_AUTH_HEADER = "x-tauri-agent-auth"
ocr_manager = OcrSidecarManager()


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
    await ocr_manager.stop()


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
tool_registry.register(
    ExtractChecklistRowsTool(config_getter=lambda: runtime_state.current_config)
)
tool_registry.register(
    SearchReferenceLibraryTool(config_getter=lambda: runtime_state.current_config)
)
tool_registry.register(
    ReadReferenceSegmentTool(config_getter=lambda: runtime_state.current_config)
)
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
tool_registry.register(OcrExtractTool(manager=ocr_manager))
tool_registry.register(TodoTaskTool())
tool_registry.register(AskQuestionTool())
tool_registry.register(WebFetchTool())
tool_registry.register(
    DelegateTaskTool(
        DelegatedTaskRunner(
            config_getter=lambda: runtime_state.current_config,
            llm_factory=lambda execution_spec: create_llm_for_execution_spec(
                execution_spec
            ),
        )
    )
)
skill_search_roots = default_skill_search_roots()
tool_registry.register(
    SkillLoaderTool(
        skill_provider_getter=lambda: (
            runtime_state.current_context_bundle.skill_provider
        ),
    )
)

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
    current_context_bundle: ContextProviderBundle = field(
        default_factory=ContextProviderBundle
    )
    default_workspace: str = field(default_factory=lambda: str(Path.cwd()))
    connection_workspaces: Dict[str, str] = field(default_factory=dict)
    pending_tasks: Set[asyncio.Task] = field(default_factory=set)
    active_session_tasks: Dict[str, object] = field(default_factory=dict)
    active_session_compaction_tasks: Dict[str, asyncio.Task] = field(
        default_factory=dict
    )
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
SCENARIO_IDS: Set[str] = {"default", "standard_qa", "checklist_evaluation"}
SUPPORTED_PROVIDERS: Set[str] = {"openai", "deepseek", "kimi", "glm", "minimax", "qwen"}


def _build_ocr_status_payload(config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    enabled = is_ocr_enabled(config)
    installation = ocr_manager.inspect_installation()
    installed = bool(installation.get("installed"))

    return {
        "enabled": enabled,
        "installed": installed,
        "status": "available" if enabled and installed else "unavailable",
        "version": installation.get("version"),
        "engine": installation.get("engine"),
        "api_version": installation.get("api_version"),
        "root_dir": installation.get("root_dir"),
    }


def _is_ocr_tool_installed() -> bool:
    installation = ocr_manager.inspect_installation()
    return bool(installation.get("installed"))


def _is_tool_enabled_for_config(
    tool_name: str, config: Optional[Dict[str, Any]]
) -> bool:
    normalized_tool_name = str(tool_name).strip().lower()
    if normalized_tool_name in get_disabled_tool_names(config):
        return False

    if tool_name == "ocr_extract":
        return _is_ocr_tool_installed() and is_ocr_enabled(config)
    return True


def _build_tool_catalog_payload() -> List[Dict[str, str]]:
    descriptors = tool_registry.get_descriptors()
    return [
        {
            "name": descriptor.name,
            "description": descriptor.description,
        }
        for descriptor in sorted(descriptors, key=lambda descriptor: descriptor.name)
        if descriptor.name != "ocr_extract" or _is_ocr_tool_installed()
    ]


def _apply_runtime_tool_policies(config: Dict[str, Any]) -> None:
    delegate_tool = tool_registry.get_tool("delegate_task")
    if delegate_tool is None:
        return

    delegated_runtime = build_execution_spec(config, "delegated_task").get("runtime")
    if not isinstance(delegated_runtime, dict):
        return

    timeout_seconds = delegated_runtime.get("timeout_seconds")
    if isinstance(timeout_seconds, int) and timeout_seconds > 0:
        delegate_tool.policy.timeout_seconds = timeout_seconds


def _normalize_non_empty_string(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_optional_bool(value: Any) -> Optional[bool]:
    return value if isinstance(value, bool) else None


def _normalize_tool_decision(
    value: Any,
) -> Optional[Literal["approve_once", "approve_always", "reject"]]:
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


def _normalize_scenario_id(value: Any) -> str:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in SCENARIO_IDS:
            return normalized
    return "default"


def _normalize_scenario_version(value: Any) -> int:
    if isinstance(value, int) and value > 0:
        return value
    return 1


def _scenario_cache_key(scenario_spec: Dict[str, Any]) -> tuple[Any, ...]:
    allowlist = scenario_spec.get("tool_allowlist")
    denylist = scenario_spec.get("tool_denylist")
    return (
        str(scenario_spec.get("scenario_id") or "default").strip().lower(),
        str(scenario_spec.get("loop_strategy") or "").strip().lower(),
        str(scenario_spec.get("system_prompt_addendum") or "").strip(),
        tuple(allowlist) if isinstance(allowlist, list) else None,
        tuple(denylist) if isinstance(denylist, list) else None,
    )


def _normalize_provider_config(data: Dict[str, Any]) -> Dict[str, Any]:
    return normalize_runtime_config(data)


def _normalize_provider_probe_config(data: Dict[str, Any]) -> Dict[str, str]:
    provider = str(data.get("provider") or "").strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(f"Unsupported provider: {provider}")

    api_key = str(data.get("api_key") or "").strip()
    base_url = str(data.get("base_url") or "").strip() or DEFAULT_BASE_URLS.get(
        provider, ""
    )

    return {
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
    }


def _build_provider_auth_headers(api_key: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def _supports_live_model_catalog(base_url: str, status_code: Optional[int] = None) -> bool:
    normalized_base_url = str(base_url or "").strip().lower()
    if "dashscope.aliyuncs.com" in normalized_base_url:
        return False

    if status_code in (404, 405, 501):
        return False

    return True


def _extract_provider_model_supports_image(item: Dict[str, Any]) -> Optional[bool]:
    supports_image_in = item.get("supports_image_in")
    if isinstance(supports_image_in, bool):
        return supports_image_in

    for key in ("input_types", "input_modalities", "modalities", "supported_inputs"):
        raw_value = item.get(key)
        if not isinstance(raw_value, list):
            continue

        normalized = {
            str(entry).strip().lower()
            for entry in raw_value
            if str(entry).strip()
        }
        if normalized:
            return "image" in normalized

    return None


def _extract_provider_model_context_length(item: Dict[str, Any]) -> Optional[int]:
    for key in ("context_length", "context_window", "max_context_length", "input_token_limit"):
        value = item.get(key)
        if isinstance(value, int) and value > 0:
            return value
    return None


def _extract_provider_models(payload: Any) -> List[Dict[str, Any]]:
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    models_by_id: Dict[str, Dict[str, Any]] = {}
    for item in data:
        if not isinstance(item, dict):
            continue

        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue

        entry: Dict[str, Any] = {"id": model_id}
        supports_image_in = _extract_provider_model_supports_image(item)
        context_length = _extract_provider_model_context_length(item)

        if supports_image_in is not None:
            entry["supports_image_in"] = supports_image_in
        if context_length is not None:
            entry["context_length"] = context_length

        models_by_id[model_id] = entry

    return [models_by_id[key] for key in sorted(models_by_id)]


async def _fetch_provider_models(api_key: str, base_url: str) -> List[Dict[str, Any]]:
    headers = _build_provider_auth_headers(api_key)
    models_url = f"{base_url.rstrip('/')}/models"

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(models_url, headers=headers)

    response.raise_for_status()
    payload = response.json()
    return _extract_provider_models(payload)


def create_llm_for_profile(
    profile: Dict[str, Any], runtime_policy: Optional[Dict[str, Any]] = None
) -> BaseLLM:
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
    raise ValueError(f"Unknown provider: {provider}")


def create_llm_for_execution_spec(execution_spec: Dict[str, Any]) -> BaseLLM:
    profile = (
        execution_spec.get("profile")
        if isinstance(execution_spec.get("profile"), dict)
        else {}
    )
    runtime_policy = (
        execution_spec.get("runtime")
        if isinstance(execution_spec.get("runtime"), dict)
        else {}
    )
    role = str(execution_spec.get("role") or "unknown")
    guardrails = (
        execution_spec.get("guardrails")
        if isinstance(execution_spec.get("guardrails"), dict)
        else {}
    )
    warnings = (
        guardrails.get("warnings")
        if isinstance(guardrails.get("warnings"), list)
        else []
    )

    for warning in warnings:
        logger.warning(
            "Applied runtime guardrail for role=%s model=%s/%s: %s",
            role,
            profile.get("provider"),
            profile.get("model"),
            warning,
        )

    return create_llm_for_profile(profile, runtime_policy)


def create_llm(config: Dict[str, Any]) -> BaseLLM:
    normalized_config = _normalize_provider_config(config)
    execution_spec = build_execution_spec(normalized_config, "conversation")
    return create_llm_for_execution_spec(execution_spec)


def _forget_task(task: asyncio.Task) -> None:
    runtime_state.pending_tasks.discard(task)
    connection_id = runtime_state.task_connections.pop(task, None)
    session_id = runtime_state.task_sessions.pop(task, None)

    if connection_id:
        logger.debug("Task released for connection %s", connection_id)

    if (
        session_id
        and runtime_state.active_session_compaction_tasks.get(session_id) is task
    ):
        runtime_state.active_session_compaction_tasks.pop(session_id, None)

    if session_id and runtime_state.active_session_tasks.get(session_id) is task:
        runtime_state.active_session_tasks.pop(session_id, None)
        agent = runtime_state.active_agents.pop(session_id, None)
        llm = getattr(agent, "llm", None) if agent is not None else None
        if llm is not None:
            try:
                asyncio.get_running_loop().create_task(_close_llm_instance(llm))
            except RuntimeError:
                logger.debug(
                    "No running loop available to close agent llm for session %s",
                    session_id,
                )


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
        await asyncio.gather(
            *(task for task, _ in task_contexts), return_exceptions=True
        )


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
        await asyncio.gather(
            *(task for task, _ in task_contexts), return_exceptions=True
        )


def _runtime_policy_value(
    runtime_policy: Dict[str, Any], key: str, default: int
) -> int:
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


async def _run_background_compaction_task(
    agent: Agent, session: Session, trigger_run_id: str
) -> None:
    try:
        await agent.run_background_compaction(session, trigger_run_id)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning(
            "Background compaction task failed for %s: %s", session.session_id, exc
        )


async def _schedule_background_compaction_task(
    agent: Agent,
    session: Session,
    trigger_run_id: str,
) -> None:
    connection_id = user_manager.session_connections.get(session.session_id)

    async with state_lock:
        existing_task = runtime_state.active_session_compaction_tasks.get(
            session.session_id
        )
        if existing_task is not None and not existing_task.done():
            return

        task = asyncio.create_task(
            _run_background_compaction_task(agent, session, trigger_run_id)
        )
        runtime_state.pending_tasks.add(task)
        runtime_state.active_session_compaction_tasks[session.session_id] = task
        runtime_state.task_sessions[task] = session.session_id
        if connection_id:
            runtime_state.task_connections[task] = connection_id
        task.add_done_callback(_forget_task)


async def get_or_create_agent(
    session_id: str,
    execution_spec: Dict[str, Any],
    scenario_spec: Dict[str, Any],
) -> Optional[Agent]:
    scenario_key = _scenario_cache_key(scenario_spec)
    stale_llm: Optional[BaseLLM] = None

    async with state_lock:
        if not runtime_state.current_config:
            return None

        cached_agent = runtime_state.active_agents.get(session_id)
        cached_scenario_key = (
            getattr(cached_agent, "_scenario_cache_key", None)
            if cached_agent is not None
            else None
        )
        if cached_agent is not None and cached_scenario_key != scenario_key:
            runtime_state.active_agents.pop(session_id, None)
            stale_llm = getattr(cached_agent, "llm", None)

        if session_id not in runtime_state.active_agents:
            effective_runtime_policy = (
                execution_spec.get("runtime")
                if isinstance(execution_spec.get("runtime"), dict)
                else {}
            )
            scenario_allowlist = (
                scenario_spec.get("tool_allowlist")
                if isinstance(scenario_spec.get("tool_allowlist"), list)
                else None
            )
            scenario_denylist = (
                scenario_spec.get("tool_denylist")
                if isinstance(scenario_spec.get("tool_denylist"), list)
                else None
            )
            scenario_prompt_addendum = (
                scenario_spec.get("system_prompt_addendum")
                if isinstance(scenario_spec.get("system_prompt_addendum"), str)
                else ""
            )

            def scenario_tool_filter(tool: BaseTool) -> bool:
                if scenario_allowlist is not None and tool.name not in scenario_allowlist:
                    return False
                if scenario_denylist is not None and tool.name in scenario_denylist:
                    return False
                return True

            agent = Agent(
                llm=create_llm_for_execution_spec(execution_spec),
                tool_registry=tool_registry,
                user_manager=user_manager,
                skill_provider=runtime_state.current_context_bundle.skill_provider,
                custom_system_prompt=str(
                    runtime_state.current_config.get("system_prompt") or ""
                ),
                scenario_system_prompt=str(scenario_prompt_addendum or ""),
                tool_filter=(
                    lambda tool, current_config=dict(runtime_state.current_config): (
                        _is_tool_enabled_for_config(tool.name, current_config)
                        and scenario_tool_filter(tool)
                    )
                ),
                compaction_llm_factory=(
                    lambda current_config=dict(runtime_state.current_config): (
                        create_llm_for_execution_spec(
                            build_execution_spec(current_config, "compaction"),
                        )
                    )
                ),
                max_tool_rounds=_runtime_policy_value(
                    effective_runtime_policy,
                    "max_tool_rounds",
                    DEFAULT_RUNTIME_POLICY["max_tool_rounds"],
                ),
                max_retries=_runtime_policy_value(
                    effective_runtime_policy, "max_retries", 3
                ),
            )
            setattr(agent, "_scenario_cache_key", scenario_key)
            agent.background_compaction_scheduler = (
                lambda session, run_id, current_agent=agent: (
                    _schedule_background_compaction_task(
                        current_agent,
                        session,
                        run_id,
                    )
                )
            )
            runtime_state.active_agents[session_id] = agent

        agent = runtime_state.active_agents.get(session_id)

    if stale_llm is not None:
        await _close_llm_instance(stale_llm)

    return agent


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
                    is_authenticated = (
                        connection_id in runtime_state.authenticated_connections
                    )

                message_type = data.get("type")
                if not is_authenticated:
                    if message_type != "config":
                        await websocket.send_json(
                            {
                                "type": "error",
                                "error": "Connection not authenticated. Send config with auth_token first.",
                            }
                        )
                        continue
                    provided_token = str(data.get("auth_token") or "")
                    if provided_token != runtime_state.auth_token:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "error": "Invalid auth_token in config handshake.",
                            }
                        )
                        continue
                    async with state_lock:
                        runtime_state.authenticated_connections.add(connection_id)

                if message_type == "message":
                    async with state_lock:
                        has_bound_workspace = (
                            connection_id in runtime_state.connection_workspaces
                        )
                    if not has_bound_workspace:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "error": "Workspace not set. Send set_workspace before message.",
                            }
                        )
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
        await handle_question_response(data, connection_id)
    elif message_type == "interrupt":
        await handle_interrupt(data)
    elif message_type == "set_execution_mode":
        await handle_set_execution_mode(data, send_callback)
    elif message_type == "set_workspace":
        await handle_set_workspace(data, send_callback, connection_id)
    elif message_type == "create_session":
        await handle_create_session(data, send_callback, connection_id)
    elif message_type == "update_session_scenario":
        await handle_update_session_scenario(data, send_callback, connection_id)
    else:
        await send_callback(
            {
                "type": "error",
                "session_id": data.get("session_id"),
                "error": f"Unknown message type: {message_type}",
            }
        )


async def handle_config(data: Dict[str, Any], send_callback: SendCallback) -> None:
    try:
        config = _normalize_provider_config(data)
        provider = str(get_primary_profile_config(config).get("provider") or "").strip().lower()
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(f"Unsupported provider: {provider or 'unknown'}")
        _apply_runtime_tool_policies(config)

        await cleanup_all_tasks()
        await _close_runtime_llms()

        new_llm = create_llm(config)
        context_bundle = context_provider_registry.build_bundle(config)

        async with state_lock:
            runtime_state.current_config = config
            runtime_state.current_llm = new_llm
            runtime_state.current_context_bundle = context_bundle
            runtime_state.active_agents.clear()

        await send_callback(
            {
                "type": "config_updated",
                "provider": get_primary_profile_config(runtime_state.current_config)[
                    "provider"
                ],
                "model": get_primary_profile_config(runtime_state.current_config)[
                    "model"
                ],
                "ocr": _build_ocr_status_payload(runtime_state.current_config),
            }
        )

        logger.info(
            "Configuration updated: provider=%s, model=%s",
            get_primary_profile_config(runtime_state.current_config)["provider"],
            get_primary_profile_config(runtime_state.current_config)["model"],
        )

    except Exception as e:
        logger.exception(f"Failed to configure LLM: {e}")
        await send_callback(
            _error_payload(
                "Failed to configure LLM. Check your settings and backend logs."
            )
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
        await send_callback({"type": "error", "error": "Missing session_id"})
        return

    if not normalized_content and not attachments:
        await send_callback(
            {"type": "error", "session_id": session_id, "error": "Missing content"}
        )
        return

    async with state_lock:
        current_config = runtime_state.current_config
        workspace = (
            workspace_path
            if workspace_path
            else runtime_state.connection_workspaces.get(
                connection_id, runtime_state.default_workspace
            )
        )
        existing_task = runtime_state.active_session_tasks.get(session_id)

        if existing_task is not None and (
            existing_task is SESSION_TASK_RESERVED or not existing_task.done()
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
        await send_callback(
            {
                "type": "error",
                "session_id": session_id,
                "error": f"Session {session_id} already has an active run",
            }
        )
        return

    if not current_config:
        await send_callback(
            {
                "type": "error",
                "session_id": session_id,
                "error": "LLM not configured. Please send a config message first.",
            }
        )
        return

    try:
        session = user_manager.get_session(session_id)
        if not session:
            session = await user_manager.create_session(workspace, session_id)

        conversation_spec = build_execution_spec(current_config, "conversation")
        active_profile = conversation_spec["profile"]

        if current_config:
            active_lock_ref = (
                lock_ref_from_profile(active_profile) if active_profile else None
            )

            if session.locked_model and (
                not active_profile
                or not session_lock_matches_profile(
                    session.locked_model, active_profile
                )
            ):
                await _release_reserved_session(session_id)
                await send_callback(
                    {
                        "type": "error",
                        "session_id": session_id,
                        "error": (
                            f"Session {session_id} is locked to "
                            f"{session.locked_model.provider}/{session.locked_model.model}"
                        ),
                    }
                )
                return

            if session.locked_model is None and active_lock_ref is not None:
                session.locked_model = active_lock_ref
                await session.save_metadata_async()
                await send_callback(
                    {
                        "type": "session_lock_updated",
                        "session_id": session_id,
                        "locked_model": active_lock_ref.model_dump(mode="json"),
                    }
                )

        await user_manager.bind_session_to_connection(session_id, connection_id)

        if not active_profile:
            await _release_reserved_session(session_id)
            await send_callback(
                {
                    "type": "error",
                    "session_id": session_id,
                    "error": "Failed to resolve active model profile for this session.",
                }
            )
            return

        has_image_attachments = isinstance(attachments, list) and any(
            isinstance(attachment, dict) and attachment.get("kind") == "image"
            for attachment in attachments
        )
        if has_image_attachments:
            capability_summary = conversation_spec.get("capability_summary", {})
            supported_input_types = (
                capability_summary.get("supported_input_types")
                if isinstance(capability_summary, dict)
                else None
            )
            if not isinstance(supported_input_types, list):
                supported_input_types = []
            if "image" not in supported_input_types:
                await _release_reserved_session(session_id)
                await send_callback(
                    {
                        "type": "error",
                        "session_id": session_id,
                        "error": (
                            f"Model {active_profile.get('provider')}/{active_profile.get('model')} "
                            "does not support image input."
                        ),
                    }
                )
                return

        scenario_spec = get_scenario_spec(getattr(session, "scenario_id", None))
        agent = await get_or_create_agent(session_id, conversation_spec, scenario_spec)
        if not agent:
            await _release_reserved_session(session_id)
            await send_callback(
                {
                    "type": "error",
                    "session_id": session_id,
                    "error": "Failed to create agent",
                }
            )
            return

        agent.reset_interrupt()

        if isinstance(attachments, list) and attachments:
            task = asyncio.create_task(
                run_agent_task(
                    agent,
                    normalized_content,
                    session,
                    send_callback,
                    attachments=attachments,
                )
            )
        else:
            task = asyncio.create_task(
                run_agent_task(agent, normalized_content, session, send_callback)
            )

        should_generate_title = bool(normalized_content.strip()) and not session.title
        title_task = None
        if should_generate_title:
            background_spec = build_execution_spec(current_config, "background")
            title_llm = create_llm_for_execution_spec(background_spec)
            if callable(getattr(title_llm, "complete", None)):
                title_task = asyncio.create_task(
                    _run_title_task_with_cleanup(
                        session, title_llm, normalized_content, send_callback
                    )
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


async def handle_question_response(data: Dict[str, Any], connection_id: str) -> None:
    session_id = data.get("session_id")
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
        session_id=session_id,
        connection_id=connection_id,
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
        active_task = runtime_state.active_session_tasks.get(session_id)
        compaction_task = runtime_state.active_session_compaction_tasks.get(session_id)

    if agent:
        agent.interrupt()

    if agent or compaction_task is not None or isinstance(active_task, asyncio.Task):
        await user_manager.cancel_pending_for_session(session_id, reason="interrupted")

    if isinstance(active_task, asyncio.Task) and not active_task.done():
        active_task.cancel()
        try:
            await asyncio.wait_for(
                asyncio.gather(active_task, return_exceptions=True),
                timeout=INTERRUPT_TASK_CANCEL_GRACE_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Timed out waiting %.2fs for session %s run task to cancel cleanly",
                INTERRUPT_TASK_CANCEL_GRACE_SECONDS,
                session_id,
            )

    if compaction_task is not None and not compaction_task.done():
        compaction_task.cancel()
        await asyncio.gather(compaction_task, return_exceptions=True)

    if agent or compaction_task is not None or isinstance(active_task, asyncio.Task):
        logger.info(f"Agent interrupted for session: {session_id}")


async def handle_set_execution_mode(
    data: Dict[str, Any], send_callback: SendCallback
) -> None:
    session_id = _normalize_non_empty_string(data.get("session_id"))
    mode = _normalize_execution_mode(data.get("execution_mode"))

    if not session_id:
        await send_callback(
            {
                "type": "error",
                "error": "Missing or invalid session_id",
            }
        )
        return

    if mode is None:
        await send_callback(
            {
                "type": "error",
                "session_id": session_id,
                "error": f"Invalid execution_mode: {data.get('execution_mode')}",
            }
        )
        return

    effective_mode = user_manager.set_session_execution_mode(session_id, mode)

    await send_callback(
        {
            "type": "execution_mode_updated",
            "session_id": session_id,
            "execution_mode": effective_mode,
        }
    )

    logger.info(
        "Execution mode updated: session=%s mode=%s",
        session_id,
        effective_mode,
    )


async def handle_create_session(
    data: Dict[str, Any],
    send_callback: SendCallback,
    connection_id: str,
) -> None:
    session_id = _normalize_non_empty_string(data.get("session_id"))
    workspace_path = _normalize_non_empty_string(data.get("workspace_path"))
    scenario_id = _normalize_scenario_id(data.get("scenario_id"))
    scenario_version = _normalize_scenario_version(data.get("scenario_version"))
    scenario_label = _normalize_non_empty_string(data.get("scenario_label"))

    if not session_id:
        await send_callback({"type": "error", "error": "Missing or invalid session_id"})
        return

    if not workspace_path:
        await send_callback(
            {"type": "error", "session_id": session_id, "error": "Missing workspace_path"}
        )
        return

    session = user_manager.get_session(session_id)
    if not session:
        session = await user_manager.create_session(workspace_path, session_id)

    session.scenario_id = scenario_id
    session.scenario_version = scenario_version
    session.scenario_label = scenario_label
    await session.save_metadata_async()
    await user_manager.bind_session_to_connection(session_id, connection_id)

    await send_callback(
        {
            "type": "session_created",
            "session_id": session_id,
            "workspace_path": workspace_path,
            "scenario_id": scenario_id,
            "scenario_version": scenario_version,
            "scenario_label": scenario_label,
        }
    )


async def handle_update_session_scenario(
    data: Dict[str, Any],
    send_callback: SendCallback,
    connection_id: str,
) -> None:
    session_id = _normalize_non_empty_string(data.get("session_id"))
    workspace_path = _normalize_non_empty_string(data.get("workspace_path"))
    scenario_id = _normalize_scenario_id(data.get("scenario_id"))
    scenario_version = _normalize_scenario_version(data.get("scenario_version"))
    scenario_label = _normalize_non_empty_string(data.get("scenario_label"))

    if not session_id:
        await send_callback({"type": "error", "error": "Missing or invalid session_id"})
        return

    session = user_manager.get_session(session_id)
    if not session:
        if not workspace_path:
            await send_callback(
                {
                    "type": "error",
                    "session_id": session_id,
                    "error": "Missing workspace_path",
                }
            )
            return
        session = await user_manager.create_session(workspace_path, session_id)

    session.scenario_id = scenario_id
    session.scenario_version = scenario_version
    session.scenario_label = scenario_label
    await session.save_metadata_async()
    await user_manager.bind_session_to_connection(session_id, connection_id)

    await send_callback(
        {
            "type": "session_scenario_updated",
            "session_id": session_id,
            "scenario_id": scenario_id,
            "scenario_version": scenario_version,
            "scenario_label": scenario_label,
        }
    )


async def handle_set_workspace(
    data: Dict[str, Any],
    send_callback: SendCallback,
    connection_id: Optional[str] = None,
) -> None:
    workspace_path = data.get("workspace_path")

    if not workspace_path:
        await send_callback({"type": "error", "error": "Missing workspace_path"})
        return

    workspace = Path(workspace_path)
    if not workspace.exists():
        await send_callback(
            {
                "type": "error",
                "error": f"Workspace path does not exist: {workspace_path}",
            }
        )
        return

    if not workspace.is_dir():
        await send_callback(
            {
                "type": "error",
                "error": f"Workspace path is not a directory: {workspace_path}",
            }
        )
        return

    resolved_workspace = str(workspace.resolve())

    async with state_lock:
        if connection_id:
            runtime_state.connection_workspaces[connection_id] = resolved_workspace

    await send_callback(
        {"type": "workspace_updated", "workspace_path": resolved_workspace}
    )

    logger.info(f"Workspace updated: {resolved_workspace}")


@app.get("/")
async def root():
    async with state_lock:
        config = runtime_state.current_config
    return {
        "message": "AI Agent Backend",
        "status": "running",
        "provider": config.get("provider") if config else None,
        "model": config.get("model") if config else None,
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


@app.get("/tools")
async def list_tools(request: Request):
    auth_error = await _require_http_auth(request)
    if auth_error is not None:
        return auth_error

    return {"tools": _build_tool_catalog_payload()}


@app.post("/provider-models")
async def list_provider_models(request: Request, data: Dict[str, Any]):
    auth_error = await _require_http_auth(request)
    if auth_error is not None:
        return auth_error

    try:
        config = _normalize_provider_probe_config(data)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})

    if not config["api_key"]:
        return JSONResponse(
            status_code=400, content={"ok": False, "error": "Missing api_key"}
        )

    if not config["base_url"]:
        return JSONResponse(
            status_code=400, content={"ok": False, "error": "Missing base_url"}
        )

    try:
        models = await _fetch_provider_models(config["api_key"], config["base_url"])
        return {"ok": True, "models": models}
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Provider model listing failed for %s with HTTP %s",
            config["provider"],
            exc.response.status_code,
        )
        if not _supports_live_model_catalog(
            config["base_url"], exc.response.status_code
        ):
            return {
                "ok": False,
                "models": [],
                "error": (
                    "Live model catalog is not available for this provider/base URL."
                ),
            }

        return {
            "ok": False,
            "models": [],
            "error": f"Models probe failed with HTTP {exc.response.status_code}",
        }
    except httpx.TimeoutException:
        logger.warning("Provider model listing timed out for %s", config["provider"])
        return {
            "ok": False,
            "models": [],
            "error": "Timed out while loading the live model catalog",
        }
    except Exception as exc:
        logger.exception("Provider model listing failed: %s", exc)
        return {
            "ok": False,
            "models": [],
            "error": f"Failed to load provider models: {str(exc)}",
        }


@app.post("/test-config")
async def test_config(request: Request, data: Dict[str, Any]):
    auth_error = await _require_http_auth(request)
    if auth_error is not None:
        return auth_error

    raw_provider = str(data.get("provider") or "").strip().lower()
    if not raw_provider:
        return JSONResponse(
            status_code=400, content={"ok": False, "error": "Missing provider"}
        )

    if raw_provider not in SUPPORTED_PROVIDERS:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": f"Unsupported provider: {raw_provider}"},
        )

    config = _normalize_provider_config({**data, "provider": raw_provider})
    provider = config["provider"]
    api_key = config["api_key"]
    model = config["model"]
    base_url = config["base_url"]

    if not api_key:
        return JSONResponse(
            status_code=400, content={"ok": False, "error": "Missing api_key"}
        )

    if not base_url:
        return JSONResponse(
            status_code=400, content={"ok": False, "error": "Missing base_url"}
        )

    headers = _build_provider_auth_headers(api_key)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
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
                if provider == "kimi" and str(model).strip().lower().startswith(
                    "kimi-k2.5"
                ):
                    chat_payload["temperature"] = (
                        1.0 if config.get("enable_reasoning") else 0.6
                    )
                chat_response = await client.post(
                    chat_url, headers=chat_headers, json=chat_payload
                )
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
                    "error": f"Models probe failed with HTTP {response.status_code}",
                },
            )
    except Exception as e:
        logger.exception("Test config probe failed: %s", e)
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": f"Connection test failed: {str(e)}",
            },
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
