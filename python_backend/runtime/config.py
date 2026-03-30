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
    "timeout_seconds": 120,
}

DEFAULT_APPEARANCE = {
    "base_font_size": 16,
}

DEFAULT_OCR_CONFIG = {
    "enabled": False,
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


def _normalize_ocr_config(data: Dict[str, Any]) -> Dict[str, bool]:
    raw_ocr = data.get("ocr") if isinstance(data.get("ocr"), dict) else {}
    return {
        "enabled": _to_bool(raw_ocr.get("enabled"), DEFAULT_OCR_CONFIG["enabled"]),
    }


def _normalize_runtime_policy(data: Dict[str, Any]) -> Dict[str, Any]:
    def normalize_runtime_value(source: Dict[str, Any], key: str, fallback: Optional[int] = None) -> Optional[int]:
        candidate = _to_int(source.get(key))
        if candidate is None or candidate <= 0:
            return fallback
        return candidate

    runtime_input = data.get("runtime") if isinstance(data.get("runtime"), dict) else {}
    shared_input = runtime_input.get("shared") if isinstance(runtime_input.get("shared"), dict) else {}

    shared = {
        "context_length": normalize_runtime_value(shared_input, "context_length", DEFAULT_RUNTIME_POLICY["context_length"]),
        "max_output_tokens": normalize_runtime_value(shared_input, "max_output_tokens", DEFAULT_RUNTIME_POLICY["max_output_tokens"]),
        "max_tool_rounds": normalize_runtime_value(shared_input, "max_tool_rounds", DEFAULT_RUNTIME_POLICY["max_tool_rounds"]),
        "max_retries": normalize_runtime_value(shared_input, "max_retries", DEFAULT_RUNTIME_POLICY["max_retries"]),
        "timeout_seconds": normalize_runtime_value(shared_input, "timeout_seconds", DEFAULT_RUNTIME_POLICY["timeout_seconds"]),
    }

    def normalize_override(role: str) -> Optional[Dict[str, int]]:
        role_input = runtime_input.get(role) if isinstance(runtime_input.get(role), dict) else {}
        normalized = {
            key: normalize_runtime_value(role_input, key)
            for key in DEFAULT_RUNTIME_POLICY.keys()
        }
        normalized = {
            key: value
            for key, value in normalized.items()
            if isinstance(value, int) and value > 0
        }
        return normalized or None

    conversation = normalize_override("conversation")
    background = normalize_override("background")
    compaction = normalize_override("compaction")
    delegated_task = normalize_override("delegated_task")

    return {
        "shared": shared,
        **({"conversation": conversation} if conversation else {}),
        **({"background": background} if background else {}),
        **({"compaction": compaction} if compaction else {}),
        **({"delegated_task": delegated_task} if delegated_task else {}),
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


def _normalize_system_prompt(data: Dict[str, Any]) -> str:
    raw_value = data.get("system_prompt")
    if raw_value is None:
        return ""
    return str(raw_value).strip()


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
    background_input = raw_profiles.get("background") if isinstance(raw_profiles, dict) else None

    primary_profile = _normalize_profile(
        primary_input if isinstance(primary_input, dict) else data,
        role="primary",
    )
    if primary_profile is None:
        primary_profile = _normalize_profile(data, role="primary", fallback_provider="openai")
    if primary_profile is None:
        raise ValueError("Primary model configuration requires both provider and model.")

    background_profile = None
    if isinstance(background_input, dict):
        background_profile = _normalize_profile(
            background_input,
            role="background",
            fallback_provider=primary_profile["provider"],
        )

    runtime = _normalize_runtime_policy(data)
    appearance = _normalize_appearance(data)

    normalized = {
        **primary_profile,
        "profiles": {
            "primary": primary_profile,
            **({"background": background_profile} if background_profile else {}),
        },
        "system_prompt": _normalize_system_prompt(data),
        "runtime": runtime,
        "appearance": appearance,
        "context_providers": _normalize_context_providers(data),
        "ocr": _normalize_ocr_config(data),
    }

    return normalized


def get_primary_profile_config(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("profiles")
    if isinstance(profiles, dict):
        primary = profiles.get("primary")
        if isinstance(primary, dict):
            return primary
    return config


def is_ocr_enabled(config: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(config, dict):
        return False

    ocr_config = config.get("ocr") if isinstance(config.get("ocr"), dict) else {}
    return bool(ocr_config.get("enabled", DEFAULT_OCR_CONFIG["enabled"]))
