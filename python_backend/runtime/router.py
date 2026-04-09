from typing import Any, Dict, Literal, Optional

from llms.capabilities import get_default_context_length, get_supported_input_types, supports_reasoning
from runtime.config import DEFAULT_RUNTIME_POLICY

from runtime.contracts import LockedModelRef

ExecutionRole = Literal["conversation", "background", "compaction", "delegated_task"]


def _get_provider_catalog_entry(
    config: Dict[str, Any], provider: str, model: str
) -> Optional[Dict[str, Any]]:
    raw_catalog = (
        config.get("provider_catalog")
        if isinstance(config.get("provider_catalog"), dict)
        else {}
    )
    provider_entries = (
        raw_catalog.get(str(provider or "").strip().lower())
        if isinstance(raw_catalog, dict)
        else None
    )
    if not isinstance(provider_entries, list):
        return None

    normalized_model = str(model or "").strip()
    for entry in provider_entries:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("id") or "").strip() == normalized_model:
            return entry

    return None


def resolve_conversation_profile(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("profiles") if isinstance(config.get("profiles"), dict) else {}
    primary = profiles.get("primary") if isinstance(profiles.get("primary"), dict) else None
    return primary if isinstance(primary, dict) else config


def resolve_background_profile(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("profiles") if isinstance(config.get("profiles"), dict) else {}
    background = profiles.get("background") if isinstance(profiles.get("background"), dict) else None
    if isinstance(background, dict):
        return background
    return resolve_conversation_profile(config)


def resolve_compaction_profile(config: Dict[str, Any]) -> Dict[str, Any]:
    return resolve_background_profile(config)


def resolve_profile_for_role(config: Dict[str, Any], role: ExecutionRole) -> Dict[str, Any]:
    if role == "conversation":
        return resolve_conversation_profile(config)
    if role in {"background", "compaction", "delegated_task"}:
        return resolve_background_profile(config)
    raise ValueError(f"Unknown execution role: {role}")


def resolve_runtime_policy(config: Dict[str, Any], role: ExecutionRole) -> Dict[str, int]:
    runtime = config.get("runtime") if isinstance(config.get("runtime"), dict) else {}
    shared = runtime.get("shared") if isinstance(runtime.get("shared"), dict) else {}
    role_runtime = runtime.get(role) if isinstance(runtime.get(role), dict) else {}

    return {
        **DEFAULT_RUNTIME_POLICY,
        **shared,
        **role_runtime,
    }

def apply_runtime_guardrails(
    profile: Dict[str, Any],
    runtime_policy: Dict[str, int],
    config: Optional[Dict[str, Any]] = None,
) -> tuple[Dict[str, int], Dict[str, Any]]:
    config = config or {}
    provider = str(profile.get("provider") or "")
    model = str(profile.get("model") or "")
    guarded_runtime = dict(runtime_policy)
    warnings: list[str] = []

    catalog_entry = _get_provider_catalog_entry(config, provider, model)
    catalog_context_length = (
        catalog_entry.get("context_length")
        if isinstance(catalog_entry, dict)
        else None
    )
    known_context_length = (
        catalog_context_length
        if isinstance(catalog_context_length, int) and catalog_context_length > 0
        else get_default_context_length(provider, model)
    )
    requested_context_length = guarded_runtime.get("context_length")
    if (
        isinstance(known_context_length, int)
        and known_context_length > 0
        and isinstance(requested_context_length, int)
        and requested_context_length > known_context_length
    ):
        guarded_runtime["context_length"] = known_context_length
        warnings.append(
            f"context_length {requested_context_length} exceeds known model window {known_context_length}"
        )

    effective_context_length = guarded_runtime.get("context_length")
    requested_max_output_tokens = guarded_runtime.get("max_output_tokens")
    if (
        isinstance(effective_context_length, int)
        and effective_context_length > 0
        and isinstance(requested_max_output_tokens, int)
        and requested_max_output_tokens > effective_context_length
    ):
        guarded_runtime["max_output_tokens"] = effective_context_length
        warnings.append(
            f"max_output_tokens {requested_max_output_tokens} exceeds effective context_length {effective_context_length}"
        )

    return guarded_runtime, {
        "model_context_limit": known_context_length,
        "warnings": warnings,
    }


def resolve_capability_summary(config: Dict[str, Any], role: ExecutionRole) -> Dict[str, Any]:
    profile = resolve_profile_for_role(config, role)
    provider = str(profile.get("provider") or "")
    model = str(profile.get("model") or "")
    catalog_entry = _get_provider_catalog_entry(config, provider, model)
    supports_image_in = (
        catalog_entry.get("supports_image_in")
        if isinstance(catalog_entry, dict)
        else None
    )
    supported_input_types = (
        ["text", "image"]
        if supports_image_in is True
        else ["text"]
        if supports_image_in is False
        else get_supported_input_types(provider, model)
    )

    return {
        "supported_input_types": supported_input_types,
        "reasoning_supported": supports_reasoning(provider, model),
    }


def build_execution_spec(config: Dict[str, Any], role: ExecutionRole) -> Dict[str, Any]:
    profile = resolve_profile_for_role(config, role)
    requested_runtime = resolve_runtime_policy(config, role)
    guarded_runtime, guardrails = apply_runtime_guardrails(profile, requested_runtime, config)
    return {
        "role": role,
        "profile": profile,
        "runtime": guarded_runtime,
        "capability_summary": resolve_capability_summary(config, role),
        "guardrails": {
            **guardrails,
            "requested_runtime": requested_runtime,
        },
    }


def lock_ref_from_profile(profile: Dict[str, Any]) -> LockedModelRef:
    return LockedModelRef(
        profile_name=str(profile.get("profile_name") or "primary"),
        provider=str(profile.get("provider") or ""),
        model=str(profile.get("model") or ""),
    )


def session_lock_matches_profile(locked_model: LockedModelRef, profile: Dict[str, Any]) -> bool:
    return (
        locked_model.provider == str(profile.get("provider") or "")
        and locked_model.model == str(profile.get("model") or "")
    )


def resolve_profile_for_lock(config: Dict[str, Any], locked_model: LockedModelRef) -> Optional[Dict[str, Any]]:
    profiles = config.get("profiles") if isinstance(config.get("profiles"), dict) else {}
    preferred = profiles.get(locked_model.profile_name) if isinstance(profiles.get(locked_model.profile_name), dict) else None

    if preferred and session_lock_matches_profile(locked_model, preferred):
        return preferred

    if session_lock_matches_profile(locked_model, config):
        return config

    return None
