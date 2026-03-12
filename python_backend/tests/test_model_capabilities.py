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
    def test_openai_o1_is_reasoning_capable(self) -> None:
        self.assertTrue(supports_reasoning('openai', 'o1-preview'))

    def test_openai_gpt4o_is_not_reasoning_capable(self) -> None:
        self.assertFalse(supports_reasoning('openai', 'gpt-4o'))

    def test_supported_input_types_default_to_text(self) -> None:
        self.assertEqual(['text'], get_supported_input_types('openai', 'o1-preview'))

    def test_unsupported_models_are_coerced_off(self) -> None:
        normalized = coerce_reasoning_enabled({
            'provider': 'openai',
            'model': 'gpt-4o',
            'enable_reasoning': True,
        })
        self.assertFalse(normalized['enable_reasoning'])


if __name__ == '__main__':
    unittest.main()
