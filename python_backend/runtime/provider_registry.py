from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Sequence

from retrieval.base import RetrievalProvider
from retrieval.simple_store import SimpleRetrievalStore
from skills.base import SkillProvider
from skills.local_loader import LocalSkillLoader


@dataclass
class ContextProviderBundle:
    skill_provider: Optional[SkillProvider] = None
    retrieval_provider: Optional[RetrievalProvider] = None


class ContextProviderRegistry:
    def __init__(self, skill_search_roots: Sequence[Path | str] | None = None) -> None:
        self.skill_search_roots = [Path(root) for root in (skill_search_roots or [])]

    def build_bundle(self, config: Dict[str, Any]) -> ContextProviderBundle:
        context_config = config.get("context_providers") if isinstance(config.get("context_providers"), dict) else {}
        skills_config = context_config.get("skills") if isinstance(context_config.get("skills"), dict) else {}
        retrieval_config = (
            context_config.get("retrieval") if isinstance(context_config.get("retrieval"), dict) else {}
        )

        local_skill_config = skills_config.get("local") if isinstance(skills_config.get("local"), dict) else {}
        workspace_retrieval_config = (
            retrieval_config.get("workspace")
            if isinstance(retrieval_config.get("workspace"), dict)
            else {}
        )

        skill_provider: Optional[SkillProvider] = None
        if local_skill_config.get("enabled", True):
            skill_provider = LocalSkillLoader(search_roots=self.skill_search_roots)

        retrieval_provider: Optional[RetrievalProvider] = None
        if workspace_retrieval_config.get("enabled", True):
            retrieval_provider = SimpleRetrievalStore(
                extensions=workspace_retrieval_config.get("extensions"),
                max_hits=int(workspace_retrieval_config.get("max_hits") or 3),
            )

        return ContextProviderBundle(
            skill_provider=skill_provider,
            retrieval_provider=retrieval_provider,
        )
