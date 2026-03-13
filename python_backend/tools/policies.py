from pydantic import BaseModel


class ToolExecutionPolicy(BaseModel):
    timeout_seconds: int = 30
    capture_output: bool = True
    allow_background: bool = False
