from __future__ import annotations

import re
from pathlib import Path
from typing import List, Sequence

from .base import RetrievalHit, RetrievalProvider


class SimpleRetrievalStore(RetrievalProvider):
    def __init__(self, extensions: Sequence[str] | None = None, max_hits: int = 3) -> None:
        self.extensions = tuple(extensions or (".md", ".txt", ".json"))
        self.max_hits = max_hits
        self.excluded_dirs = {".agent", ".git", "node_modules", "dist", "__pycache__"}

    def retrieve(self, query: str, workspace_path: str, limit: int | None = None) -> List[RetrievalHit]:
        root = Path(workspace_path)
        if not root.exists():
            return []

        terms = self._tokenize(query)
        if not terms:
            return []

        hits: List[RetrievalHit] = []
        for file_path in root.rglob("*"):
            if not file_path.is_file() or file_path.suffix.lower() not in self.extensions:
                continue
            if any(part in self.excluded_dirs for part in file_path.parts):
                continue

            try:
                content = file_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue

            score = sum(content.lower().count(term) for term in terms)
            if score <= 0:
                continue

            hits.append(
                RetrievalHit(
                    path=str(file_path),
                    snippet=self._extract_snippet(content, terms),
                    score=score,
                )
            )

        hits.sort(key=lambda hit: (-hit.score, hit.path))
        effective_limit = limit if limit is not None and limit > 0 else self.max_hits
        return hits[:effective_limit]

    @staticmethod
    def _tokenize(query: str) -> List[str]:
        return [term.lower() for term in re.findall(r"[A-Za-z0-9_\\-]{3,}", query)]

    @staticmethod
    def _extract_snippet(content: str, terms: Sequence[str], max_length: int = 220) -> str:
        lowered = content.lower()
        first_index = min((lowered.find(term) for term in terms if lowered.find(term) >= 0), default=0)
        start = max(first_index - 40, 0)
        end = min(start + max_length, len(content))
        return content[start:end].strip()
