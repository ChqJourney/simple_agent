from __future__ import annotations

from pathlib import Path
from typing import Iterable, List, Sequence

from .base import ResolvedSkill, SkillProvider


class LocalSkillLoader(SkillProvider):
    def __init__(self, search_roots: Sequence[Path | str] | None = None) -> None:
        self.search_roots = [Path(root) for root in (search_roots or [])]

    def resolve(self, query: str, workspace_path: str = "") -> List[ResolvedSkill]:
        normalized_query = query.lower()
        resolved: List[ResolvedSkill] = []

        for skill_file in self._iter_skill_files(workspace_path):
            parsed = self._parse_skill_file(skill_file)
            if not parsed:
                continue

            skill = ResolvedSkill(
                name=parsed["name"],
                description=parsed["description"],
                content=parsed["content"],
                source_path=str(skill_file),
            )
            if self._matches_query(skill, normalized_query):
                resolved.append(skill)

        resolved.sort(key=lambda item: item.name)
        return resolved

    def _iter_skill_files(self, workspace_path: str) -> Iterable[Path]:
        roots = list(self.search_roots)
        if workspace_path:
            roots.append(Path(workspace_path) / ".agent" / "skills")

        seen: set[Path] = set()
        for root in roots:
            if not root.exists():
                continue
            for skill_file in root.rglob("SKILL.md"):
                if skill_file in seen:
                    continue
                seen.add(skill_file)
                yield skill_file

    @staticmethod
    def _parse_skill_file(skill_file: Path) -> dict[str, str] | None:
        raw_text = skill_file.read_text(encoding="utf-8")
        lines = raw_text.splitlines()

        if lines and lines[0].strip() == "---":
            frontmatter: dict[str, str] = {}
            body_start = 0
            for index, line in enumerate(lines[1:], start=1):
                if line.strip() == "---":
                    body_start = index + 1
                    break
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                frontmatter[key.strip()] = value.strip().strip('"')

            body = "\n".join(lines[body_start:]).strip()
            name = frontmatter.get("name") or skill_file.parent.name
            description = frontmatter.get("description", "")
            return {
                "name": name,
                "description": description,
                "content": body,
            }

        return {
            "name": skill_file.parent.name,
            "description": "",
            "content": raw_text.strip(),
        }

    @staticmethod
    def _matches_query(skill: ResolvedSkill, normalized_query: str) -> bool:
        explicit_name = f"${skill.name.lower()}"
        return explicit_name in normalized_query or skill.name.lower() in normalized_query
