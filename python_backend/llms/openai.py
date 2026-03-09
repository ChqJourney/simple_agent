from typing import AsyncIterator, Dict, Any, List, Optional
from openai import AsyncOpenAI
from .base import BaseLLM


class OpenAILLM(BaseLLM):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )
    
    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> AsyncIterator[Dict]:
        tool_schemas = self._build_tool_schemas(tools) if tools else None
        
        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tool_schemas,
            stream=True
        )
        
        async for chunk in stream:
            yield chunk
    
    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> Dict:
        tool_schemas = self._build_tool_schemas(tools) if tools else None
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tool_schemas,
            stream=False
        )
        
        return response