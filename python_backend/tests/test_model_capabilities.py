import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from llms.capabilities import (
    coerce_reasoning_enabled,
    get_supported_input_types,
    resolve_reasoning_mode,
    resolve_reasoning_support,
    supports_reasoning,
)


class ModelCapabilitiesTests(unittest.TestCase):
    def test_reasoning_support_matches_known_model_families(self) -> None:
        cases = [
            ("openai", "o1-preview", True),
            ("openai", "gpt-4o", False),
            ("deepseek", "deepseek-v4-pro", True),
        ]

        for provider, model, expected in cases:
            with self.subTest(provider=provider, model=model):
                self.assertEqual(expected, supports_reasoning(provider, model))

    def test_supported_input_types_default_to_text(self) -> None:
        self.assertEqual(['text'], get_supported_input_types('openai', 'o1-preview'))

    def test_known_vision_models_allow_image_input(self) -> None:
        for provider, model in [
            ('openai', 'gpt-4o'),
            ('kimi', 'kimi-k2.5'),
            ('glm', 'glm-4.6v'),
        ]:
            with self.subTest(provider=provider, model=model):
                self.assertEqual(['text', 'image'], get_supported_input_types(provider, model))

    def test_unknown_models_stay_text_only(self) -> None:
        for provider, model in [
            ('qwen', 'qwen-plus'),
            ('minimax', 'MiniMax-M2.5'),
        ]:
            with self.subTest(provider=provider, model=model):
                self.assertEqual(['text'], get_supported_input_types(provider, model))

    def test_reasoning_mode_defaults_to_provider_default_when_unspecified(self) -> None:
        normalized = coerce_reasoning_enabled({
            'provider': 'openai',
            'model': 'gpt-4o',
            'enable_reasoning': False,
        })

        self.assertEqual('default', normalized['reasoning_mode'])
        self.assertFalse(normalized['enable_reasoning'])

    def test_reasoning_mode_preserves_explicit_override_when_support_is_unknown(self) -> None:
        normalized = coerce_reasoning_enabled({
            'provider': 'openai',
            'model': 'gpt-4o',
            'reasoning_mode': 'on',
        })

        self.assertEqual('on', resolve_reasoning_mode(normalized))
        self.assertTrue(normalized['enable_reasoning'])
        self.assertEqual('unknown', resolve_reasoning_support(normalized, 'openai', 'gpt-4o'))


if __name__ == '__main__':
    unittest.main()
