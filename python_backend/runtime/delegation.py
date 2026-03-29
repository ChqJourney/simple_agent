import inspect
import json
from typing import Any, Callable, Dict, Optional

from llms.base import BaseLLM
from runtime.router import build_execution_spec

DELEGATED_TASK_SYSTEM_PROMPT = (
    "You are the background execution model for delegated tasks. "
    "Complete the assigned task using only the provided context. "
    "Always return a strict JSON object with exactly these keys: "
    "`summary` (string) and `data` (object, array, string, number, boolean, or null). "
    "Do not wrap the JSON in markdown fences. "
    "If `expected_output` is `text`, put the main answer in `summary` and use `data` only when structured data is clearly helpful. "
    "If `expected_output` is `json`, put the structured result in `data` and keep `summary` concise."
)

ALLOWED_CONTEXT_KEYS = {"messages", "tool_results", "constraints", "notes"}


def _extract_completion_content(response: Any) -> str:
    if isinstance(response, dict):
        choices = response.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content")
        return content if isinstance(content, str) else ""

    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", "") if message else ""
    return content if isinstance(content, str) else ""


def _strip_json_fence(raw_text: str) -> str:
    cleaned = raw_text.strip()
    if not cleaned.startswith("```"):
        return cleaned

    lines = cleaned.splitlines()
    if lines:
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


async def _close_llm(llm: Optional[BaseLLM]) -> None:
    if llm is None:
        return

    close_candidates = [
        getattr(llm, "aclose", None),
        getattr(llm, "close", None),
    ]
    attempted = set()

    for close_fn in close_candidates:
        if not callable(close_fn):
            continue
        fn_id = id(close_fn)
        if fn_id in attempted:
            continue
        attempted.add(fn_id)
        result = close_fn()
        if inspect.isawaitable(result):
            await result


def _normalize_context(context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(context, dict):
        return {}

    normalized: Dict[str, Any] = {}

    raw_messages = context.get("messages")
    if isinstance(raw_messages, list):
        normalized_messages = []
        for item in raw_messages:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            content = item.get("content")
            if not role or not isinstance(content, str) or not content.strip():
                continue
            normalized_messages.append(
                {
                    "role": role,
                    "content": content.strip(),
                }
            )
        if normalized_messages:
            normalized["messages"] = normalized_messages

    raw_tool_results = context.get("tool_results")
    if isinstance(raw_tool_results, list):
        normalized_tool_results = []
        for item in raw_tool_results:
            if not isinstance(item, dict):
                continue
            tool_name = str(item.get("tool_name") or "").strip()
            summary = str(item.get("summary") or "").strip()
            success = item.get("success")
            if not tool_name and not summary:
                continue
            normalized_item: Dict[str, Any] = {}
            if tool_name:
                normalized_item["tool_name"] = tool_name
            if summary:
                normalized_item["summary"] = summary
            if isinstance(success, bool):
                normalized_item["success"] = success
            normalized_tool_results.append(normalized_item)
        if normalized_tool_results:
            normalized["tool_results"] = normalized_tool_results

    raw_constraints = context.get("constraints")
    if isinstance(raw_constraints, list):
        normalized_constraints = [
            str(item).strip()
            for item in raw_constraints
            if str(item).strip()
        ]
        if normalized_constraints:
            normalized["constraints"] = normalized_constraints

    raw_notes = context.get("notes")
    if isinstance(raw_notes, str) and raw_notes.strip():
        normalized["notes"] = raw_notes.strip()

    return normalized


def _normalize_delegated_response(raw_content: str, expected_output: str) -> Dict[str, Any]:
    cleaned_content = _strip_json_fence(raw_content.strip())
    if not cleaned_content:
        raise ValueError("Delegated task returned an empty response.")

    try:
        parsed_output = json.loads(cleaned_content)
    except json.JSONDecodeError as exc:
        if expected_output == "text":
            return {
                "summary": cleaned_content,
                "data": None,
            }
        raise ValueError("Delegated task must return a JSON object.") from exc

    if not isinstance(parsed_output, dict):
        raise ValueError("Delegated task must return a JSON object.")

    summary = parsed_output.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("Delegated task response must include a non-empty `summary` string.")

    if "data" not in parsed_output:
        raise ValueError("Delegated task response must include a `data` field.")

    return {
        "summary": summary.strip(),
        "data": parsed_output.get("data"),
    }


class DelegatedTaskRunner:
    def __init__(
        self,
        config_getter: Callable[[], Optional[Dict[str, Any]]],
        llm_factory: Callable[[Dict[str, Any]], BaseLLM],
    ) -> None:
        self._config_getter = config_getter
        self._llm_factory = llm_factory

    async def execute(
        self,
        *,
        task: str,
        expected_output: str = "text",
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        config = self._config_getter()
        if not isinstance(config, dict):
            raise ValueError("Delegated task execution requires an active runtime config.")

        execution_spec = build_execution_spec(config, "delegated_task")
        profile = execution_spec.get("profile") if isinstance(execution_spec.get("profile"), dict) else {}
        llm = self._llm_factory(execution_spec)

        try:
            normalized_context = _normalize_context(context)
            response = await llm.complete(
                [
                    {"role": "system", "content": DELEGATED_TASK_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "task": task,
                                "expected_output": expected_output,
                                "allowed_context_keys": sorted(ALLOWED_CONTEXT_KEYS),
                                "context": normalized_context,
                            },
                            ensure_ascii=False,
                        ),
                    },
                ]
            )
            raw_content = _extract_completion_content(response).strip()
            normalized_output = _normalize_delegated_response(raw_content, expected_output)

            return {
                "event": "delegated_task",
                "summary": normalized_output["summary"],
                "data": normalized_output["data"],
                "expected_output": expected_output,
                "context": normalized_context,
                "worker": {
                    "profile_name": str(profile.get("profile_name") or "background"),
                    "provider": str(profile.get("provider") or ""),
                    "model": str(profile.get("model") or ""),
                },
                "runtime": execution_spec.get("runtime"),
            }
        finally:
            await _close_llm(llm)
