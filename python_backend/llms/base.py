from abc import ABC, abstractmethod
from typing import AsyncIterator, Dict, Any, List


class BaseLLM(ABC):
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.model = config.get("model")
        self.api_key = config.get("api_key")
        self.base_url = config.get("base_url")

    @abstractmethod
    async def stream(self, messages: List[Dict], tools: List[Dict] = None) -> AsyncIterator[Dict]:
        """Stream response, yield OpenAI format chunks"""
        pass

    @abstractmethod
    async def complete(self, messages: List[Dict], tools: List[Dict] = None) -> Dict:
        """Non-streaming complete response"""
        pass

    def _build_tool_schemas(self, tools: List[Any]) -> List[Dict]:
        """Convert tool registry to OpenAI function calling format"""
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