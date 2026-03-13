import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.agent import Agent
from core.user import UserManager
from llms.base import BaseLLM
from tools.base import ToolRegistry


class RecordingLLM(BaseLLM):
    def __init__(self) -> None:
        super().__init__({"model": "test-model"})
        self.captured_messages = []

    async def stream(self, messages, tools=None):
        self.captured_messages.append(messages)
        yield {
            "choices": [
                {
                    "delta": {
                        "content": "done",
                    }
                }
            ]
        }

    async def complete(self, messages, tools=None):
        return {}


class RagPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.frontend_messages = []
        self.user_manager = UserManager()

        async def send_callback(message):
            self.frontend_messages.append(message)

        await self.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_agent_injects_retrieval_hits_and_emits_retrieval_events(self) -> None:
        workspace = Path(self.temp_dir.name)
        docs_dir = workspace / "docs"
        docs_dir.mkdir(parents=True)
        (docs_dir / "ops.md").write_text(
            "Deployment checklist:\n- Verify traffic window\n- Prepare rollback plan\n",
            encoding="utf-8",
        )

        from retrieval.simple_store import SimpleRetrievalStore

        session = await self.user_manager.create_session(str(workspace), "session-1")
        await self.user_manager.bind_session_to_connection("session-1", "conn-1")

        llm = RecordingLLM()
        agent = Agent(
            llm,
            ToolRegistry(),
            self.user_manager,
            retrieval_provider=SimpleRetrievalStore(),
        )

        await agent.run("deployment checklist rollback", session)

        run_events = [message for message in self.frontend_messages if message.get("type") == "run_event"]
        self.assertTrue(
            any(
                event["event"]["event_type"] == "retrieval_completed"
                and event["event"]["payload"].get("hit_count") == 1
                for event in run_events
            )
        )

        first_request_messages = llm.captured_messages[0]
        self.assertEqual("system", first_request_messages[0]["role"])
        self.assertIn("ops.md", first_request_messages[0]["content"])
        self.assertIn("Verify traffic window", first_request_messages[0]["content"])

    def test_simple_retrieval_ignores_agent_logs(self) -> None:
        workspace = Path(self.temp_dir.name)
        docs_dir = workspace / "docs"
        docs_dir.mkdir(parents=True)
        (docs_dir / "guide.md").write_text(
            "Rollback guide with deployment checklist and traffic validation.",
            encoding="utf-8",
        )

        agent_logs_dir = workspace / ".agent" / "logs"
        agent_logs_dir.mkdir(parents=True)
        (agent_logs_dir / "session-1.json").write_text(
            '{"query":"deployment checklist rollback","noise":"should not be retrieved"}',
            encoding="utf-8",
        )

        from retrieval.simple_store import SimpleRetrievalStore

        hits = SimpleRetrievalStore().retrieve("deployment checklist rollback", str(workspace), limit=5)
        self.assertEqual([str(docs_dir / "guide.md")], [hit.path for hit in hits])


if __name__ == "__main__":
    unittest.main()
