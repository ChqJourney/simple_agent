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
from skills.local_loader import LocalSkillLoader
from tools.base import ToolRegistry
from tools.skill_loader import SkillLoaderTool


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


class SkillRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.frontend_messages = []
        self.user_manager = UserManager()

        async def send_callback(message):
            self.frontend_messages.append(message)

        await self.user_manager.register_connection("conn-1", send_callback)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_agent_resolves_local_skill_and_injects_instructions(self) -> None:
        skill_root = Path(self.temp_dir.name) / "skills"
        skill_dir = skill_root / "deploy-checks"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: deploy-checks\ndescription: Deployment checklist\ntags:\n  - deploy\n---\nAlways verify traffic before deploy.\n",
            encoding="utf-8",
        )

        session = await self.user_manager.create_session(self.temp_dir.name, "session-1")
        await self.user_manager.bind_session_to_connection("session-1", "conn-1")

        llm = RecordingLLM()
        agent = Agent(
            llm,
            ToolRegistry(),
            self.user_manager,
            skill_provider=LocalSkillLoader(search_roots=[skill_root]),
        )

        await agent.run("Please use $deploy-checks before shipping", session)

        run_events = [message for message in self.frontend_messages if message.get("type") == "run_event"]
        self.assertTrue(
            any(
                event["event"]["event_type"] == "skill_catalog_prepared"
                and event["event"]["payload"].get("skill_names") == ["deploy-checks"]
                for event in run_events
            )
        )

        first_request_messages = llm.captured_messages[0]
        self.assertEqual("system", first_request_messages[0]["role"])
        self.assertIn("deploy-checks", first_request_messages[0]["content"])
        self.assertIn("description: Deployment checklist", first_request_messages[0]["content"])
        self.assertIn("tags:", first_request_messages[0]["content"])
        self.assertIn("call the `skill_loader` tool", first_request_messages[0]["content"])
        self.assertNotIn("Always verify traffic before deploy.", first_request_messages[0]["content"])

    async def test_skill_loader_tool_returns_full_skill_body(self) -> None:
        skill_root = Path(self.temp_dir.name) / "skills"
        skill_dir = skill_root / "deploy-checks"
        skill_dir.mkdir(parents=True)
        (skill_dir / "skill.md").write_text(
            "---\nname: deploy-checks\ndescription: Deployment checklist\n---\nAlways verify traffic before deploy.\n",
            encoding="utf-8",
        )

        result = await SkillLoaderTool(LocalSkillLoader(search_roots=[skill_root])).execute(
            tool_call_id="skill-1",
            skill_name="deploy-checks",
            workspace_path=self.temp_dir.name,
        )

        self.assertTrue(result.success)
        self.assertEqual("skill_loader", result.tool_name)
        self.assertEqual("skill_loader", result.output["event"])
        self.assertEqual("deploy-checks", result.output["skill"]["name"])
        self.assertEqual("app", result.output["skill"]["source"])
        self.assertIn("Always verify traffic before deploy.", result.output["skill"]["content"])


if __name__ == "__main__":
    unittest.main()
