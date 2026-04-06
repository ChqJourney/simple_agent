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
    normalized['enable_reasoning'] = bool(normalized.get('enable_reasoning', False)) and supports_reasoning(provider, model)
    normalized['input_type'] = str(normalized.get('input_type') or 'text').strip().lower() or 'text'
    if normalized['input_type'] not in get_supported_input_types(provider, model):
        normalized['input_type'] = 'text'
    return normalized


def get_default_context_length(provider: str, model: str) -> Optional[int]:
    normalized_provider = _normalize_provider(provider)
    normalized_model = _normalize_model(model)

    provider_defaults = DEFAULT_CONTEXT_LENGTH_PREFIXES.get(normalized_provider, {})
    for prefix, context_length in provider_defaults.items():
        if normalized_model.startswith(prefix):
            return context_length
    return None


def get_openai_reasoning_effort(model: str, enabled: bool) -> str | None:
    normalized_model = _normalize_model(model)
    if not supports_reasoning('openai', normalized_model):
        return None
    if enabled:
        return 'medium'
    if normalized_model.startswith('gpt-5'):
        return 'none'
    return 'minimal'
