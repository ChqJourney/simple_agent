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


class LLMTimeoutTests(unittest.TestCase):
    def test_openai_compatible_clients_use_finite_default_timeout(self) -> None:
        openai_llm = OpenAILLM({
            "provider": "openai",
            "model": "gpt-4o-mini",
            "api_key": "test-key",
            "base_url": "https://api.openai.com/v1",
        })
        deepseek_llm = DeepSeekLLM({
            "provider": "deepseek",
            "model": "deepseek-chat",
            "api_key": "test-key",
            "base_url": "https://api.deepseek.com",
        })
        qwen_llm = QwenLLM({
            "provider": "qwen",
            "model": "qwen-plus",
            "api_key": "test-key",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        })

        self.assertEqual(60, openai_llm.client._client.timeout.read)
        self.assertEqual(60, deepseek_llm.client._client.timeout.read)
        self.assertEqual(60, qwen_llm.client._client.timeout.read)

    def test_llm_clients_allow_runtime_timeout_override(self) -> None:
        openai_llm = OpenAILLM({
            "provider": "openai",
            "model": "gpt-4o-mini",
            "api_key": "test-key",
            "base_url": "https://api.openai.com/v1",
            "runtime": {"timeout_seconds": 15},
        })
        ollama_llm = OllamaLLM({
            "provider": "ollama",
            "model": "qwen3:8b",
            "base_url": "http://127.0.0.1:11434",
            "runtime": {"timeout_seconds": 15},
        })

        self.assertEqual(15, openai_llm.client._client.timeout.read)
        self.assertEqual(15, ollama_llm.request_timeout.total)


if __name__ == "__main__":
    unittest.main()
