from typing import Any, Dict, Optional

from runtime.contracts import LockedModelRef


def resolve_conversation_profile(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("profiles") if isinstance(config.get("profiles"), dict) else {}
    primary = profiles.get("primary") if isinstance(profiles.get("primary"), dict) else None
    return primary if isinstance(primary, dict) else config


def resolve_background_profile(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("profiles") if isinstance(config.get("profiles"), dict) else {}
    secondary = profiles.get("secondary") if isinstance(profiles.get("secondary"), dict) else None
    if isinstance(secondary, dict):
        return secondary
    return resolve_conversation_profile(config)


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
