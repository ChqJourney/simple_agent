from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

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
    scenario_id: str = "default"
    scenario_version: int = 1
    scenario_label: Optional[str] = None


class SessionMemorySnapshot(BaseModel):
    version: int = 1
    session_id: str
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    covered_until_message_index: int = -1
    current_task: str = ""
    completed_milestones: List[str] = Field(default_factory=list)
    decisions_and_constraints: List[str] = Field(default_factory=list)
    important_user_preferences: List[str] = Field(default_factory=list)
    important_files_and_paths: List[str] = Field(default_factory=list)
    key_tool_results: List[str] = Field(default_factory=list)
    open_loops: List[str] = Field(default_factory=list)
    risks_or_unknowns: List[str] = Field(default_factory=list)
    raw_summary_text: str = ""
    estimated_tokens: int = 0


class SessionCompactionRecord(BaseModel):
    compaction_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    strategy: Literal["background", "forced"]
    source_start_index: int
    source_end_index: int
    pre_tokens_estimate: int
    post_tokens_estimate: int
    memory_version: int = 1
    model: Dict[str, str] = Field(default_factory=dict)
    notes: str = ""


class ReplayPlan(BaseModel):
    system_message: Optional[Dict[str, Any]] = None
    memory_message: Optional[Dict[str, Any]] = None
    history_messages: List[Dict[str, Any]] = Field(default_factory=list)
    latest_prompt_tokens: int = 0
    context_length: int = 0
    usage_ratio: float = 0.0
    forced_compaction_required: bool = False
    background_compaction_recommended: bool = False
