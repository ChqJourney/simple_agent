import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.ask_question import AskQuestionTool
from tools.delegate_task import DelegateTaskTool
from tools.get_document_structure import GetDocumentStructureTool
from tools.list_directory_tree import ListDirectoryTreeTool
from tools.pdf_tools import PdfGetInfoTool, PdfSearchTool
from tools.read_document_segment import ReadDocumentSegmentTool
from tools.search_documents import SearchDocumentsTool
from tools.skill_loader import SkillLoaderTool
from tools.registry import ToolRegistry
from tools.todo_task import TodoTaskTool
from skills.local_loader import LocalSkillLoader


class FakeDelegatedTaskExecutor:
    async def execute(self, *, task: str, expected_output: str = "text", context=None):
        return {
            "event": "delegated_task",
            "summary": f"Handled: {task}",
            "data": context or {},
            "expected_output": expected_output,
            "worker": {
                "profile_name": "background",
                "provider": "openai",
                "model": "gpt-4o-mini",
            },
        }


class ToolRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_registry_exposes_descriptors_and_category_lookup(self) -> None:
        registry = ToolRegistry()
        registry.register(ListDirectoryTreeTool())
        registry.register(SearchDocumentsTool())
        registry.register(ReadDocumentSegmentTool())
        registry.register(GetDocumentStructureTool())
        registry.register(PdfGetInfoTool())
        registry.register(PdfSearchTool())
        registry.register(TodoTaskTool())
        registry.register(AskQuestionTool())
        registry.register(DelegateTaskTool(FakeDelegatedTaskExecutor()))
        registry.register(SkillLoaderTool(LocalSkillLoader(search_roots=[])))

        descriptors = registry.get_descriptors()
        descriptor_names = sorted(d.name for d in descriptors)
        self.assertEqual(
            [
                "ask_question",
                "delegate_task",
                "get_document_structure",
                "list_directory_tree",
                "pdf_get_info",
                "pdf_search",
                "read_document_segment",
                "search_documents",
                "skill_loader",
                "todo_task",
            ],
            descriptor_names,
        )
        self.assertEqual(
            ["delegate_task", "todo_task"],
            sorted(tool.name for tool in registry.list_by_category("task")),
        )
        self.assertEqual(["ask_question"], [tool.name for tool in registry.list_by_category("interaction")])
        search_descriptor = next(d for d in descriptors if d.name == "search_documents")
        self.assertTrue(search_descriptor.read_only)
        self.assertEqual("low", search_descriptor.risk_level)
        self.assertIn("search", search_descriptor.tags)
        self.assertIn("mode='plain'", search_descriptor.description)

        read_descriptor = next(d for d in descriptors if d.name == "read_document_segment")
        locator_schema = read_descriptor.parameters["properties"]["locator"]
        self.assertIn("pdf_line_range", locator_schema["description"])

        pdf_search_descriptor = next(d for d in descriptors if d.name == "pdf_search")
        self.assertIn("search_mode='page'", pdf_search_descriptor.description)

    async def test_todo_and_question_tools_return_frontend_friendly_event_shapes(self) -> None:
        todo_result = await TodoTaskTool().execute(
            tool_call_id="todo-1",
            action="create",
            content="Ship Task 5",
            status="pending",
            sub_tasks=[{"id": "sub-1", "content": "Write tests", "status": "completed"}],
        )
        question_result = await AskQuestionTool().execute(
            tool_call_id="question-1",
            question="Need approval to continue?",
            details="The shell command will modify files.",
            options=["continue", "stop"],
        )
        delegated_result = await DelegateTaskTool(FakeDelegatedTaskExecutor()).execute(
            tool_call_id="delegate-1",
            task="Summarize unresolved risks",
            expected_output="json",
            context={"tool_results": ["runtime clamp pending"]},
        )

        self.assertTrue(todo_result.success)
        self.assertEqual("todo_task", todo_result.tool_name)
        self.assertEqual("todo_task", todo_result.output["event"])
        self.assertEqual("create", todo_result.output["action"])
        self.assertEqual("Ship Task 5", todo_result.output["task"]["content"])
        self.assertEqual("completed", todo_result.output["task"]["subTasks"][0]["status"])

        self.assertTrue(question_result.success)
        self.assertEqual("pending_question", question_result.output["event"])
        self.assertEqual("Need approval to continue?", question_result.output["question"])
        self.assertEqual(["continue", "stop"], question_result.output["options"])

        self.assertTrue(delegated_result.success)
        self.assertEqual("delegated_task", delegated_result.output["event"])
        self.assertEqual("Handled: Summarize unresolved risks", delegated_result.output["summary"])
        self.assertEqual("background", delegated_result.output["worker"]["profile_name"])
        self.assertEqual("gpt-4o-mini", delegated_result.metadata["worker"]["model"])
        self.assertEqual(120, DelegateTaskTool(FakeDelegatedTaskExecutor()).policy.timeout_seconds)


if __name__ == "__main__":
    unittest.main()
