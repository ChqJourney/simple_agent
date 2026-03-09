import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class Message(BaseModel):
    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None
    reasoning_content: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class Session:
    def __init__(self, session_id: str, workspace_path: str):
        self.session_id = session_id
        self.workspace_path = workspace_path
        self.messages: List[Message] = []
        self.created_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
        self.file_path = self._get_file_path()
        self._ensure_directory()
        self.load_history()

    def _get_file_path(self) -> str:
        return os.path.join(self.workspace_path, ".agent", "sessions", f"{self.session_id}.jsonl")

    def _ensure_directory(self) -> None:
        directory = os.path.dirname(self.file_path)
        os.makedirs(directory, exist_ok=True)

    def add_message(self, message: Message) -> None:
        self.messages.append(message)
        self.updated_at = datetime.utcnow()
        self._append_to_file(message)

    def _append_to_file(self, message: Message) -> None:
        try:
            with open(self.file_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(message.model_dump(), default=str) + "\n")
        except Exception as e:
            logger.error(f"Failed to append message to file: {e}")

    def load_history(self) -> None:
        if not os.path.exists(self.file_path):
            return

        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
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
            llm_msg: Dict[str, Any] = {"role": msg.role}
            if msg.content is not None:
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

    def clear(self) -> None:
        self.messages = []
        self.created_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
        if os.path.exists(self.file_path):
            try:
                os.remove(self.file_path)
            except Exception as e:
                logger.error(f"Failed to remove session file: {e}")


class UserManager:
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self.tool_confirmations: Dict[str, asyncio.Future[bool]] = {}
        self.ws_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None

    def create_session(self, workspace_path: str, session_id: Optional[str] = None) -> Session:
        if session_id is None:
            session_id = str(uuid.uuid4())

        if session_id in self.sessions:
            return self.sessions[session_id]

        session = Session(session_id, workspace_path)
        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        return self.sessions.get(session_id)

    def remove_session(self, session_id: str) -> bool:
        if session_id in self.sessions:
            del self.sessions[session_id]
            return True
        return False

    def set_ws_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
        self.ws_callback = callback

    async def send_to_frontend(self, message: Dict[str, Any]) -> None:
        if self.ws_callback:
            try:
                await self.ws_callback(message)
            except Exception as e:
                logger.error(f"Failed to send message to frontend: {e}")

    async def request_tool_confirmation(
        self,
        session_id: str,
        tool_call_id: str,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> bool:
        if tool_call_id in self.tool_confirmations:
            logger.warning(f"Tool confirmation already pending for {tool_call_id}")
            return False

        future: asyncio.Future[bool] = asyncio.Future()
        self.tool_confirmations[tool_call_id] = future

        await self.send_to_frontend({
            "type": "tool_confirm_request",
            "session_id": session_id,
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "arguments": arguments
        })

        try:
            result = await asyncio.wait_for(future, timeout=300.0)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"Tool confirmation timeout for {tool_call_id}")
            del self.tool_confirmations[tool_call_id]
            return False
        except Exception as e:
            logger.error(f"Error waiting for tool confirmation: {e}")
            if tool_call_id in self.tool_confirmations:
                del self.tool_confirmations[tool_call_id]
            return False

    def handle_tool_confirmation(self, tool_call_id: str, approved: bool) -> bool:
        if tool_call_id not in self.tool_confirmations:
            logger.warning(f"No pending confirmation for {tool_call_id}")
            return False

        future = self.tool_confirmations.pop(tool_call_id)
        if not future.done():
            future.set_result(approved)
            return True
        return False

    def cancel_tool_confirmation(self, tool_call_id: str) -> bool:
        if tool_call_id not in self.tool_confirmations:
            return False

        future = self.tool_confirmations.pop(tool_call_id)
        if not future.done():
            future.cancel()
            return True
        return False

    def clear_all_confirmations(self) -> None:
        for tool_call_id, future in list(self.tool_confirmations.items()):
            if not future.done():
                future.cancel()
        self.tool_confirmations.clear()