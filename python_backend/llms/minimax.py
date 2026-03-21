from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from openai import AsyncOpenAI

from .base import BaseLLM

__all__ = ["MiniMaxLLM", "MINIMAX_DEFAULT_BASE_URL"]

MINIMAX_DEFAULT_BASE_URL = "https://api.minimaxi.com/v1"


class MiniMaxLLM(BaseLLM):
    def __init__(self, config: Dict[str, Any]):
        base_url = str(config.get("base_url") or "").strip() or MINIMAX_DEFAULT_BASE_URL
        config_with_defaults = {**config, "base_url": base_url}
        super().__init__(config_with_defaults)
        self.http_client = httpx.AsyncClient(timeout=self._get_timeout_seconds())
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            http_client=self.http_client,
        )

    def _build_request_kwargs(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        stream: bool,
    ) -> Dict[str, Any]:
        tool_schemas = self._build_tool_schemas(tools) if tools else None
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "tools": tool_schemas,
            "stream": stream,
            "extra_body": {
                "reasoning_split": True,
            },
        }
        if stream:
            kwargs["stream_options"] = {"include_usage": True}
        max_output_tokens = self._get_max_output_tokens()
        if max_output_tokens is not None:
            kwargs["max_tokens"] = max_output_tokens
        return kwargs

    @staticmethod
    def _to_dict(payload: Any) -> Dict[str, Any]:
        if isinstance(payload, dict):
            return payload
        if hasattr(payload, "model_dump"):
            return payload.model_dump()
        return {}

    @staticmethod
    def _extract_reasoning_text(reasoning_details: Any) -> str:
        if isinstance(reasoning_details, str):
            return reasoning_details
        if isinstance(reasoning_details, list):
            return "".join(MiniMaxLLM._extract_reasoning_text(item) for item in reasoning_details)
        if isinstance(reasoning_details, dict):
            for key in ("text", "content", "reasoning_content", "reasoning_text"):
                value = reasoning_details.get(key)
                if isinstance(value, str):
                    return value
            return "".join(
                MiniMaxLLM._extract_reasoning_text(value)
                for value in reasoning_details.values()
            )
        return ""

    def _normalize_chunk(self, chunk: Any) -> Dict[str, Any]:
        data = self._to_dict(chunk)
        if not data:
            return {"choices": []}

        choices = data.get("choices")
        if not isinstance(choices, list):
            data["choices"] = []
            return data

        normalized_choices = []
        for choice in choices:
            normalized_choice = dict(choice) if isinstance(choice, dict) else {}
            delta = normalized_choice.get("delta") if isinstance(normalized_choice.get("delta"), dict) else {}
            if not delta and hasattr(choice, "delta"):
                delta = self._to_dict(choice.delta)
            reasoning_content = delta.get("reasoning_content") if isinstance(delta, dict) else None
            if not isinstance(reasoning_content, str) or not reasoning_content:
                reasoning_content = self._extract_reasoning_text(delta.get("reasoning_details"))
            if reasoning_content:
                delta = {**delta, "reasoning_content": reasoning_content}
            normalized_choice["delta"] = delta
            normalized_choices.append(normalized_choice)

        data["choices"] = normalized_choices
        return data

    def _normalize_response(self, response: Any) -> Dict[str, Any]:
        data = self._to_dict(response)
        if not data:
            return {"choices": []}

        choices = data.get("choices")
        if not isinstance(choices, list):
            data["choices"] = []
            return data

        normalized_choices = []
        for choice in choices:
            normalized_choice = dict(choice) if isinstance(choice, dict) else {}
            message = normalized_choice.get("message") if isinstance(normalized_choice.get("message"), dict) else {}
            if not message and hasattr(choice, "message"):
                message = self._to_dict(choice.message)
            reasoning_content = message.get("reasoning_content") if isinstance(message, dict) else None
            if not isinstance(reasoning_content, str) or not reasoning_content:
                reasoning_content = self._extract_reasoning_text(message.get("reasoning_details"))
            if reasoning_content:
                message = {**message, "reasoning_content": reasoning_content}
            normalized_choice["message"] = message
            normalized_choices.append(normalized_choice)

        data["choices"] = normalized_choices
        return data

    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> AsyncIterator[Dict[str, Any]]:
        self.reset_latest_usage()
        stream = await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, True))
        async for chunk in stream:
            raw_usage = getattr(chunk, "usage", None)
            if raw_usage is None:
                raw_usage = self._to_dict(chunk).get("usage")
            if raw_usage is not None:
                self._set_latest_usage(raw_usage)
            yield self._normalize_chunk(chunk)

    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> Dict[str, Any]:
        self.reset_latest_usage()
        response = await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, False))
        raw_usage = getattr(response, "usage", None)
        if raw_usage is None:
            raw_usage = self._to_dict(response).get("usage")
        if raw_usage is not None:
            self._set_latest_usage(raw_usage)
        return self._normalize_response(response)

    async def aclose(self) -> None:
        await self.http_client.aclose()

    def close(self):
        return self.http_client.aclose()
