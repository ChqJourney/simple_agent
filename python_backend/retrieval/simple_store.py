from __future__ import annotations

import os
import re
from pathlib import Path
from typing import List, Sequence

from .base import RetrievalHit, RetrievalProvider


class SimpleRetrievalStore(RetrievalProvider):
    def __init__(
        self,
        extensions: Sequence[str] | None = None,
        max_hits: int = 3,
        max_scan_files: int = 1200,
        max_file_size_bytes: int = 256 * 1024,
    ) -> None:
        self.extensions = tuple(extensions or (".md", ".txt", ".json"))
        self.max_hits = max_hits
        self.max_scan_files = max_scan_files
        self.max_file_size_bytes = max_file_size_bytes
        self.excluded_dirs = {".agent", ".git", "node_modules", "dist", "__pycache__"}

    def retrieve(self, query: str, workspace_path: str, limit: int | None = None) -> List[RetrievalHit]:
        root = Path(workspace_path)
        if not root.exists():
            return []

        terms = self._tokenize(query)
        if not terms:
            return []

        hits: List[RetrievalHit] = []
        scanned_files = 0
        reached_scan_limit = False

        for current_root, dirs, files in os.walk(root, topdown=True):
            dirs[:] = [d for d in dirs if d not in self.excluded_dirs]

            for file_name in files:
                file_path = Path(current_root) / file_name
                if file_path.suffix.lower() not in self.extensions:
                    continue
                scanned_files += 1
                if scanned_files > self.max_scan_files:
                    reached_scan_limit = True
                    break

                try:
                    file_size = file_path.stat().st_size
                except OSError:
                    continue
                if file_size > self.max_file_size_bytes:
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
            if reached_scan_limit:
                break

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
