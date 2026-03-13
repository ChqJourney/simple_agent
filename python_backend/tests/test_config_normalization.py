import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main as backend_main
from llms.deepseek import DeepSeekLLM
from llms.ollama import OLLAMA_DEFAULT_BASE_URL, OllamaLLM


class ConfigNormalizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_handle_config_falls_back_to_provider_default_base_url_when_blank(self) -> None:
        captured_configs = []
        messages = []
        original_create_llm = backend_main.create_llm
        original_runtime_state = backend_main.runtime_state

        try:
            def fake_create_llm(config):
                captured_configs.append(config)
                return object()

            async def send_callback(message):
                messages.append(message)

            backend_main.create_llm = fake_create_llm
            backend_main.runtime_state = backend_main.BackendRuntimeState()

            await backend_main.handle_config(
                {
                    'provider': 'openai',
                    'model': 'gpt-4o-mini',
                    'api_key': 'test-key',
                    'base_url': '   ',
                    'enable_reasoning': False,
                },
                send_callback,
            )

            self.assertEqual(1, len(captured_configs))
            self.assertEqual(
                'https://api.openai.com/v1',
                captured_configs[0]['base_url'],
            )
            self.assertEqual(
                'https://api.openai.com/v1',
                backend_main.runtime_state.current_config['base_url'],
            )
            self.assertIn(
                {
                    'type': 'config_updated',
                    'provider': 'openai',
                    'model': 'gpt-4o-mini',
                },
                messages,
            )
        finally:
            backend_main.create_llm = original_create_llm
            backend_main.runtime_state = original_runtime_state

    async def test_handle_config_normalizes_ollama_v1_suffix(self) -> None:
        captured_configs = []
        original_create_llm = backend_main.create_llm
        original_runtime_state = backend_main.runtime_state

        try:
            def fake_create_llm(config):
                captured_configs.append(config)
                return object()

            async def send_callback(_message):
                return None

            backend_main.create_llm = fake_create_llm
            backend_main.runtime_state = backend_main.BackendRuntimeState()

            await backend_main.handle_config(
                {
                    'provider': 'ollama',
                    'model': 'qwen3:8b',
                    'api_key': '',
                    'base_url': 'http://127.0.0.1:11434/v1/',
                    'enable_reasoning': False,
                },
                send_callback,
            )

            self.assertEqual(1, len(captured_configs))
            self.assertEqual(
                'http://127.0.0.1:11434',
                captured_configs[0]['base_url'],
            )
            self.assertEqual(
                'http://127.0.0.1:11434',
                backend_main.runtime_state.current_config['base_url'],
            )
        finally:
            backend_main.create_llm = original_create_llm
            backend_main.runtime_state = original_runtime_state

    async def test_handle_config_coerces_unsupported_reasoning_off_and_defaults_input_type(self) -> None:
        captured_configs = []
        original_create_llm = backend_main.create_llm
        original_runtime_state = backend_main.runtime_state

        try:
            def fake_create_llm(config):
                captured_configs.append(config)
                return object()

            async def send_callback(_message):
                return None

            backend_main.create_llm = fake_create_llm
            backend_main.runtime_state = backend_main.BackendRuntimeState()

            await backend_main.handle_config(
                {
                    'provider': 'openai',
                    'model': 'gpt-4o',
                    'api_key': 'test-key',
                    'base_url': 'https://api.openai.com/v1',
                    'enable_reasoning': True,
                },
                send_callback,
            )

            self.assertFalse(captured_configs[0]['enable_reasoning'])
            self.assertEqual('text', captured_configs[0]['input_type'])
        finally:
            backend_main.create_llm = original_create_llm
            backend_main.runtime_state = original_runtime_state

    def test_ollama_llm_normalizes_blank_and_v1_base_urls(self) -> None:
        blank = OllamaLLM({'model': 'qwen3:8b', 'base_url': '   '})
        with_v1 = OllamaLLM({'model': 'qwen3:8b', 'base_url': 'http://localhost:11434/v1'})

        self.assertEqual(OLLAMA_DEFAULT_BASE_URL, blank.base_url)
        self.assertEqual('http://localhost:11434', with_v1.base_url)

    def test_create_llm_for_profile_supports_deepseek(self) -> None:
        llm = backend_main.create_llm_for_profile(
            {
                'provider': 'deepseek',
                'model': 'deepseek-chat',
                'api_key': 'test-key',
                'base_url': 'https://api.deepseek.com',
            }
        )

        self.assertIsInstance(llm, DeepSeekLLM)


if __name__ == '__main__':
    unittest.main()
