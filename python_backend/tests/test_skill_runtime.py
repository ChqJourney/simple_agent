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
from tools.delegate_task import DelegateTaskTool
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


class FakeDelegatedTaskExecutor:
    async def execute(self, *, task: str, expected_output: str = "text", context=None):
        return {
            "event": "delegated_task",
            "summary": task,
            "data": context,
            "expected_output": expected_output,
            "worker": {
                "profile_name": "background",
                "provider": "openai",
                "model": "gpt-4o-mini",
            },
        }


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
        registry = ToolRegistry()
        registry.register(SkillLoaderTool(LocalSkillLoader(search_roots=[skill_root])))
        agent = Agent(
            llm,
            registry,
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
        self.assertIn("Runtime environment:", first_request_messages[0]["content"])
        self.assertIn(f"Workspace path: {self.temp_dir.name}", first_request_messages[0]["content"])
        self.assertIn("`python_execute` already uses the app-managed Python runtime automatically.", first_request_messages[0]["content"])
        self.assertIn("`shell_execute` injects runtime shims", first_request_messages[0]["content"])
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

    async def test_agent_appends_custom_system_prompt_after_builtin_sections(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-system-prompt")
        await self.user_manager.bind_session_to_connection("session-system-prompt", "conn-1")

        llm = RecordingLLM()
        agent = Agent(
            llm,
            ToolRegistry(),
            self.user_manager,
            custom_system_prompt="Prefer concise answers and mention risks first.",
        )

        await agent.run("hello", session)

        first_request_messages = llm.captured_messages[0]
        self.assertEqual("system", first_request_messages[0]["role"])
        self.assertIn("Runtime environment:", first_request_messages[0]["content"])
        self.assertIn(
            "Additional user-configured system instructions:",
            first_request_messages[0]["content"],
        )
        self.assertIn(
            "Prefer concise answers and mention risks first.",
            first_request_messages[0]["content"],
        )

    async def test_agent_includes_delegation_guidance_when_delegate_task_tool_is_available(self) -> None:
        session = await self.user_manager.create_session(self.temp_dir.name, "session-delegation-guidance")
        await self.user_manager.bind_session_to_connection("session-delegation-guidance", "conn-1")

        llm = RecordingLLM()
        registry = ToolRegistry()
        registry.register(DelegateTaskTool(FakeDelegatedTaskExecutor()))
        agent = Agent(
            llm,
            registry,
            self.user_manager,
        )

        await agent.run("hello", session)

        first_request_messages = llm.captured_messages[0]
        self.assertEqual("system", first_request_messages[0]["role"])
        self.assertIn("Delegation guidance:", first_request_messages[0]["content"])
        self.assertIn("`delegate_task` is for bounded, read-only background subtasks.", first_request_messages[0]["content"])
        self.assertIn("minimal structured context needed", first_request_messages[0]["content"])

    async def test_agent_hides_skill_catalog_when_skill_loader_is_filtered_out(self) -> None:
        skill_root = Path(self.temp_dir.name) / "skills"
        skill_dir = skill_root / "deploy-checks"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: deploy-checks\ndescription: Deployment checklist\n---\nAlways verify traffic before deploy.\n",
            encoding="utf-8",
        )

        session = await self.user_manager.create_session(self.temp_dir.name, "session-skill-filtered")
        await self.user_manager.bind_session_to_connection("session-skill-filtered", "conn-1")

        llm = RecordingLLM()
        registry = ToolRegistry()
        registry.register(SkillLoaderTool(LocalSkillLoader(search_roots=[skill_root])))
        agent = Agent(
            llm,
            registry,
            self.user_manager,
            skill_provider=LocalSkillLoader(search_roots=[skill_root]),
            tool_filter=lambda tool: tool.name != "skill_loader",
        )

        await agent.run("Please use $deploy-checks before shipping", session)

        first_request_messages = llm.captured_messages[0]
        self.assertNotIn("Local skill catalog:", first_request_messages[0]["content"])
        self.assertNotIn("deploy-checks", first_request_messages[0]["content"])


if __name__ == "__main__":
    unittest.main()
