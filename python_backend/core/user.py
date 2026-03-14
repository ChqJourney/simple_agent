import asyncio
import base64
import json
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional, Set

from pydantic import BaseModel, ConfigDict, Field
from runtime.contracts import LockedModelRef, SessionMetadata

logger = logging.getLogger(__name__)

SendCallback = Callable[[Dict[str, Any]], Awaitable[None]]
ConnectionId = str
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def validate_session_id(session_id: str) -> str:
    normalized = str(session_id or "").strip()
    if not SESSION_ID_PATTERN.fullmatch(normalized):
        raise ValueError(f"Invalid session_id: {session_id}")
    return normalized


class Message(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None
    reasoning_content: Optional[str] = None
    profile_name: Optional[str] = None
    model_label: Optional[str] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    usage: Optional[Dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Session:
    def __init__(
        self,
        session_id: str,
        workspace_path: str,
        title: Optional[str] = None,
        locked_model: Optional[LockedModelRef] = None,
    ):
        self.session_id = validate_session_id(session_id)
        self.workspace_path = workspace_path
        self.messages: List[Message] = []
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
        self.title = title
        self.locked_model = locked_model
        self.file_path = self._get_file_path()
        self.metadata_file_path = self._get_metadata_file_path()
        self._ensure_directory()
        self._load_metadata()
        self.load_history()

    def _get_file_path(self) -> Path:
        return Path(self.workspace_path) / ".agent" / "sessions" / f"{self.session_id}.jsonl"

    def _ensure_directory(self) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)

    def _get_metadata_file_path(self) -> Path:
        return Path(self.workspace_path) / ".agent" / "sessions" / f"{self.session_id}.meta.json"

    def add_message(self, message: Message) -> None:
        self.messages.append(message)
        self.updated_at = datetime.now(timezone.utc)
        self._append_to_file(message)
        self.save_metadata()

    def _append_to_file(self, message: Message) -> None:
        try:
            with self.file_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(message.model_dump(), default=str) + "\n")
        except Exception as e:
            logger.error(f"Failed to append message to file: {e}")

    def _load_metadata(self) -> None:
        if not self.metadata_file_path.exists():
            return

        try:
            with self.metadata_file_path.open("r", encoding="utf-8") as f:
                data = json.load(f)

            metadata = SessionMetadata.model_validate(data)
            self.created_at = metadata.created_at
            self.updated_at = metadata.updated_at
            self.title = metadata.title
            self.locked_model = metadata.locked_model
        except Exception as e:
            logger.warning(f"Failed to load session metadata: {e}")

    def save_metadata(self) -> None:
        try:
            with self.metadata_file_path.open("w", encoding="utf-8") as f:
                json.dump(self.to_metadata().model_dump(mode="json"), f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save session metadata: {e}")

    def set_title(self, title: str) -> None:
        self.title = title
        self.updated_at = datetime.now(timezone.utc)
        self.save_metadata()

    def load_history(self) -> None:
        if not self.file_path.exists():
            return

        try:
            with self.file_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        if "timestamp" in data and isinstance(data["timestamp"], str):
                            data["timestamp"] = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
                        message = Message(**data)
                        self.messages.append(message)
                    except json.JSONDecodeError as e:
                        logger.warning(f"Failed to parse message line: {e}")
                        continue

            if self.messages:
                timestamps = [m.timestamp for m in self.messages if m.timestamp]
                if timestamps:
                    self.created_at = min(timestamps)
                    self.updated_at = max(timestamps)
        except Exception as e:
            logger.error(f"Failed to load session history: {e}")

    def get_messages_for_llm(self) -> List[Dict[str, Any]]:
        result = []
        for msg in self.messages:
            if msg.role == "tool" and msg.name == "tool_decision":
                continue

            llm_msg: Dict[str, Any] = {"role": msg.role}
            if msg.role == "user" and msg.attachments:
                llm_msg["content"] = self._build_multimodal_content(msg.content, msg.attachments)
            elif msg.content is not None:
                llm_msg["content"] = msg.content
            if msg.tool_calls is not None:
                llm_msg["tool_calls"] = msg.tool_calls
            if msg.tool_call_id is not None:
                llm_msg["tool_call_id"] = msg.tool_call_id
            if msg.name is not None:
                llm_msg["name"] = msg.name
            if msg.reasoning_content is not None:
                llm_msg["reasoning_content"] = msg.reasoning_content
            result.append(llm_msg)
        return result

    @staticmethod
    def _build_multimodal_content(
        content: Optional[str],
        attachments: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        parts: List[Dict[str, Any]] = []

        if content:
            parts.append({"type": "text", "text": content})

        for attachment in attachments:
            if attachment.get("kind") != "image":
                continue

            image_url = Session._encode_image_attachment(attachment)
            if image_url:
                parts.append({"type": "image_url", "image_url": {"url": image_url}})

        return parts

    @staticmethod
    def _encode_image_attachment(attachment: Dict[str, Any]) -> Optional[str]:
        inline_data_url = attachment.get("data_url")
        if isinstance(inline_data_url, str) and inline_data_url.startswith("data:image/"):
            return inline_data_url

        raw_path = attachment.get("path")
        if not raw_path:
            return None

        path = Path(str(raw_path))
        if not path.exists() or not path.is_file():
            return None

        mime_type = str(attachment.get("mime_type") or "").strip()
        if not mime_type:
            guessed_mime_type, _ = mimetypes.guess_type(path.name)
            mime_type = guessed_mime_type or "image/png"

        try:
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        except OSError:
            return None

        return f"data:{mime_type};base64,{encoded}"

    def clear(self) -> None:
        self.messages = []
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
        if self.file_path.exists():
            try:
                self.file_path.unlink()
            except Exception as e:
                logger.error(f"Failed to remove session file: {e}")
        if self.metadata_file_path.exists():
            try:
                self.metadata_file_path.unlink()
            except Exception as e:
                logger.error(f"Failed to remove session metadata file: {e}")

    def to_metadata(self) -> SessionMetadata:
        return SessionMetadata(
            session_id=self.session_id,
            workspace_path=self.workspace_path,
            created_at=self.created_at,
            updated_at=self.updated_at,
            title=self.title,
            locked_model=self.locked_model,
        )


class UserManager:
    DEFAULT_CONFIRMATION_TIMEOUT = 300

    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self.tool_confirmations: Dict[str, asyncio.Future[Dict[str, str]]] = {}
        self.pending_tool_context: Dict[str, Dict[str, str]] = {}
        self.question_responses: Dict[str, asyncio.Future[Dict[str, Any]]] = {}
        self.pending_question_context: Dict[str, Dict[str, str]] = {}
        self.session_tool_policies: Dict[str, Set[str]] = {}
        self.workspace_tool_policies: Dict[str, Set[str]] = {}
        self.connection_callbacks: Dict[ConnectionId, SendCallback] = {}
        self.session_connections: Dict[str, ConnectionId] = {}
        self._lock = asyncio.Lock()

    async def register_connection(self, connection_id: ConnectionId, callback: SendCallback) -> None:
        async with self._lock:
            self.connection_callbacks[connection_id] = callback

    async def unregister_connection(self, connection_id: ConnectionId) -> None:
        confirmations_to_cancel: List[asyncio.Future[Dict[str, str]]] = []

        async with self._lock:
            self.connection_callbacks.pop(connection_id, None)

            self.session_connections = {
                session_id: bound_connection_id
                for session_id, bound_connection_id in self.session_connections.items()
                if bound_connection_id != connection_id
            }

            for tool_call_id, context in list(self.pending_tool_context.items()):
                if context.get("connection_id") != connection_id:
                    continue

                future = self.tool_confirmations.pop(tool_call_id, None)
                self.pending_tool_context.pop(tool_call_id, None)
                if future and not future.done():
                    confirmations_to_cancel.append(future)

            for tool_call_id, context in list(self.pending_question_context.items()):
                if context.get("connection_id") != connection_id:
                    continue

                future = self.question_responses.pop(tool_call_id, None)
                self.pending_question_context.pop(tool_call_id, None)
                if future and not future.done():
                    future.set_result({
                        "action": "dismiss",
                        "reason": "connection_closed",
                    })

        for future in confirmations_to_cancel:
            future.set_result({
                "decision": "reject",
                "scope": "session",
                "reason": "connection_closed",
            })

    async def bind_session_to_connection(self, session_id: str, connection_id: ConnectionId) -> None:
        async with self._lock:
            if connection_id not in self.connection_callbacks:
                raise KeyError(f"Unknown connection_id: {connection_id}")
            self.session_connections[session_id] = connection_id

    async def create_session(self, workspace_path: str, session_id: Optional[str] = None) -> Session:
        if session_id is None:
            session_id = str(uuid.uuid4())

        async with self._lock:
            if session_id in self.sessions:
                return self.sessions[session_id]

            session = Session(session_id, workspace_path)
            self.sessions[session_id] = session
            return session

    def get_session(self, session_id: str) -> Optional[Session]:
        return self.sessions.get(session_id)

    async def remove_session(self, session_id: str) -> bool:
        async with self._lock:
            self.session_connections.pop(session_id, None)
            if session_id in self.sessions:
                del self.sessions[session_id]
                return True
            return False

    async def send_to_frontend(
        self,
        message: Dict[str, Any],
        connection_id: Optional[ConnectionId] = None,
    ) -> None:
        callbacks: List[SendCallback] = []

        async with self._lock:
            target_connection_id = connection_id
            if target_connection_id is None:
                session_id = message.get("session_id")
                if session_id:
                    target_connection_id = self.session_connections.get(session_id)

            if target_connection_id:
                callback = self.connection_callbacks.get(target_connection_id)
                if callback:
                    callbacks = [callback]
            elif len(self.connection_callbacks) == 1:
                callbacks = list(self.connection_callbacks.values())

        if not callbacks:
            logger.warning("No frontend connection available for message: %s", message)
            return

        for callback in callbacks:
            try:
                await callback(message)
            except Exception as e:
                logger.error(f"Failed to send message to frontend: {e}")

    async def request_tool_confirmation(
        self,
        session_id: str,
        tool_call_id: str,
        tool_name: str,
        workspace_path: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, str]:
        async with self._lock:
            if tool_call_id in self.tool_confirmations:
                logger.warning(f"Tool confirmation already pending for {tool_call_id}")
                return {"decision": "reject", "scope": "session", "reason": "duplicate_pending"}

            connection_id = self.session_connections.get(session_id)
            if not connection_id or connection_id not in self.connection_callbacks:
                logger.warning("Tool confirmation requested without active connection for session %s", session_id)
                return {"decision": "reject", "scope": "session", "reason": "connection_missing"}

            future: asyncio.Future[Dict[str, str]] = asyncio.Future()
            self.tool_confirmations[tool_call_id] = future
            self.pending_tool_context[tool_call_id] = {
                "session_id": session_id,
                "workspace_path": workspace_path,
                "tool_name": tool_name,
                "connection_id": connection_id,
            }

        await self.send_to_frontend({
            "type": "tool_confirm_request",
            "session_id": session_id,
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "arguments": arguments
        }, connection_id=connection_id)

        try:
            result = await asyncio.wait_for(future, timeout=self.DEFAULT_CONFIRMATION_TIMEOUT)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"Tool confirmation timeout for {tool_call_id}")
            async with self._lock:
                self.tool_confirmations.pop(tool_call_id, None)
                self.pending_tool_context.pop(tool_call_id, None)
            return {"decision": "reject", "scope": "session", "reason": "timeout"}
        except Exception as e:
            logger.error(f"Error waiting for tool confirmation: {e}")
            async with self._lock:
                self.tool_confirmations.pop(tool_call_id, None)
                self.pending_tool_context.pop(tool_call_id, None)
            return {"decision": "reject", "scope": "session", "reason": "internal_error"}

    async def request_question_response(
        self,
        session_id: str,
        tool_call_id: str,
        tool_name: str,
        question: str,
        details: Optional[str] = None,
        options: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        async with self._lock:
            if tool_call_id in self.question_responses:
                logger.warning("Question response already pending for %s", tool_call_id)
                return {"action": "dismiss", "reason": "duplicate_pending"}

            connection_id = self.session_connections.get(session_id)
            if not connection_id or connection_id not in self.connection_callbacks:
                logger.warning("Question requested without active connection for session %s", session_id)
                return {"action": "dismiss", "reason": "connection_missing"}

            future: asyncio.Future[Dict[str, Any]] = asyncio.Future()
            self.question_responses[tool_call_id] = future
            self.pending_question_context[tool_call_id] = {
                "session_id": session_id,
                "tool_name": tool_name,
                "connection_id": connection_id,
            }

        await self.send_to_frontend({
            "type": "question_request",
            "session_id": session_id,
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "question": question,
            "details": details or "",
            "options": options or [],
        }, connection_id=connection_id)

        try:
            return await asyncio.wait_for(future, timeout=self.DEFAULT_CONFIRMATION_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning("Question response timeout for %s", tool_call_id)
            async with self._lock:
                self.question_responses.pop(tool_call_id, None)
                self.pending_question_context.pop(tool_call_id, None)
            return {"action": "dismiss", "reason": "timeout"}
        except Exception as e:
            logger.error("Error waiting for question response: %s", e)
            async with self._lock:
                self.question_responses.pop(tool_call_id, None)
                self.pending_question_context.pop(tool_call_id, None)
            return {"action": "dismiss", "reason": "internal_error"}

    async def handle_question_response(
        self,
        tool_call_id: str,
        answer: Optional[str] = None,
        action: Literal["submit", "dismiss"] = "submit",
    ) -> bool:
        async with self._lock:
            if tool_call_id not in self.question_responses:
                logger.warning("No pending question for %s", tool_call_id)
                return False

            future = self.question_responses.pop(tool_call_id)
            self.pending_question_context.pop(tool_call_id, None)

            if not future.done():
                future.set_result({
                    "answer": answer,
                    "action": action,
                    "reason": "user_action",
                })
                return True
            return False

    async def handle_tool_confirmation(
        self,
        tool_call_id: str,
        approved: Optional[bool] = None,
        decision: Optional[Literal["approve_once", "approve_always", "reject"]] = None,
        scope: Literal["session", "workspace"] = "session"
    ) -> bool:
        async with self._lock:
            if tool_call_id not in self.tool_confirmations:
                logger.warning(f"No pending confirmation for {tool_call_id}")
                return False

            future = self.tool_confirmations.pop(tool_call_id)
            context = self.pending_tool_context.pop(tool_call_id, {})

            normalized_decision = decision
            if normalized_decision is None:
                normalized_decision = "approve_once" if approved else "reject"

            if normalized_decision == "approve_always":
                tool_name = context.get("tool_name")
                if tool_name:
                    if scope == "workspace":
                        workspace_path = context.get("workspace_path")
                        if workspace_path:
                            self.workspace_tool_policies.setdefault(workspace_path, set()).add(tool_name)
                    else:
                        session_id = context.get("session_id")
                        if session_id:
                            self.session_tool_policies.setdefault(session_id, set()).add(tool_name)

            if not future.done():
                future.set_result({
                    "decision": normalized_decision,
                    "scope": scope,
                    "reason": "user_action",
                })
                return True
            return False

    async def cancel_tool_confirmation(self, tool_call_id: str) -> bool:
        async with self._lock:
            if tool_call_id not in self.tool_confirmations:
                return False

            future = self.tool_confirmations.pop(tool_call_id)
            self.pending_tool_context.pop(tool_call_id, None)
            if not future.done():
                future.cancel()
                return True
            return False

    def is_tool_auto_approved(self, session_id: str, workspace_path: str, tool_name: str) -> bool:
        if tool_name in self.session_tool_policies.get(session_id, set()):
            return True
        if tool_name in self.workspace_tool_policies.get(workspace_path, set()):
            return True
        return False

    async def clear_all_confirmations(self) -> None:
        async with self._lock:
            for tool_call_id, future in list(self.tool_confirmations.items()):
                if not future.done():
                    future.cancel()
            self.tool_confirmations.clear()
            self.pending_tool_context.clear()
            for tool_call_id, future in list(self.question_responses.items()):
                if not future.done():
                    future.cancel()
            self.question_responses.clear()
            self.pending_question_context.clear()
