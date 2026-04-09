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


class LLMRuntimeLimitTests(unittest.TestCase):
    def test_requests_include_max_output_tokens(self) -> None:
        cases = [
            (
                OpenAILLM,
                {
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "api_key": "test-key",
                    "base_url": "https://api.openai.com/v1",
                    "max_output_tokens": 128,
                },
                128,
            ),
            (
                QwenLLM,
                {
                    "provider": "qwen",
                    "model": "qwen-plus",
                    "api_key": "test-key",
                    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "max_output_tokens": 96,
                },
                96,
            ),
            (
                DeepSeekLLM,
                {
                    "provider": "deepseek",
                    "model": "deepseek-chat",
                    "api_key": "test-key",
                    "base_url": "https://api.deepseek.com",
                    "max_output_tokens": 256,
                },
                256,
            ),
            (
                KimiLLM,
                {
                    "provider": "kimi",
                    "model": "kimi-k2.5",
                    "api_key": "test-key",
                    "base_url": "https://api.moonshot.cn/v1",
                    "max_output_tokens": 144,
                    "enable_reasoning": True,
                },
                144,
            ),
            (
                GLMLLM,
                {
                    "provider": "glm",
                    "model": "glm-4.6",
                    "api_key": "test-key",
                    "base_url": "https://open.bigmodel.cn/api/paas/v4",
                    "max_output_tokens": 88,
                },
                88,
            ),
            (
                MiniMaxLLM,
                {
                    "provider": "minimax",
                    "model": "MiniMax-M2.5",
                    "api_key": "test-key",
                    "base_url": "https://api.minimaxi.com/v1",
                    "max_output_tokens": 72,
                },
                72,
            ),
        ]

        for llm_class, config, expected_max_tokens in cases:
            with self.subTest(provider=config["provider"], model=config["model"]):
                llm = llm_class(config)
                kwargs = llm._build_request_kwargs([{"role": "user", "content": "hello"}], None, False)
                self.assertEqual(expected_max_tokens, kwargs["max_tokens"])

    def test_kimi_request_uses_role_specific_temperature(self) -> None:
        cases = [
            (True, 1.0),
            (False, 0.6),
        ]

        for enable_reasoning, expected_temperature in cases:
            with self.subTest(enable_reasoning=enable_reasoning):
                llm = KimiLLM(
                    {
                        "provider": "kimi",
                        "model": "kimi-k2.5",
                        "api_key": "test-key",
                        "base_url": "https://api.moonshot.cn/v1",
                        "max_output_tokens": 144,
                        "enable_reasoning": enable_reasoning,
                    }
                )

                kwargs = llm._build_request_kwargs([{"role": "user", "content": "hello"}], None, False)

                self.assertEqual(expected_temperature, kwargs["temperature"])


if __name__ == "__main__":
    unittest.main()
