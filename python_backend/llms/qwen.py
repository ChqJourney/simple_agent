from typing import AsyncIterator, Dict, Any, List, Optional
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionChunk
from .base import BaseLLM

__all__ = ["QwenLLM"]

QWEN_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


class QwenLLM(BaseLLM):
    """Qwen (Tongyi Qianwen) provider implementation.

    Uses OpenAI-compatible API via DashScope.
    """

    def __init__(self, config: Dict[str, Any]):
        base_url = config.get("base_url", QWEN_DEFAULT_BASE_URL)
        config_with_defaults = {**config, "base_url": base_url}
        super().__init__(config_with_defaults)
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )

    async def stream(  # type: ignore[override]
        self, messages: List[Dict], tools: Optional[List[Dict]] = None
    ) -> AsyncIterator[ChatCompletionChunk]:
        tool_schemas = self._build_tool_schemas(tools) if tools else None

        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,  # type: ignore[arg-type]
            tools=tool_schemas,  # type: ignore[arg-type]
            stream=True
        )

        async for chunk in stream:
            yield chunk

    async def complete(  # type: ignore[override]
        self, messages: List[Dict], tools: Optional[List[Dict]] = None
    ) -> ChatCompletion:
        tool_schemas = self._build_tool_schemas(tools) if tools else None

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,  # type: ignore[arg-type]
            tools=tool_schemas,  # type: ignore[arg-type]
            stream=False
        )

        return response