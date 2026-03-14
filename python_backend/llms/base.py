from abc import ABC, abstractmethod
from typing import AsyncIterator, Dict, Any, List, Optional
from .capabilities import get_default_context_length


class BaseLLM(ABC):
    """Abstract base class for LLM implementations.
    
    Provides a common interface for streaming and non-streaming completions
    with optional tool/function calling support.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the LLM with configuration.
        
        Required config fields:
            - model: The model identifier to use
            
        Optional config fields:
            - api_key: API key for authentication
            - base_url: Base URL for the API endpoint
        """
        self.config = config
        self.model = config["model"]
        self.api_key = config.get("api_key")
        self.base_url = config.get("base_url")
        self.latest_usage: Optional[Dict[str, Any]] = None

    @abstractmethod
    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> AsyncIterator[Dict]:
        """Stream response, yield OpenAI format chunks"""

    @abstractmethod
    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> Dict:
        """Non-streaming complete response"""

    def _build_tool_schemas(self, tools: List[Any]) -> Optional[List[Dict]]:
        """Convert tool registry to OpenAI function calling format.
        
        Tools are expected to have .name, .description, and .parameters attributes.
        """
        if not tools:
            return None

        schemas = []
        for tool in tools:
            schema = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            }
            schemas.append(schema)

        return schemas

    def _get_max_output_tokens(self) -> Optional[int]:
        value = self.config.get("max_output_tokens")
        if value in (None, ""):
            runtime = self.config.get("runtime")
            if isinstance(runtime, dict):
                value = runtime.get("max_output_tokens")

        if value in (None, ""):
            return None

        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def reset_latest_usage(self) -> None:
        self.latest_usage = None

    def get_latest_usage(self) -> Optional[Dict[str, Any]]:
        if not isinstance(self.latest_usage, dict):
            return None
        return dict(self.latest_usage)

    def _get_context_length(self) -> Optional[int]:
        value = self.config.get("context_length")
        if value in (None, ""):
            runtime = self.config.get("runtime")
            if isinstance(runtime, dict):
                value = runtime.get("context_length")

        if value in (None, ""):
            return None

        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = None
        if parsed is not None and parsed > 0:
            return parsed
        return get_default_context_length(str(self.config.get("provider") or ""), self.model)

    def _get_timeout_seconds(self, default: float = 60.0) -> float:
        value = self.config.get("timeout_seconds")
        if value in (None, ""):
            runtime = self.config.get("runtime")
            if isinstance(runtime, dict):
                value = runtime.get("timeout_seconds")

        try:
            parsed = float(value)
        except (TypeError, ValueError):
            parsed = default

        return parsed if parsed > 0 else default

    @staticmethod
    def _coerce_usage_field(raw_usage: Any, field: str) -> Optional[int]:
        if isinstance(raw_usage, dict):
            value = raw_usage.get(field)
        else:
            value = getattr(raw_usage, field, None)

        if value in (None, ""):
            return None

        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _coerce_reasoning_tokens(raw_usage: Any) -> Optional[int]:
        details = None
        if isinstance(raw_usage, dict):
            details = raw_usage.get("completion_tokens_details")
            if details is None:
                details = raw_usage.get("output_tokens_details")
        else:
            details = getattr(raw_usage, "completion_tokens_details", None)
            if details is None:
                details = getattr(raw_usage, "output_tokens_details", None)

        if isinstance(details, dict):
            value = details.get("reasoning_tokens")
        else:
            value = getattr(details, "reasoning_tokens", None)

        if value in (None, ""):
            value = raw_usage.get("reasoning_tokens") if isinstance(raw_usage, dict) else getattr(raw_usage, "reasoning_tokens", None)

        if value in (None, ""):
            return None

        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _set_latest_usage(self, raw_usage: Any) -> Optional[Dict[str, Any]]:
        prompt_tokens = self._coerce_usage_field(raw_usage, "prompt_tokens")
        completion_tokens = self._coerce_usage_field(raw_usage, "completion_tokens")
        total_tokens = self._coerce_usage_field(raw_usage, "total_tokens")

        if prompt_tokens is None and completion_tokens is None and total_tokens is None:
            return None

        if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens

        normalized: Dict[str, Any] = {
            "prompt_tokens": prompt_tokens or 0,
            "completion_tokens": completion_tokens or 0,
            "total_tokens": total_tokens or 0,
        }
        reasoning_tokens = self._coerce_reasoning_tokens(raw_usage)
        if reasoning_tokens is not None:
            normalized["reasoning_tokens"] = reasoning_tokens

        context_length = self._get_context_length()
        if context_length is not None:
            normalized["context_length"] = context_length

        self.latest_usage = normalized
        return normalized
