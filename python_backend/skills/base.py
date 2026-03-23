from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

SkillSource = Literal["app", "workspace"]


@dataclass(frozen=True)
class SkillSummary:
    name: str
    description: str
    frontmatter: str
    source_path: str
    source: SkillSource
    metadata: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ResolvedSkill(SkillSummary):
    content: str = ""


class SkillProvider(ABC):
    @abstractmethod
    def list_skills(self, workspace_path: str = "") -> List[SkillSummary]:
        raise NotImplementedError

    @abstractmethod
    def load(
        self,
        skill_name: str,
        workspace_path: str = "",
        source: Optional[SkillSource] = None,
    ) -> Optional[ResolvedSkill]:
        raise NotImplementedError
