import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from llms.ollama import OllamaLLM


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    def raise_for_status(self):
        return None

    async def json(self):
        return self._payload


class FakeClientSession:
    def __init__(self, timeout=None):
        self.timeout = timeout
        self.closed = False
        self.post_calls = []

    def post(self, url, json=None):
        self.post_calls.append((url, json))
        return FakeResponse({
            "message": {
                "role": "assistant",
                "content": "ok",
            },
            "prompt_eval_count": 3,
            "eval_count": 2,
        })

    async def close(self):
        self.closed = True


class OllamaLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_ollama_reuses_client_session_and_closes_it(self) -> None:
        created_sessions = []

        def session_factory(*args, **kwargs):
            session = FakeClientSession(timeout=kwargs.get("timeout"))
            created_sessions.append(session)
            return session

        with patch("llms.ollama.aiohttp.ClientSession", side_effect=session_factory):
            llm = OllamaLLM({
                "provider": "ollama",
                "model": "qwen3:8b",
                "base_url": "http://127.0.0.1:11434",
            })

            await llm.complete([{"role": "user", "content": "first"}])
            await llm.complete([{"role": "user", "content": "second"}])
            await llm.aclose()

        self.assertEqual(1, len(created_sessions))
        self.assertEqual(2, len(created_sessions[0].post_calls))
        self.assertTrue(created_sessions[0].closed)


if __name__ == "__main__":
    unittest.main()
