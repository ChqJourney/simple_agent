import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from llms.openai import OpenAILLM
from llms.ollama import OllamaLLM
from llms.qwen import QwenLLM


async def empty_stream():
    if False:
        yield None


class ProviderReasoningRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_openai_reasoning_model_includes_reasoning_effort(self) -> None:
        llm = OpenAILLM({
            'model': 'o1-preview',
            'api_key': 'test-key',
            'base_url': 'https://api.openai.com/v1',
            'enable_reasoning': True,
        })
        llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

        async for _ in llm.stream([{'role': 'user', 'content': 'hello'}], None):
            pass

        kwargs = llm.client.chat.completions.create.await_args.kwargs
        self.assertEqual('medium', kwargs.get('reasoning_effort'))

    async def test_openai_non_reasoning_model_omits_reasoning_effort(self) -> None:
        llm = OpenAILLM({
            'model': 'gpt-4o',
            'api_key': 'test-key',
            'base_url': 'https://api.openai.com/v1',
            'enable_reasoning': True,
        })
        llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

        async for _ in llm.stream([{'role': 'user', 'content': 'hello'}], None):
            pass

        kwargs = llm.client.chat.completions.create.await_args.kwargs
        self.assertNotIn('reasoning_effort', kwargs)

    async def test_qwen_reasoning_model_enables_thinking(self) -> None:
        llm = QwenLLM({
            'model': 'qwen3-max-2026-01-23',
            'api_key': 'test-key',
            'base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            'enable_reasoning': True,
        })
        llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

        async for _ in llm.stream([{'role': 'user', 'content': 'hello'}], None):
            pass

        kwargs = llm.client.chat.completions.create.await_args.kwargs
        self.assertEqual({'enable_thinking': True}, kwargs.get('extra_body'))

    def test_ollama_reasoning_model_sets_think_flag(self) -> None:
        llm = OllamaLLM({
            'model': 'qwen3:8b',
            'base_url': 'http://127.0.0.1:11434',
            'enable_reasoning': True,
        })

        payload = llm._build_payload([{'role': 'user', 'content': 'hello'}], None, True)

        self.assertTrue(payload['think'])


if __name__ == '__main__':
    unittest.main()
