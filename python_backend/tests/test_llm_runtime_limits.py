import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from llms.deepseek import DeepSeekLLM
from llms.ollama import OllamaLLM
from llms.openai import OpenAILLM
from llms.qwen import QwenLLM


class LLMRuntimeLimitTests(unittest.TestCase):
    def test_openai_request_includes_max_output_tokens(self) -> None:
        llm = OpenAILLM(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "test-key",
                "base_url": "https://api.openai.com/v1",
                "max_output_tokens": 128,
            }
        )

        kwargs = llm._build_request_kwargs([{"role": "user", "content": "hello"}], None, False)

        self.assertEqual(128, kwargs["max_tokens"])

    def test_qwen_request_includes_max_output_tokens(self) -> None:
        llm = QwenLLM(
            {
                "provider": "qwen",
                "model": "qwen-plus",
                "api_key": "test-key",
                "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "max_output_tokens": 96,
            }
        )

        kwargs = llm._build_request_kwargs([{"role": "user", "content": "hello"}], None, False)

        self.assertEqual(96, kwargs["max_tokens"])

    def test_ollama_payload_includes_num_predict_limit(self) -> None:
        llm = OllamaLLM(
            {
                "provider": "ollama",
                "model": "qwen2.5-coder:7b",
                "base_url": "http://127.0.0.1:11434",
                "max_output_tokens": 64,
            }
        )

        payload = llm._build_payload([{"role": "user", "content": "hello"}], None, False)

        self.assertEqual(64, payload["options"]["num_predict"])

    def test_deepseek_request_includes_max_output_tokens(self) -> None:
        llm = DeepSeekLLM(
            {
                "provider": "deepseek",
                "model": "deepseek-chat",
                "api_key": "test-key",
                "base_url": "https://api.deepseek.com",
                "max_output_tokens": 256,
            }
        )

        kwargs = llm._build_request_kwargs([{"role": "user", "content": "hello"}], None, False)

        self.assertEqual(256, kwargs["max_tokens"])


if __name__ == "__main__":
    unittest.main()
