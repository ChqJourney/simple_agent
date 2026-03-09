import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ToolResult(BaseModel):
    tool_call_id: str
    tool_name: str
    success: bool
    output: Any
    error: Optional[str] = None


class BaseTool(ABC):
    name: str
    description: str
    parameters: Dict[str, Any]
    require_confirmation: bool = False

    @abstractmethod
    async def execute(self, **kwargs) -> ToolResult:
        pass


class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        if tool.name in self.tools:
            logger.warning(f"Tool '{tool.name}' is already registered. Overwriting.")
        self.tools[tool.name] = tool

    def unregister(self, tool_name: str) -> bool:
        if tool_name in self.tools:
            del self.tools[tool_name]
            return True
        return False

    def get_tool(self, name: str) -> Optional[BaseTool]:
        return self.tools.get(name)

    def get_schemas(self) -> List[Dict]:
        schemas = []
        for tool in self.tools.values():
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
