from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

from .base import ResolvedSkill, SkillProvider, SkillSource, SkillSummary

logger = logging.getLogger(__name__)
MAX_SKILL_FILE_SIZE_BYTES = 256 * 1024
APP_DATA_SKILL_DIR_ENV_VAR = "TAURI_AGENT_APP_DATA_DIR"
APP_DIR_ENV_VAR = "TAURI_AGENT_APP_DIR"
APP_PRODUCT_NAME = "tauri_agent"
SKILL_FILE_NAMES = ("SKILL.md", "skill.md")


def default_skill_search_roots() -> List[Path]:
    roots: List[Path] = []
    app_dir = os.getenv(APP_DIR_ENV_VAR, "").strip()
    app_data_dir = os.getenv(APP_DATA_SKILL_DIR_ENV_VAR, "").strip()

    if app_dir:
        roots.append(Path(app_dir) / "skills")

    if app_data_dir:
        app_data_root = Path(app_data_dir) / "skills"
        if app_data_root not in roots:
            roots.append(app_data_root)

    if roots:
        return roots

    if sys.platform == "darwin":
        return [Path.home() / "Library" / "Application Support" / APP_PRODUCT_NAME / "skills"]

    if os.name == "nt":
        base_dir = (
            os.getenv("APPDATA", "").strip()
            or os.getenv("LOCALAPPDATA", "").strip()
        )
        if base_dir:
            return [Path(base_dir) / APP_PRODUCT_NAME / "skills"]
        return [Path.home() / "AppData" / "Roaming" / APP_PRODUCT_NAME / "skills"]

    xdg_data_home = os.getenv("XDG_DATA_HOME", "").strip()
    if xdg_data_home:
        return [Path(xdg_data_home) / APP_PRODUCT_NAME / "skills"]
    return [Path.home() / ".local" / "share" / APP_PRODUCT_NAME / "skills"]


class LocalSkillLoader(SkillProvider):
    def __init__(self, search_roots: Sequence[Path | str] | None = None) -> None:
        roots = default_skill_search_roots() if search_roots is None else search_roots
        self.search_roots = [Path(root) for root in roots]

    def list_skills(self, workspace_path: str = "") -> List[SkillSummary]:
        resolved_by_name: dict[str, SkillSummary] = {}

        for skill_file, source in self._iter_skill_files(workspace_path):
            parsed = self._parse_skill_file(skill_file, source)
            if not parsed:
                continue

            key = parsed.name.casefold()
            current = resolved_by_name.get(key)
            if current is None or self._source_priority(parsed.source) >= self._source_priority(current.source):
                resolved_by_name[key] = parsed

        return sorted(resolved_by_name.values(), key=lambda item: item.name.lower())

    def load(
        self,
        skill_name: str,
        workspace_path: str = "",
        source: Optional[SkillSource] = None,
    ) -> Optional[ResolvedSkill]:
        normalized_skill_name = skill_name.strip().lstrip("$").casefold()
        if not normalized_skill_name:
            return None

        best_match: Optional[ResolvedSkill] = None
        for skill_file, skill_source in self._iter_skill_files(workspace_path):
            parsed = self._parse_skill_file(skill_file, skill_source)
            if not parsed or parsed.name.casefold() != normalized_skill_name:
                continue
            if source and parsed.source != source:
                continue
            if best_match is None or self._source_priority(parsed.source) >= self._source_priority(best_match.source):
                best_match = parsed

        return best_match

    def _iter_skill_files(self, workspace_path: str) -> Iterable[Tuple[Path, SkillSource]]:
        roots = list(self.search_roots)
        if workspace_path:
            roots.append(Path(workspace_path) / ".agent" / "skills")

        seen: set[Path] = set()
        for root in roots:
            source: SkillSource = "workspace" if workspace_path and root == Path(workspace_path) / ".agent" / "skills" else "app"
            if not root.exists():
                continue
            for pattern in SKILL_FILE_NAMES:
                for skill_file in root.rglob(pattern):
                    resolved_file = skill_file.resolve()
                    if resolved_file in seen:
                        continue
                    seen.add(resolved_file)
                    yield resolved_file, source

    @staticmethod
    def _parse_skill_file(skill_file: Path, source: SkillSource) -> ResolvedSkill | None:
        try:
            if skill_file.stat().st_size > MAX_SKILL_FILE_SIZE_BYTES:
                logger.warning("Skipping skill file larger than %s bytes: %s", MAX_SKILL_FILE_SIZE_BYTES, skill_file)
                return None
            raw_text = skill_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            logger.warning("Failed to read skill file %s: %s", skill_file, exc)
            return None

        lines = raw_text.splitlines()

        frontmatter_text = ""
        frontmatter: dict[str, str] = {}
        body = raw_text.strip()

        if lines and lines[0].strip() == "---":
            body_start = 0
            frontmatter_lines: list[str] = []
            for index, line in enumerate(lines[1:], start=1):
                if line.strip() == "---":
                    body_start = index + 1
                    break
                frontmatter_lines.append(line)
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                frontmatter[key.strip()] = value.strip().strip('"').strip("'")

            frontmatter_text = "\n".join(frontmatter_lines).strip()
            body = "\n".join(lines[body_start:]).strip()

        name = frontmatter.get("name") or skill_file.parent.name
        description = frontmatter.get("description", "")

        if not frontmatter_text:
            frontmatter_text = f'name: {name}\ndescription: "{description}"'

        return ResolvedSkill(
            name=name,
            description=description,
            content=body,
            frontmatter=frontmatter_text,
            source_path=str(skill_file),
            source=source,
            metadata=frontmatter,
        )

    @staticmethod
    def _source_priority(source: SkillSource) -> int:
        return 1 if source == "workspace" else 0
