from __future__ import annotations

from typing import Any, Dict, List, Optional

TEXT_ONLY_INPUT_TYPES = ['text']
IMAGE_AND_TEXT_INPUT_TYPES = ['text', 'image']


OPENAI_REASONING_PREFIXES = (
    'o1',
    'o3',
    'o4',
    'gpt-5',
)
KIMI_REASONING_PREFIXES = (
    'kimi-k2.5',
    'kimi-k2-thinking',
)
GLM_REASONING_PREFIXES = (
    'glm-5',
    'glm-4.7',
    'glm-4.6',
)
QWEN_REASONING_PREFIXES = (
    'qwen3',
    'qwq',
)
DEEPSEEK_REASONING_PREFIXES = (
    'deepseek-reasoner',
    'deepseek-v4-',
)
MINIMAX_REASONING_PREFIXES = tuple()
OPENAI_VISION_PREFIXES = (
    'gpt-4o',
    'gpt-4.1',
    'gpt-5',
)
KIMI_VISION_PREFIXES = (
    'kimi-k2.5','kimi-k2-thinking',
)
GLM_VISION_PREFIXES = (
    'glm-4.6v',
)
QWEN_VISION_PREFIXES = (
    'qvq','qwen3.5','qwen3.5-plus', 'qwen3.5-plus-2026-02-15',
)
MINIMAX_VISION_PREFIXES = tuple()
DEFAULT_CONTEXT_LENGTH_PREFIXES = {
    'openai': {
        'gpt-4o': 128000,
        'gpt-4-turbo': 128000,
        'o1': 128000,
        'o3': 128000,
        'o4': 128000,
        'gpt-5': 128000,
    },
    'deepseek': {
        'deepseek-chat': 128000,
        'deepseek-reasoner': 128000,
    },
    'kimi': {
        'kimi-k2.5': 256000,
        'kimi-k2-thinking': 256000,

    },
    'glm': {
        'glm-5': 256000,
        'glm-4.7': 128000,
        'glm-4.6': 128000,
    },
    'minimax': {
        'minimax-m2': 200000,
        'minimax-m2.5': 256000,
        'minimax-m2.7': 256000,
    },
    'qwen': {
        'qwen3-max-2026-01-23': 128000,
        'qwen3.5-plus': 256000,
        'qwen3.5-plus-2026-02-15': 256000,
        'qwen3-coder-next': 128000,
    },
}


def _normalize_provider(provider: str) -> str:
    return str(provider or '').strip().lower()


def _normalize_model(model: str) -> str:
    return str(model or '').strip().lower()


def _matches_prefix(model: str, prefixes: tuple[str, ...]) -> bool:
    return any(model.startswith(prefix) for prefix in prefixes)


def supports_reasoning(provider: str, model: str) -> bool:
    normalized_provider = _normalize_provider(provider)
    normalized_model = _normalize_model(model)

    if normalized_provider == 'openai':
        return _matches_prefix(normalized_model, OPENAI_REASONING_PREFIXES)
    if normalized_provider == 'kimi':
        return _matches_prefix(normalized_model, KIMI_REASONING_PREFIXES)
    if normalized_provider == 'glm':
        return _matches_prefix(normalized_model, GLM_REASONING_PREFIXES)
    if normalized_provider == 'deepseek':
        return _matches_prefix(normalized_model, DEEPSEEK_REASONING_PREFIXES)
    if normalized_provider == 'minimax':
        return _matches_prefix(normalized_model, MINIMAX_REASONING_PREFIXES)
    if normalized_provider == 'qwen':
        return _matches_prefix(normalized_model, QWEN_REASONING_PREFIXES)
    return False


def normalize_reasoning_mode(value: Any, fallback: str = "default") -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"default", "on", "off"}:
        return normalized
    return fallback


def _find_provider_catalog_entry(
    config: Optional[Dict[str, Any]],
    provider: str,
    model: str,
) -> Optional[Dict[str, Any]]:
    if not isinstance(config, dict):
        return None

    raw_catalog = (
        config.get('provider_catalog')
        if isinstance(config.get('provider_catalog'), dict)
        else {}
    )
    provider_entries = raw_catalog.get(_normalize_provider(provider))
    if not isinstance(provider_entries, list):
        return None

    normalized_model = str(model or '').strip()
    for entry in provider_entries:
        if not isinstance(entry, dict):
            continue
        if str(entry.get('id') or '').strip() == normalized_model:
            return entry

    return None


def resolve_reasoning_support(
    config: Optional[Dict[str, Any]],
    provider: str,
    model: str,
) -> str:
    catalog_entry = _find_provider_catalog_entry(config, provider, model)
    if isinstance(catalog_entry, dict):
        catalog_reasoning = catalog_entry.get('reasoning_support')
        if catalog_reasoning in {'supported', 'unsupported', 'unknown'}:
            return str(catalog_reasoning)
        if isinstance(catalog_reasoning, bool):
            return 'supported' if catalog_reasoning else 'unsupported'

        catalog_toggle = catalog_entry.get('reasoning_toggle')
        if catalog_toggle in {'can_toggle', 'fixed_on'}:
            return 'supported'
        if catalog_toggle == 'fixed_off':
            return 'unsupported'

    return 'unknown'


def resolve_reasoning_toggle(
    config: Optional[Dict[str, Any]],
    provider: str,
    model: str,
) -> str:
    catalog_entry = _find_provider_catalog_entry(config, provider, model)
    if isinstance(catalog_entry, dict):
        catalog_toggle = catalog_entry.get('reasoning_toggle')
        if catalog_toggle in {'can_toggle', 'fixed_on', 'fixed_off', 'unknown'}:
            return str(catalog_toggle)
    return 'unknown'


def resolve_reasoning_mode(config: Optional[Dict[str, Any]]) -> str:
    if not isinstance(config, dict):
        return "default"

    explicit_mode = normalize_reasoning_mode(config.get("reasoning_mode"), "")
    if explicit_mode:
        return explicit_mode

    return "on" if bool(config.get("enable_reasoning", False)) else "default"


def resolve_image_support(
    config: Optional[Dict[str, Any]],
    provider: str,
    model: str,
) -> str:
    catalog_entry = _find_provider_catalog_entry(config, provider, model)
    if isinstance(catalog_entry, dict):
        image_support = catalog_entry.get("image_support")
        if image_support in {"supported", "unsupported", "unknown"}:
            return str(image_support)
        supports_image_in = catalog_entry.get("supports_image_in")
        if isinstance(supports_image_in, bool):
            return "supported" if supports_image_in else "unsupported"
    return "unknown"


def normalize_input_type(value: Any, fallback: str = "text") -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"text", "image"}:
        return normalized
    return fallback


def resolve_input_type(config: Optional[Dict[str, Any]]) -> str:
    if not isinstance(config, dict):
        return "text"

    normalized = normalize_input_type(config.get("input_type"), "")
    if normalized:
        return normalized

    provider = str(config.get("provider") or "")
    model = str(config.get("model") or "")
    image_support = resolve_image_support(config, provider, model)
    return "image" if image_support == "supported" else "text"


def get_supported_input_types(provider: str, model: str) -> List[str]:
    normalized_provider = _normalize_provider(provider)
    normalized_model = _normalize_model(model)

    if normalized_provider == 'openai' and _matches_prefix(normalized_model, OPENAI_VISION_PREFIXES):
        return IMAGE_AND_TEXT_INPUT_TYPES.copy()
    if normalized_provider == 'kimi' and _matches_prefix(normalized_model, KIMI_VISION_PREFIXES):
        return IMAGE_AND_TEXT_INPUT_TYPES.copy()
    if normalized_provider == 'glm' and _matches_prefix(normalized_model, GLM_VISION_PREFIXES):
        return IMAGE_AND_TEXT_INPUT_TYPES.copy()
    if normalized_provider == 'deepseek':
        return TEXT_ONLY_INPUT_TYPES.copy()
    if normalized_provider == 'minimax':
        if _matches_prefix(normalized_model, MINIMAX_VISION_PREFIXES):
            return IMAGE_AND_TEXT_INPUT_TYPES.copy()
        return TEXT_ONLY_INPUT_TYPES.copy()
    if normalized_provider == 'qwen' and _matches_prefix(normalized_model, QWEN_VISION_PREFIXES):
        return IMAGE_AND_TEXT_INPUT_TYPES.copy()
    return TEXT_ONLY_INPUT_TYPES.copy()


def coerce_reasoning_enabled(config: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(config)
    provider = normalized.get('provider', '')
    model = normalized.get('model', '')
    reasoning_mode = resolve_reasoning_mode(normalized)
    reasoning_support = resolve_reasoning_support(normalized, provider, model)
    reasoning_toggle = resolve_reasoning_toggle(normalized, provider, model)

    if reasoning_toggle == 'fixed_on':
        reasoning_mode = 'on'
    elif reasoning_toggle == 'fixed_off' or reasoning_support == 'unsupported':
        reasoning_mode = 'off'

    normalized['reasoning_mode'] = reasoning_mode
    normalized['enable_reasoning'] = reasoning_mode == 'on'
    input_type = resolve_input_type(normalized)
    image_support = resolve_image_support(normalized, provider, model)
    if image_support == 'unsupported':
        input_type = 'text'
    normalized['input_type'] = normalize_input_type(input_type, 'text')
    return normalized


def get_default_context_length(provider: str, model: str) -> Optional[int]:
    normalized_provider = _normalize_provider(provider)
    normalized_model = _normalize_model(model)

    provider_defaults = DEFAULT_CONTEXT_LENGTH_PREFIXES.get(normalized_provider, {})
    for prefix, context_length in provider_defaults.items():
        if normalized_model.startswith(prefix):
            return context_length
    return None


def get_openai_reasoning_effort(reasoning_mode: str) -> str | None:
    normalized_mode = normalize_reasoning_mode(reasoning_mode)
    if normalized_mode == 'on':
        return 'medium'
    if normalized_mode == 'off':
        return 'minimal'
    return None
