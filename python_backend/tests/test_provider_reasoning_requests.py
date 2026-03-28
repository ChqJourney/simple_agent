import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.user import Message, Session
from llms.openai import OpenAILLM
from llms.glm import GLMLLM
from llms.kimi import KimiLLM
from llms.minimax import MiniMaxLLM
from llms.ollama import OllamaLLM
from llms.qwen import QwenLLM


async def empty_stream():
    if False:
        yield None


class DummyTool:
    name = "lookup"
    description = "Lookup data"
    parameters = {
        "type": "object",
        "properties": {},
    }


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

    async def test_kimi_reasoning_model_sends_thinking_and_k2_5_temperature(self) -> None:
        llm = KimiLLM({
            'model': 'kimi-k2.5',
            'api_key': 'test-key',
            'base_url': 'https://api.moonshot.cn/v1',
            'enable_reasoning': True,
        })
        llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

        async for _ in llm.stream([{'role': 'user', 'content': 'hello'}], None):
            pass

        kwargs = llm.client.chat.completions.create.await_args.kwargs
        self.assertEqual({'thinking': {'type': 'enabled'}}, kwargs.get('extra_body'))
        self.assertEqual(1.0, kwargs.get('temperature'))

    async def test_kimi_non_reasoning_model_uses_fixed_non_thinking_temperature(self) -> None:
        llm = KimiLLM({
            'model': 'kimi-k2.5',
            'api_key': 'test-key',
            'base_url': 'https://api.moonshot.cn/v1',
            'enable_reasoning': False,
        })
        llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

        async for _ in llm.stream([{'role': 'user', 'content': 'hello'}], None):
            pass

        kwargs = llm.client.chat.completions.create.await_args.kwargs
        self.assertEqual({'thinking': {'type': 'disabled'}}, kwargs.get('extra_body'))
        self.assertEqual(0.6, kwargs.get('temperature'))

    async def test_kimi_reasoning_request_preserves_reasoning_content_for_assistant_tool_call_messages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-kimi", temp_dir)
            await session.add_message_async(
                Message(
                    role="assistant",
                    content="I'll inspect that.",
                    reasoning_content="Need to check file layout first.",
                    tool_calls=[
                        {
                            "id": "tool-1",
                            "type": "function",
                            "function": {
                                "name": "read_file",
                                "arguments": "{\"path\":\"README.md\"}",
                            },
                        }
                    ],
                )
            )

            llm = KimiLLM({
                'model': 'kimi-k2.5',
                'api_key': 'test-key',
                'base_url': 'https://api.moonshot.cn/v1',
                'enable_reasoning': True,
            })
            llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

            async for _ in llm.stream(session.get_messages_for_llm(), None):
                pass

            kwargs = llm.client.chat.completions.create.await_args.kwargs
            self.assertEqual(
                "Need to check file layout first.",
                kwargs["messages"][0]["reasoning_content"],
            )
            self.assertEqual(
                "read_file",
                kwargs["messages"][0]["tool_calls"][0]["function"]["name"],
            )

    async def test_glm_reasoning_model_sends_thinking_and_tool_stream(self) -> None:
        llm = GLMLLM({
            'model': 'glm-4.6',
            'api_key': 'test-key',
            'base_url': 'https://open.bigmodel.cn/api/paas/v4',
            'enable_reasoning': True,
        })
        llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

        async for _ in llm.stream([{'role': 'user', 'content': 'hello'}], [DummyTool()]):
            pass

        kwargs = llm.client.chat.completions.create.await_args.kwargs
        self.assertEqual(
            {'thinking': {'type': 'enabled', 'clear_thinking': False}, 'tool_stream': True},
            kwargs.get('extra_body'),
        )

    async def test_minimax_request_enables_reasoning_split(self) -> None:
        llm = MiniMaxLLM({
            'model': 'MiniMax-M2.5',
            'api_key': 'test-key',
            'base_url': 'https://api.minimaxi.com/v1',
        })
        llm.client.chat.completions.create = AsyncMock(return_value=empty_stream())

        async for _ in llm.stream([{'role': 'user', 'content': 'hello'}], None):
            pass

        kwargs = llm.client.chat.completions.create.await_args.kwargs
        self.assertEqual({'reasoning_split': True}, kwargs.get('extra_body'))

    def test_minimax_normalizes_reasoning_details_to_reasoning_content(self) -> None:
        llm = MiniMaxLLM({
            'model': 'MiniMax-M2.5',
            'api_key': 'test-key',
            'base_url': 'https://api.minimaxi.com/v1',
        })

        chunk = llm._normalize_chunk({
            'choices': [{
                'delta': {
                    'reasoning_details': [{'text': 'step 1'}, {'text': ' + step 2'}],
                }
            }]
        })

        self.assertEqual('step 1 + step 2', chunk['choices'][0]['delta']['reasoning_content'])

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
