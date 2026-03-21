import json
import logging
import time
from pathlib import Path

from core.user import validate_session_id
from runtime.events import RunEvent

logger = logging.getLogger(__name__)
LOG_WRITE_MAX_ATTEMPTS = 3
LOG_WRITE_RETRY_DELAYS_SECONDS = (0.05, 0.1)


def append_run_event(workspace_path: str, session_id: str, event: RunEvent) -> None:
    safe_session_id = validate_session_id(session_id)
    log_path = Path(workspace_path) / ".agent" / "logs" / f"{safe_session_id}.jsonl"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    payload = json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n"

    for attempt in range(LOG_WRITE_MAX_ATTEMPTS):
        try:
            with log_path.open("a", encoding="utf-8") as file:
                file.write(payload)
            return
        except Exception:
            is_final_attempt = attempt == LOG_WRITE_MAX_ATTEMPTS - 1
            if is_final_attempt:
                logger.exception("Failed to append run event log after %s attempts", LOG_WRITE_MAX_ATTEMPTS)
                return

            logger.warning(
                "Failed to append run event log (attempt %s/%s); retrying",
                attempt + 1,
                LOG_WRITE_MAX_ATTEMPTS,
            )
            time.sleep(LOG_WRITE_RETRY_DELAYS_SECONDS[min(attempt, len(LOG_WRITE_RETRY_DELAYS_SECONDS) - 1)])
