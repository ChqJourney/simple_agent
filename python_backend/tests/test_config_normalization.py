import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main as backend_main
from llms.deepseek import DeepSeekLLM
from llms.glm import GLMLLM
from llms.kimi import KimiLLM
from llms.minimax import MiniMaxLLM


class ConfigNormalizationTests(unittest.IsolatedAsyncioTestCase):
    def test_tool_visibility_follows_disabled_tool_config(self) -> None:
        self.assertTrue(
            backend_main._is_tool_enabled_for_config(
                "file_read",
                None,
            )
        )
        self.assertFalse(
            backend_main._is_tool_enabled_for_config(
                "file_read",
                {"context_providers": {"tools": {"disabled": ["file_read"]}}},
            )
        )

    async def test_handle_config_falls_back_to_provider_default_base_url_when_blank(self) -> None:
        captured_configs = []
        messages = []
        original_create_llm = backend_main.create_llm
        original_runtime_state = backend_main.runtime_state
        delegate_tool = backend_main.tool_registry.get_tool("delegate_task")
        original_delegate_timeout = delegate_tool.policy.timeout_seconds if delegate_tool is not None else None

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
            self.assertEqual(120, delegate_tool.policy.timeout_seconds if delegate_tool is not None else None)
            config_updated = next(message for message in messages if message.get('type') == 'config_updated')
            self.assertEqual('openai', config_updated['provider'])
            self.assertEqual('gpt-4o-mini', config_updated['model'])
            self.assertNotIn('ocr', config_updated)
        finally:
            if delegate_tool is not None and original_delegate_timeout is not None:
                delegate_tool.policy.timeout_seconds = original_delegate_timeout
            backend_main.create_llm = original_create_llm
            backend_main.runtime_state = original_runtime_state

    async def test_handle_config_applies_delegated_task_timeout_override_to_tool_policy(self) -> None:
        original_create_llm = backend_main.create_llm
        original_runtime_state = backend_main.runtime_state
        delegate_tool = backend_main.tool_registry.get_tool("delegate_task")
        original_delegate_timeout = delegate_tool.policy.timeout_seconds if delegate_tool is not None else None

        try:
            def fake_create_llm(_config):
                return object()

            async def send_callback(_message):
                return None

            backend_main.create_llm = fake_create_llm
            backend_main.runtime_state = backend_main.BackendRuntimeState()

            await backend_main.handle_config(
                {
                    'provider': 'openai',
                    'model': 'gpt-4o-mini',
                    'api_key': 'test-key',
                    'base_url': 'https://api.openai.com/v1',
                    'enable_reasoning': False,
                    'runtime': {
                        'delegated_task': {
                            'timeout_seconds': 240,
                        },
                    },
                },
                send_callback,
            )

            self.assertEqual(240, delegate_tool.policy.timeout_seconds if delegate_tool is not None else None)
        finally:
            if delegate_tool is not None and original_delegate_timeout is not None:
                delegate_tool.policy.timeout_seconds = original_delegate_timeout
            backend_main.create_llm = original_create_llm
            backend_main.runtime_state = original_runtime_state

    async def test_handle_config_preserves_explicit_reasoning_override_and_defaults_input_type(self) -> None:
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

            self.assertTrue(captured_configs[0]['enable_reasoning'])
            self.assertEqual('on', captured_configs[0]['reasoning_mode'])
            self.assertEqual('text', captured_configs[0]['input_type'])
        finally:
            backend_main.create_llm = original_create_llm
            backend_main.runtime_state = original_runtime_state

    async def test_handle_user_message_rejects_image_attachments_for_text_only_model(self) -> None:
        original_runtime_state = backend_main.runtime_state
        original_user_manager = backend_main.user_manager
        original_get_or_create_agent = backend_main.get_or_create_agent

        with tempfile.TemporaryDirectory() as temp_dir:
            messages = []

            async def send_callback(message):
                messages.append(message)

            async def fail_get_or_create_agent(*_args, **_kwargs):
                raise AssertionError("Text-only image requests should be rejected before agent creation")

            try:
                backend_main.runtime_state = backend_main.BackendRuntimeState(
                    current_config=backend_main._normalize_provider_config(
                        {
                            'provider': 'deepseek',
                            'model': 'deepseek-chat',
                            'api_key': 'test-key',
                            'base_url': 'https://api.deepseek.com',
                            'enable_reasoning': False,
                        }
                    ),
                    default_workspace=temp_dir,
                )
                backend_main.user_manager = backend_main.UserManager(Path(temp_dir) / "tool-policies.json")
                backend_main.get_or_create_agent = fail_get_or_create_agent
                await backend_main.user_manager.register_connection('connection-1', send_callback)

                await backend_main.handle_user_message(
                    {
                        'session_id': 'session-1',
                        'content': 'Describe this image',
                        'attachments': [
                            {
                                'kind': 'image',
                                'path': str(Path(temp_dir) / 'diagram.png'),
                                'name': 'diagram.png',
                            }
                        ],
                    },
                    send_callback,
                    'connection-1',
                )

                self.assertIn(
                    {
                        'type': 'error',
                        'session_id': 'session-1',
                        'error': 'Model deepseek/deepseek-chat does not support image input.',
                    },
                    messages,
                )
            finally:
                backend_main.runtime_state = original_runtime_state
                backend_main.user_manager = original_user_manager
                backend_main.get_or_create_agent = original_get_or_create_agent

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

    def test_create_llm_for_profile_supports_kimi(self) -> None:
        llm = backend_main.create_llm_for_profile(
            {
                'provider': 'kimi',
                'model': 'kimi-k2.5',
                'api_key': 'test-key',
                'base_url': 'https://api.moonshot.cn/v1',
            }
        )

        self.assertIsInstance(llm, KimiLLM)

    def test_create_llm_for_profile_supports_glm(self) -> None:
        llm = backend_main.create_llm_for_profile(
            {
                'provider': 'glm',
                'model': 'glm-4.6',
                'api_key': 'test-key',
                'base_url': 'https://open.bigmodel.cn/api/paas/v4',
            }
        )

        self.assertIsInstance(llm, GLMLLM)

    def test_create_llm_for_profile_supports_minimax(self) -> None:
        llm = backend_main.create_llm_for_profile(
            {
                'provider': 'minimax',
                'model': 'MiniMax-M2.5',
                'api_key': 'test-key',
                'base_url': 'https://api.minimaxi.com/v1',
            }
        )

        self.assertIsInstance(llm, MiniMaxLLM)


if __name__ == '__main__':
    unittest.main()
