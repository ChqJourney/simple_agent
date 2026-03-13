from typing import Any, Dict

from runtime.contracts import LockedModelRef


def resolve_profile_for_task(config: Dict[str, Any], task_kind: str = "default") -> Dict[str, Any]:
    profiles = config.get("profiles") if isinstance(config.get("profiles"), dict) else {}
    primary = profiles.get("primary") if isinstance(profiles.get("primary"), dict) else config
    secondary = profiles.get("secondary") if isinstance(profiles.get("secondary"), dict) else None

    if task_kind == "simple" and secondary:
      return secondary

    return primary


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
