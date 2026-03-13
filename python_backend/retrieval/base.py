from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class RetrievalHit:
    path: str
    snippet: str
    score: int


class RetrievalProvider(ABC):
    @abstractmethod
    def retrieve(self, query: str, workspace_path: str, limit: int | None = None) -> List[RetrievalHit]:
        raise NotImplementedError
