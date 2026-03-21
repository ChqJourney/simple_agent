import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from llms.base import BaseLLM


class UsageProbeLLM(BaseLLM):
    async def stream(self, messages, tools=None):
        if False:
            yield None

    async def complete(self, messages, tools=None):
        return {}


class UsageNormalizationTests(unittest.TestCase):
    def test_usage_aliases_normalize_input_and_output_tokens(self) -> None:
        llm = UsageProbeLLM({"provider": "minimax", "model": "MiniMax-M2.5"})

        usage = llm._set_latest_usage(
            {
                "input_tokens": 120,
                "output_tokens": 30,
                "total_tokens": 150,
            }
        )

        self.assertEqual(
            {
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "total_tokens": 150,
            },
            usage,
        )


if __name__ == "__main__":
    unittest.main()
