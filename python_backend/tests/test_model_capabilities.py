import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from llms.capabilities import (
    coerce_reasoning_enabled,
    get_supported_input_types,
    supports_reasoning,
)


class ModelCapabilitiesTests(unittest.TestCase):
    def test_reasoning_support_matches_known_model_families(self) -> None:
        cases = [
            ("openai", "o1-preview", True),
            ("openai", "gpt-4o", False),
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

    def test_unsupported_models_are_coerced_off(self) -> None:
        for provider, model in [
            ('openai', 'gpt-4o'),
            ('minimax', 'MiniMax-M2.7'),
        ]:
            with self.subTest(provider=provider, model=model):
                normalized = coerce_reasoning_enabled({
                    'provider': provider,
                    'model': model,
                    'enable_reasoning': True,
                })
                self.assertFalse(normalized['enable_reasoning'])


if __name__ == '__main__':
    unittest.main()
