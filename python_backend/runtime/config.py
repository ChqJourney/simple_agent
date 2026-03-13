from typing import Any, Dict, Optional

from llms.capabilities import coerce_reasoning_enabled
from llms.ollama import OLLAMA_DEFAULT_BASE_URL, normalize_ollama_base_url

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "ollama": OLLAMA_DEFAULT_BASE_URL,
}


def _default_base_url(provider: str) -> str:
    return DEFAULT_BASE_URLS.get(provider.lower(), "")


def _to_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return bool(value)


def _normalize_extensions(value: Any) -> list[str]:
    if not isinstance(value, list):
        return [".md", ".txt", ".json"]

    normalized: list[str] = []
    for item in value:
        if item is None:
            continue
        text = str(item).strip().lower()
        if not text:
            continue
        normalized.append(text if text.startswith(".") else f".{text}")

    return normalized or [".md", ".txt", ".json"]


def _normalize_context_providers(data: Dict[str, Any]) -> Dict[str, Any]:
    raw_context = data.get("context_providers") if isinstance(data.get("context_providers"), dict) else {}
    raw_skills = raw_context.get("skills") if isinstance(raw_context.get("skills"), dict) else {}
    raw_retrieval = raw_context.get("retrieval") if isinstance(raw_context.get("retrieval"), dict) else {}

    raw_local_skills = raw_skills.get("local") if isinstance(raw_skills.get("local"), dict) else {}
    raw_workspace_retrieval = (
        raw_retrieval.get("workspace") if isinstance(raw_retrieval.get("workspace"), dict) else {}
    )

    max_hits = _to_int(raw_workspace_retrieval.get("max_hits"))

    return {
        "skills": {
            "local": {
                "enabled": _to_bool(raw_local_skills.get("enabled"), True),
            }
        },
        "retrieval": {
            "workspace": {
                "enabled": _to_bool(raw_workspace_retrieval.get("enabled"), True),
                "max_hits": max_hits if max_hits is not None and max_hits > 0 else 3,
                "extensions": _normalize_extensions(raw_workspace_retrieval.get("extensions")),
            }
        },
    }


def _normalize_profile(
    data: Dict[str, Any],
    *,
    role: str,
    fallback_provider: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not data:
        return None

    provider = str(data.get("provider") or fallback_provider or "openai").strip().lower() or "openai"
    default_model = "gpt-4" if provider == "openai" else ""
    model = str(data.get("model") or default_model).strip()

    if not model:
        return None

    api_key = str(data.get("api_key") or "").strip()
    base_url = str(data.get("base_url") or "").strip() or _default_base_url(provider)

    if provider == "ollama":
        base_url = normalize_ollama_base_url(base_url)

    normalized = coerce_reasoning_enabled(
        {
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "base_url": base_url,
            "enable_reasoning": bool(data.get("enable_reasoning", False)),
            "input_type": data.get("input_type") or "text",
        }
    )
    normalized["provider"] = provider
    normalized["model"] = model
    normalized["api_key"] = api_key
    normalized["base_url"] = base_url
    normalized["profile_name"] = role
    return normalized


def normalize_runtime_config(data: Dict[str, Any]) -> Dict[str, Any]:
    raw_profiles = data.get("profiles") if isinstance(data.get("profiles"), dict) else {}
    primary_input = raw_profiles.get("primary") if isinstance(raw_profiles, dict) else None
    secondary_input = raw_profiles.get("secondary") if isinstance(raw_profiles, dict) else None

    primary_profile = _normalize_profile(
        primary_input if isinstance(primary_input, dict) else data,
        role="primary",
    )
    if primary_profile is None:
        primary_profile = _normalize_profile(data, role="primary", fallback_provider="openai")

    secondary_profile = None
    if isinstance(secondary_input, dict):
        secondary_profile = _normalize_profile(
            secondary_input,
            role="secondary",
            fallback_provider=primary_profile["provider"],
        )

    runtime_input = data.get("runtime") if isinstance(data.get("runtime"), dict) else {}
    runtime = {
        "context_length": _to_int(runtime_input.get("context_length") or data.get("context_length")),
        "max_output_tokens": _to_int(runtime_input.get("max_output_tokens") or data.get("max_output_tokens")),
        "max_tool_rounds": _to_int(runtime_input.get("max_tool_rounds") or data.get("max_tool_rounds")),
        "max_retries": _to_int(runtime_input.get("max_retries") or data.get("max_retries")),
    }
    runtime = {key: value for key, value in runtime.items() if value is not None}

    normalized = {
        **primary_profile,
        "profiles": {
            "primary": primary_profile,
            **({"secondary": secondary_profile} if secondary_profile else {}),
        },
        "runtime": runtime,
        "context_providers": _normalize_context_providers(data),
    }

    return normalized


def get_primary_profile_config(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("profiles")
    if isinstance(profiles, dict):
        primary = profiles.get("primary")
        if isinstance(primary, dict):
            return primary
    return config
