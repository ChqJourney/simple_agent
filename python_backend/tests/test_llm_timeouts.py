import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from llms.deepseek import DeepSeekLLM
from llms.glm import GLMLLM
from llms.kimi import KimiLLM
from llms.minimax import MiniMaxLLM
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
        kimi_llm = KimiLLM({
            "provider": "kimi",
            "model": "kimi-k2.5",
            "api_key": "test-key",
            "base_url": "https://api.moonshot.cn/v1",
        })
        glm_llm = GLMLLM({
            "provider": "glm",
            "model": "glm-4.6",
            "api_key": "test-key",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
        })
        minimax_llm = MiniMaxLLM({
            "provider": "minimax",
            "model": "MiniMax-M2.5",
            "api_key": "test-key",
            "base_url": "https://api.minimaxi.com/v1",
        })

        self.assertEqual(60, openai_llm.client._client.timeout.read)
        self.assertEqual(60, deepseek_llm.client._client.timeout.read)
        self.assertEqual(60, qwen_llm.client._client.timeout.read)
        self.assertEqual(60, kimi_llm.client._client.timeout.read)
        self.assertEqual(60, glm_llm.client._client.timeout.read)
        self.assertEqual(60, minimax_llm.client._client.timeout.read)

    def test_llm_clients_allow_runtime_timeout_override(self) -> None:
        openai_llm = OpenAILLM({
            "provider": "openai",
            "model": "gpt-4o-mini",
            "api_key": "test-key",
            "base_url": "https://api.openai.com/v1",
            "runtime": {"timeout_seconds": 15},
        })

        self.assertEqual(15, openai_llm.client._client.timeout.read)


if __name__ == "__main__":
    unittest.main()
