from typing import Any, Dict, Optional

from llms.deepseek import DEEPSEEK_DEFAULT_BASE_URL
from llms.glm import GLM_DEFAULT_BASE_URL
from llms.kimi import KIMI_DEFAULT_BASE_URL
from llms.minimax import MINIMAX_DEFAULT_BASE_URL
from llms.capabilities import coerce_reasoning_enabled

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": DEEPSEEK_DEFAULT_BASE_URL,
    "kimi": KIMI_DEFAULT_BASE_URL,
    "glm": GLM_DEFAULT_BASE_URL,
    "minimax": MINIMAX_DEFAULT_BASE_URL,
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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

SUPPORTED_PROVIDERS = {"openai", "deepseek", "kimi", "glm", "minimax", "qwen"}

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
    raw_tools = raw_context.get("tools") if isinstance(raw_context.get("tools"), dict) else {}

    raw_local_skills = raw_skills.get("local") if isinstance(raw_skills.get("local"), dict) else {}
    raw_system_skills = raw_skills.get("system") if isinstance(raw_skills.get("system"), dict) else {}

    def normalize_disabled_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []

        normalized = {
            str(item).strip()
            for item in value
            if str(item).strip()
        }
        return sorted(normalized)

    return {
        "skills": {
            "local": {
                "enabled": _to_bool(raw_local_skills.get("enabled"), True),
            },
            "system": {
                "disabled": normalize_disabled_list(raw_system_skills.get("disabled")),
            },
        },
        "tools": {
            "disabled": normalize_disabled_list(raw_tools.get("disabled")),
        },
    }


def _normalize_reference_library(data: Dict[str, Any]) -> Dict[str, Any]:
    raw_config = data.get("reference_library")
    if not isinstance(raw_config, dict):
        return {"roots": []}

    raw_roots = raw_config.get("roots")
    if not isinstance(raw_roots, list):
        return {"roots": []}

    normalized_roots = []
    allowed_kinds = {"standard", "checklist", "guidance"}
    for root in raw_roots:
        if not isinstance(root, dict):
            continue
        path = str(root.get("path") or "").strip()
        if not path:
            continue
        label = str(root.get("label") or "").strip() or path
        root_id = str(root.get("id") or "").strip() or path
        entry: Dict[str, Any] = {
            "id": root_id,
            "label": label,
            "path": path,
            "enabled": _to_bool(root.get("enabled"), True),
        }
        kinds = root.get("kinds")
        if isinstance(kinds, list):
            normalized_kinds = []
            for kind in kinds:
                normalized = str(kind or "").strip().lower()
                if normalized in allowed_kinds and normalized not in normalized_kinds:
                    normalized_kinds.append(normalized)
            if normalized_kinds:
                entry["kinds"] = normalized_kinds
        normalized_roots.append(entry)

    return {"roots": normalized_roots}


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


def _normalize_provider_catalog(data: Dict[str, Any]) -> Dict[str, list[Dict[str, Any]]]:
    raw_catalog = (
        data.get("provider_catalog")
        if isinstance(data.get("provider_catalog"), dict)
        else {}
    )
    normalized: Dict[str, list[Dict[str, Any]]] = {}

    for provider, entries in raw_catalog.items():
        normalized_provider = str(provider or "").strip().lower()
        if normalized_provider not in SUPPORTED_PROVIDERS or not isinstance(entries, list):
            continue

        normalized_entries: list[Dict[str, Any]] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue

            model_id = str(entry.get("id") or "").strip()
            if not model_id:
                continue

            normalized_entry: Dict[str, Any] = {"id": model_id}
            context_length = _to_int(entry.get("context_length"))
            if isinstance(context_length, int) and context_length > 0:
                normalized_entry["context_length"] = context_length

            supports_image_in = entry.get("supports_image_in")
            if isinstance(supports_image_in, bool):
                normalized_entry["supports_image_in"] = supports_image_in

            image_support = entry.get("image_support")
            if image_support in {"supported", "unsupported", "unknown"}:
                normalized_entry["image_support"] = image_support
            elif isinstance(supports_image_in, bool):
                normalized_entry["image_support"] = (
                    "supported" if supports_image_in else "unsupported"
                )

            reasoning_support = entry.get("reasoning_support")
            if reasoning_support in {"supported", "unsupported", "unknown"}:
                normalized_entry["reasoning_support"] = reasoning_support
            elif isinstance(reasoning_support, bool):
                normalized_entry["reasoning_support"] = (
                    "supported" if reasoning_support else "unsupported"
                )

            reasoning_toggle = entry.get("reasoning_toggle")
            if reasoning_toggle in {"can_toggle", "fixed_on", "fixed_off", "unknown"}:
                normalized_entry["reasoning_toggle"] = reasoning_toggle

            normalized_entries.append(normalized_entry)

        if normalized_entries:
            normalized[normalized_provider] = normalized_entries

    return normalized


def _normalize_profile(
    data: Dict[str, Any],
    *,
    role: str,
    fallback_provider: Optional[str] = None,
    provider_catalog: Optional[Dict[str, list[Dict[str, Any]]]] = None,
) -> Optional[Dict[str, Any]]:
    if not data:
        return None

    provider = str(data.get("provider") or fallback_provider or "openai").strip().lower() or "openai"
    model = str(data.get("model") or "").strip()

    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(f"Unsupported provider: {provider}")

    if not model:
        return None

    api_key = str(data.get("api_key") or "").strip()
    base_url = str(data.get("base_url") or "").strip() or _default_base_url(provider)

    normalized = coerce_reasoning_enabled(
        {
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "base_url": base_url,
            "enable_reasoning": bool(data.get("enable_reasoning", False)),
            "reasoning_mode": data.get("reasoning_mode"),
            "input_type": data.get("input_type") or "text",
            "provider_catalog": provider_catalog or {},
        }
    )
    normalized["provider"] = provider
    normalized["model"] = model
    normalized["api_key"] = api_key
    normalized["base_url"] = base_url
    normalized["profile_name"] = role
    return normalized


def normalize_runtime_config(data: Dict[str, Any]) -> Dict[str, Any]:
    provider_catalog = _normalize_provider_catalog(data)
    raw_profiles = data.get("profiles") if isinstance(data.get("profiles"), dict) else {}
    primary_input = raw_profiles.get("primary") if isinstance(raw_profiles, dict) else None
    background_input = raw_profiles.get("background") if isinstance(raw_profiles, dict) else None

    primary_profile = _normalize_profile(
        primary_input if isinstance(primary_input, dict) else data,
        role="primary",
        provider_catalog=provider_catalog,
    )
    if primary_profile is None:
        primary_profile = _normalize_profile(
            data,
            role="primary",
            fallback_provider="openai",
            provider_catalog=provider_catalog,
        )
    if primary_profile is None:
        raise ValueError("Primary model configuration requires both provider and model.")

    background_profile = None
    if isinstance(background_input, dict):
        background_profile = _normalize_profile(
            background_input,
            role="background",
            fallback_provider=primary_profile["provider"],
            provider_catalog=provider_catalog,
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
        "provider_catalog": provider_catalog,
        "runtime": runtime,
        "appearance": appearance,
        "context_providers": _normalize_context_providers(data),
        "reference_library": _normalize_reference_library(data),
    }

    return normalized


def get_enabled_reference_library_roots(
    config: Optional[Dict[str, Any]],
    *,
    kind: Optional[str] = None,
) -> list[Dict[str, Any]]:
    if not isinstance(config, dict):
        return []

    reference_library = (
        config.get("reference_library")
        if isinstance(config.get("reference_library"), dict)
        else {}
    )
    raw_roots = reference_library.get("roots")
    if not isinstance(raw_roots, list):
        return []

    normalized_kind = str(kind or "").strip().lower()
    selected_roots: list[Dict[str, Any]] = []
    for root in raw_roots:
        if not isinstance(root, dict):
            continue
        if not _to_bool(root.get("enabled"), True):
            continue
        if normalized_kind:
            kinds = root.get("kinds")
            if isinstance(kinds, list) and normalized_kind not in {
                str(item or "").strip().lower()
                for item in kinds
                if str(item or "").strip()
            }:
                continue
        selected_roots.append(root)

    return selected_roots


def get_primary_profile_config(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("profiles")
    if isinstance(profiles, dict):
        primary = profiles.get("primary")
        if isinstance(primary, dict):
            return primary
    return config

def get_disabled_tool_names(config: Optional[Dict[str, Any]]) -> set[str]:
    if not isinstance(config, dict):
        return set()

    context_providers = config.get("context_providers") if isinstance(config.get("context_providers"), dict) else {}
    tools_config = context_providers.get("tools") if isinstance(context_providers.get("tools"), dict) else {}
    disabled = tools_config.get("disabled")
    if not isinstance(disabled, list):
        return set()

    return {
        str(name).strip().lower()
        for name in disabled
        if str(name).strip()
    }


def get_disabled_system_skill_names(config: Optional[Dict[str, Any]]) -> set[str]:
    if not isinstance(config, dict):
        return set()

    context_providers = config.get("context_providers") if isinstance(config.get("context_providers"), dict) else {}
    skills_config = context_providers.get("skills") if isinstance(context_providers.get("skills"), dict) else {}
    system_config = skills_config.get("system") if isinstance(skills_config.get("system"), dict) else {}
    disabled = system_config.get("disabled")
    if not isinstance(disabled, list):
        return set()

    return {
        str(name).strip().casefold()
        for name in disabled
        if str(name).strip()
    }
