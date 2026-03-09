from abc import ABC, abstractmethod
from typing import AsyncIterator, Dict, Any, List, Optional


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