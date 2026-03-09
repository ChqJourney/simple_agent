import json
from typing import AsyncIterator, Dict, Any, List, Optional
import aiohttp
from .base import BaseLLM

__all__ = ["OllamaLLM"]

OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434"


class OllamaLLM(BaseLLM):
    """Ollama provider implementation for local LLM inference.

    Uses Ollama's native API for chat completions.
    """

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get("base_url", OLLAMA_DEFAULT_BASE_URL)

    async def stream(  # type: ignore[override]
        self, messages: List[Dict], tools: Optional[List[Dict]] = None
    ) -> AsyncIterator[Dict]:
        url = f"{self.base_url}/api/chat"

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True
        }

        if tools:
            payload["tools"] = self._convert_tools_to_ollama(tools)

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as response:
                response.raise_for_status()
                async for line in response.content:
                    if line:
                        data = json.loads(line)
                        yield self._convert_chunk_to_openai(data)

    async def complete(  # type: ignore[override]
        self, messages: List[Dict], tools: Optional[List[Dict]] = None
    ) -> Dict:
        url = f"{self.base_url}/api/chat"

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False
        }

        if tools:
            payload["tools"] = self._convert_tools_to_ollama(tools)

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as response:
                response.raise_for_status()
                data = await response.json()
                return self._convert_response_to_openai(data)

    def _convert_tools_to_ollama(self, tools: List[Any]) -> List[Dict]:
        ollama_tools = []
        for tool in tools:
            if hasattr(tool, 'name'):
                ollama_tools.append({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters
                    }
                })
            elif isinstance(tool, dict):
                ollama_tools.append(tool)
        return ollama_tools

    def _convert_chunk_to_openai(self, chunk: Dict) -> Dict:
        message = chunk.get("message", {})
        return {
            "id": f"ollama-{chunk.get('created_at', '')}",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": {
                    "role": message.get("role"),
                    "content": message.get("content", "")
                },
                "finish_reason": "stop" if chunk.get("done") else None
            }]
        }

    def _convert_response_to_openai(self, response: Dict) -> Dict:
        message = response.get("message", {})
        return {
            "id": f"ollama-{response.get('created_at', '')}",
            "object": "chat.completion",
            "created": 0,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": message.get("role", "assistant"),
                    "content": message.get("content", "")
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": response.get("prompt_eval_count", 0),
                "completion_tokens": response.get("eval_count", 0),
                "total_tokens": response.get("prompt_eval_count", 0) + response.get("eval_count", 0)
            }
        }