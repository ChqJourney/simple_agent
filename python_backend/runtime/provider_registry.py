from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Sequence

from runtime.config import get_disabled_system_skill_names
from skills.base import SkillProvider
from skills.local_loader import LocalSkillLoader


@dataclass
class ContextProviderBundle:
    skill_provider: Optional[SkillProvider] = None


class ContextProviderRegistry:
    def __init__(self, skill_search_roots: Sequence[Path | str] | None = None) -> None:
        self.skill_search_roots = [Path(root) for root in (skill_search_roots or [])]

    def build_bundle(self, config: Dict[str, Any]) -> ContextProviderBundle:
        context_config = config.get("context_providers") if isinstance(config.get("context_providers"), dict) else {}
        skills_config = context_config.get("skills") if isinstance(context_config.get("skills"), dict) else {}

        local_skill_config = skills_config.get("local") if isinstance(skills_config.get("local"), dict) else {}
        disabled_system_skills = get_disabled_system_skill_names(config)

        skill_provider: Optional[SkillProvider] = None
        if local_skill_config.get("enabled", True):
            skill_provider = LocalSkillLoader(
                search_roots=self.skill_search_roots,
                disabled_app_skills=sorted(disabled_system_skills),
            )

        return ContextProviderBundle(
            skill_provider=skill_provider,
        )
