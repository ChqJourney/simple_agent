from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


class LockedModelRef(BaseModel):
    profile_name: str
    provider: str
    model: str


class SessionMetadata(BaseModel):
    session_id: str
    workspace_path: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    title: Optional[str] = None
    locked_model: Optional[LockedModelRef] = None
