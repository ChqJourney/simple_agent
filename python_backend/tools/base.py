import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from .policies import ToolExecutionPolicy

logger = logging.getLogger(__name__)


class ToolExecutionError(Exception):
    def __init__(
        self,
        message: str,
        *,
        output: Any = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.output = output
        self.metadata = metadata or {}


class ToolResult(BaseModel):
    tool_call_id: str
    tool_name: str
    success: bool
    output: Any
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ToolDescriptor(BaseModel):
    name: str
    description: str
    parameters: Dict[str, Any]
    category: Literal["workspace", "execution", "task", "interaction", "general"] = "general"
    require_confirmation: bool = False
    display_name: Optional[str] = None
    read_only: bool = False
    risk_level: Literal["low", "medium", "high"] = "medium"
    preferred_order: int = 100
    use_when: str = ""
    avoid_when: str = ""
    user_summary_template: str = ""
    result_preview_fields: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    policy: ToolExecutionPolicy = Field(default_factory=ToolExecutionPolicy)


class BaseTool(ABC):
    name: str
    description: str
    parameters: Dict[str, Any]
    category: str = "general"
    display_name: Optional[str] = None
    require_confirmation: bool = False
    read_only: bool = False
    risk_level: str = "medium"
    preferred_order: int = 100
    use_when: str = ""
    avoid_when: str = ""
    user_summary_template: str = ""
    result_preview_fields: List[str] = []
    tags: List[str] = []
    policy: ToolExecutionPolicy = ToolExecutionPolicy()

    def __init__(self) -> None:
        # Avoid shared mutable class-level policy state leaking across instances/tests.
        self.policy = self.__class__.policy.model_copy(deep=True)
        self.result_preview_fields = list(getattr(self.__class__, "result_preview_fields", []) or [])
        self.tags = list(getattr(self.__class__, "tags", []) or [])

    def descriptor(self) -> ToolDescriptor:
        return ToolDescriptor(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
            category=self.category,
            require_confirmation=self.require_confirmation,
            display_name=self.display_name,
            read_only=self.read_only,
            risk_level=self.risk_level,
            preferred_order=self.preferred_order,
            use_when=self.use_when,
            avoid_when=self.avoid_when,
            user_summary_template=self.user_summary_template,
            result_preview_fields=self.result_preview_fields,
            tags=self.tags,
            policy=self.policy,
        )

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

    def get_descriptors(self) -> List[ToolDescriptor]:
        return [tool.descriptor() for tool in self.tools.values()]

    def get_descriptor(self, name: str) -> Optional[ToolDescriptor]:
        tool = self.get_tool(name)
        return tool.descriptor() if tool else None

    def list_by_category(self, category: str) -> List[BaseTool]:
        return [tool for tool in self.tools.values() if tool.category == category]

    def get_schemas(self) -> List[Dict]:
        schemas = []
        for tool in self.tools.values():
            schema = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
                "x-tool-meta": tool.descriptor().model_dump(mode="json"),
            }
            schemas.append(schema)
        return schemas
