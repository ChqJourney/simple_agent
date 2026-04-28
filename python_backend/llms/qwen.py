from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from .base import BaseLLM

__all__ = ['QwenLLM']

QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'


class QwenLLM(BaseLLM):
    def __init__(self, config: Dict[str, Any]):
        base_url = config.get('base_url', QWEN_DEFAULT_BASE_URL)
        config_with_defaults = {**config, 'base_url': base_url}
        super().__init__(config_with_defaults)
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
        reasoning_mode = self._get_reasoning_mode()
        if reasoning_mode in {'on', 'off'}:
            kwargs['extra_body'] = {
                'enable_thinking': reasoning_mode == 'on',
            }
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
