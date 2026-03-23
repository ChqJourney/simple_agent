from typing import Any, Dict, Optional

from llms.deepseek import DEEPSEEK_DEFAULT_BASE_URL
from llms.glm import GLM_DEFAULT_BASE_URL
from llms.kimi import KIMI_DEFAULT_BASE_URL
from llms.minimax import MINIMAX_DEFAULT_BASE_URL
from llms.capabilities import coerce_reasoning_enabled
from llms.ollama import OLLAMA_DEFAULT_BASE_URL, normalize_ollama_base_url

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": DEEPSEEK_DEFAULT_BASE_URL,
    "kimi": KIMI_DEFAULT_BASE_URL,
    "glm": GLM_DEFAULT_BASE_URL,
    "minimax": MINIMAX_DEFAULT_BASE_URL,
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "ollama": OLLAMA_DEFAULT_BASE_URL,
}

DEFAULT_RUNTIME_POLICY = {
    "context_length": 64000,
    "max_output_tokens": 4000,
    "max_tool_rounds": 20,
    "max_retries": 3,
}

DEFAULT_APPEARANCE = {
    "base_font_size": 16,
}

MIN_BASE_FONT_SIZE = 12
MAX_BASE_FONT_SIZE = 20


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

def _normalize_context_providers(data: Dict[str, Any]) -> Dict[str, Any]:
    raw_context = data.get("context_providers") if isinstance(data.get("context_providers"), dict) else {}
    raw_skills = raw_context.get("skills") if isinstance(raw_context.get("skills"), dict) else {}

    raw_local_skills = raw_skills.get("local") if isinstance(raw_skills.get("local"), dict) else {}

    return {
        "skills": {
            "local": {
                "enabled": _to_bool(raw_local_skills.get("enabled"), True),
            }
        },
    }


def _normalize_runtime_policy(data: Dict[str, Any]) -> Dict[str, int]:
    runtime_input = data.get("runtime") if isinstance(data.get("runtime"), dict) else {}

    def normalize_runtime_value(key: str) -> int:
        candidate = _to_int(runtime_input.get(key))
        if candidate is None:
            candidate = _to_int(data.get(key))
        if candidate is None or candidate <= 0:
            return DEFAULT_RUNTIME_POLICY[key]
        return candidate

    return {
        "context_length": normalize_runtime_value("context_length"),
        "max_output_tokens": normalize_runtime_value("max_output_tokens"),
        "max_tool_rounds": normalize_runtime_value("max_tool_rounds"),
        "max_retries": normalize_runtime_value("max_retries"),
    }


def _normalize_appearance(data: Dict[str, Any]) -> Dict[str, int]:
    raw_appearance = data.get("appearance") if isinstance(data.get("appearance"), dict) else {}
    base_font_size = _to_int(raw_appearance.get("base_font_size"))
    if base_font_size is None:
        base_font_size = DEFAULT_APPEARANCE["base_font_size"]

    base_font_size = max(MIN_BASE_FONT_SIZE, min(MAX_BASE_FONT_SIZE, base_font_size))

    return {
        "base_font_size": base_font_size,
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
    model = str(data.get("model") or "").strip()

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
    if primary_profile is None:
        raise ValueError("Primary model configuration requires both provider and model.")

    secondary_profile = None
    if isinstance(secondary_input, dict):
        secondary_profile = _normalize_profile(
            secondary_input,
            role="secondary",
            fallback_provider=primary_profile["provider"],
        )

    runtime = _normalize_runtime_policy(data)
    appearance = _normalize_appearance(data)

    normalized = {
        **primary_profile,
        "profiles": {
            "primary": primary_profile,
            **({"secondary": secondary_profile} if secondary_profile else {}),
        },
        "runtime": runtime,
        "appearance": appearance,
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
