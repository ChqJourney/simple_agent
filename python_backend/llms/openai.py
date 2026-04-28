from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from .base import BaseLLM
from .capabilities import get_openai_reasoning_effort

__all__ = ['OpenAILLM']


class OpenAILLM(BaseLLM):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.http_client = httpx.AsyncClient(timeout=self._get_timeout_seconds())
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            http_client=self.http_client,
        )

    def _build_request_kwargs(
        self,
        messages: List[Dict],
        tools: Optional[List[Dict]],
        stream: bool,
    ) -> Dict[str, Any]:
        tool_schemas = self._build_tool_schemas(tools) if tools else None
        kwargs: Dict[str, Any] = {
            'model': self.model,
            'messages': messages,
            'tools': tool_schemas,
            'stream': stream,
        }
        if stream:
            kwargs['stream_options'] = {'include_usage': True}
        max_output_tokens = self._get_max_output_tokens()
        if max_output_tokens is not None:
            kwargs['max_tokens'] = max_output_tokens
        reasoning_effort = get_openai_reasoning_effort(self._get_reasoning_mode())
        if reasoning_effort:
            kwargs['reasoning_effort'] = reasoning_effort
        return kwargs

    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> AsyncIterator[ChatCompletionChunk]:
        self.reset_latest_usage()
        stream = await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, True))
        try:
            async for chunk in stream:
                if getattr(chunk, 'usage', None) is not None:
                    self._set_latest_usage(chunk.usage)
                yield chunk
        finally:
            await self._close_stream_handle(stream)

    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> ChatCompletion:
        self.reset_latest_usage()
        response = await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, False))
        if getattr(response, 'usage', None) is not None:
            self._set_latest_usage(response.usage)
        return response

    async def aclose(self) -> None:
        await self.http_client.aclose()

    def close(self):
        return self.http_client.aclose()
