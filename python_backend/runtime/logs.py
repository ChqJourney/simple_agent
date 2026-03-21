import json
import logging
from pathlib import Path

from core.user import validate_session_id
from runtime.events import RunEvent

logger = logging.getLogger(__name__)


def append_run_event(workspace_path: str, session_id: str, event: RunEvent) -> None:
    safe_session_id = validate_session_id(session_id)
    log_path = Path(workspace_path) / ".agent" / "logs" / f"{safe_session_id}.jsonl"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with log_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n")
    except Exception as exc:
        logger.error("Failed to append run event log: %s", exc)
