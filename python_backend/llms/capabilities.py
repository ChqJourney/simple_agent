from __future__ import annotations

from typing import Any, Dict, List

TEXT_ONLY_INPUT_TYPES = ['text']
IMAGE_AND_TEXT_INPUT_TYPES = ['text', 'image']


OPENAI_REASONING_PREFIXES = (
    'o1',
    'o3',
    'o4',
    'gpt-5',
)
QWEN_REASONING_PREFIXES = (
    'qwen3',
    'qwq',
)
OLLAMA_REASONING_PREFIXES = (
    'qwen3',
    'deepseek-r1',
    'magistral',
    'phi4-reasoning',
)
OPENAI_VISION_PREFIXES = (
    'gpt-4o',
    'gpt-4.1',
    'gpt-5',
)
QWEN_VISION_PREFIXES = (
    'qvq',
)
OLLAMA_VISION_PREFIXES = tuple()


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
    if normalized_provider == 'qwen':
        return _matches_prefix(normalized_model, QWEN_REASONING_PREFIXES)
    if normalized_provider == 'ollama':
        return _matches_prefix(normalized_model, OLLAMA_REASONING_PREFIXES)
    return False


def get_supported_input_types(provider: str, model: str) -> List[str]:
    normalized_provider = _normalize_provider(provider)
    normalized_model = _normalize_model(model)

    if normalized_provider == 'openai' and _matches_prefix(normalized_model, OPENAI_VISION_PREFIXES):
        return IMAGE_AND_TEXT_INPUT_TYPES.copy()
    if normalized_provider == 'qwen' and _matches_prefix(normalized_model, QWEN_VISION_PREFIXES):
        return IMAGE_AND_TEXT_INPUT_TYPES.copy()
    if normalized_provider == 'ollama' and _matches_prefix(normalized_model, OLLAMA_VISION_PREFIXES):
        return IMAGE_AND_TEXT_INPUT_TYPES.copy()
    return TEXT_ONLY_INPUT_TYPES.copy()


def coerce_reasoning_enabled(config: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(config)
    provider = normalized.get('provider', '')
    model = normalized.get('model', '')
    normalized['enable_reasoning'] = bool(normalized.get('enable_reasoning', False)) and supports_reasoning(provider, model)
    normalized['input_type'] = str(normalized.get('input_type') or 'text').strip().lower() or 'text'
    if normalized['input_type'] not in get_supported_input_types(provider, model):
        normalized['input_type'] = 'text'
    return normalized


def get_openai_reasoning_effort(model: str, enabled: bool) -> str | None:
    normalized_model = _normalize_model(model)
    if not supports_reasoning('openai', normalized_model):
        return None
    if enabled:
        return 'medium'
    if normalized_model.startswith('gpt-5'):
        return 'none'
    return 'minimal'
