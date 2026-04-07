from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from .base import BaseLLM
from .capabilities import supports_reasoning

__all__ = ["KimiLLM", "KIMI_DEFAULT_BASE_URL"]

KIMI_DEFAULT_BASE_URL = "https://api.moonshot.cn/v1"


class KimiLLM(BaseLLM):
    def __init__(self, config: Dict[str, Any]):
        base_url = str(config.get("base_url") or "").strip() or KIMI_DEFAULT_BASE_URL
        config_with_defaults = {**config, "base_url": base_url}
        super().__init__(config_with_defaults)
        self.enable_reasoning = bool(config.get("enable_reasoning", False))
        self.http_client = httpx.AsyncClient(timeout=self._get_timeout_seconds())
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            http_client=self.http_client,
        )

    def _requires_k2_5_constraints(self) -> bool:
        return self.model.strip().lower().startswith("kimi-k2.5")

    def _get_temperature(self) -> Optional[float]:
        if not self._requires_k2_5_constraints():
            return None
        return 1.0 if self.enable_reasoning else 0.6

    def _prepare_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        prepared: List[Dict[str, Any]] = []
        for message in messages:
            normalized = dict(message)
            if normalized.get("role") == "assistant" and self._requires_k2_5_constraints():
                normalized.setdefault("reasoning_content", normalized.get("reasoning_content") or "")
            prepared.append(normalized)
        return prepared

    def _build_request_kwargs(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        stream: bool,
    ) -> Dict[str, Any]:
        tool_schemas = self._build_tool_schemas(tools) if tools else None
        extra_body: Dict[str, Any] = {}
        if supports_reasoning("kimi", self.model):
            extra_body["thinking"] = {
                "type": "enabled" if self.enable_reasoning else "disabled",
            }

        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": self._prepare_messages(messages),
            "tools": tool_schemas,
            "stream": stream,
        }
        if stream:
            kwargs["stream_options"] = {"include_usage": True}
        temperature = self._get_temperature()
        if temperature is not None:
            kwargs["temperature"] = temperature
        max_output_tokens = self._get_max_output_tokens()
        if max_output_tokens is not None:
            kwargs["max_tokens"] = max_output_tokens
        if extra_body:
            kwargs["extra_body"] = extra_body
        return kwargs

    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> AsyncIterator[ChatCompletionChunk]:
        self.reset_latest_usage()
        stream = await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, True))
        try:
            async for chunk in stream:
                if getattr(chunk, "usage", None) is not None:
                    self._set_latest_usage(chunk.usage)
                yield chunk
        finally:
            await self._close_stream_handle(stream)

    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> ChatCompletion:
        self.reset_latest_usage()
        response = await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, False))
        if getattr(response, "usage", None) is not None:
            self._set_latest_usage(response.usage)
        return response

    async def aclose(self) -> None:
        await self.http_client.aclose()

    def close(self):
        return self.http_client.aclose()
