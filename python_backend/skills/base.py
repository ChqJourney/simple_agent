from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class ResolvedSkill:
    name: str
    description: str
    content: str
    source_path: str


class SkillProvider(ABC):
    @abstractmethod
    def resolve(self, query: str, workspace_path: str = "") -> List[ResolvedSkill]:
        raise NotImplementedError
