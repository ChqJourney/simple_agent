import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.user import Session
from llms.base import BaseLLM
from runtime.session_titles import maybe_generate_session_title


class TitleLLM(BaseLLM):
    def __init__(self, title: str) -> None:
        super().__init__({"model": "title-model"})
        self.title = title
        self.complete_calls = 0

    async def stream(self, messages, tools=None):
        if False:
            yield {}

    async def complete(self, messages, tools=None):
        self.complete_calls += 1
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": self.title,
                    }
                }
            ]
        }


class SessionTitleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_generates_persists_and_emits_session_title(self) -> None:
        session = Session("session-1", self.temp_dir.name)
        llm = TitleLLM("Investigate runtime contracts")
        frontend_messages = []

        async def send_callback(message):
            frontend_messages.append(message)

        title = await maybe_generate_session_title(
            session,
            llm,
            "Please investigate runtime contracts before shipping",
            send_callback,
        )

        self.assertEqual("Investigate runtime contracts", title)
        self.assertEqual("Investigate runtime contracts", session.title)

        reloaded = Session.from_disk("session-1", self.temp_dir.name)
        self.assertEqual("Investigate runtime contracts", reloaded.title)
        self.assertTrue(
            any(
                message.get("type") == "session_title_updated"
                and message.get("title") == "Investigate runtime contracts"
                for message in frontend_messages
            )
        )

    async def test_skips_generation_when_session_already_has_title(self) -> None:
        session = Session("session-1", self.temp_dir.name, title="Existing title")
        llm = TitleLLM("New title")

        async def send_callback(message):
            raise AssertionError(f"Unexpected frontend message: {message}")

        title = await maybe_generate_session_title(
            session,
            llm,
            "Please investigate runtime contracts before shipping",
            send_callback,
        )

        self.assertIsNone(title)
        self.assertEqual(0, llm.complete_calls)


if __name__ == "__main__":
    unittest.main()
