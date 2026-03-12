from typing import Any, AsyncIterator, Dict, List, Optional

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from .base import BaseLLM
from .capabilities import supports_reasoning

__all__ = ['QwenLLM']

QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'


class QwenLLM(BaseLLM):
    def __init__(self, config: Dict[str, Any]):
        base_url = config.get('base_url', QWEN_DEFAULT_BASE_URL)
        config_with_defaults = {**config, 'base_url': base_url}
        super().__init__(config_with_defaults)
        self.enable_reasoning = bool(config.get('enable_reasoning', False))
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
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
        if supports_reasoning('qwen', self.model):
            kwargs['extra_body'] = {
                'enable_thinking': self.enable_reasoning,
            }
        return kwargs

    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> AsyncIterator[ChatCompletionChunk]:
        stream = await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, True))
        async for chunk in stream:
            yield chunk

    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> ChatCompletion:
        return await self.client.chat.completions.create(**self._build_request_kwargs(messages, tools, False))
