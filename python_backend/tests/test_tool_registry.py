import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.ask_question import AskQuestionTool
from tools.get_document_outline import GetDocumentOutlineTool
from tools.list_directory_tree import ListDirectoryTreeTool
from tools.read_file_excerpt import ReadFileExcerptTool
from tools.search_files import SearchFilesTool
from tools.skill_loader import SkillLoaderTool
from tools.registry import ToolRegistry
from tools.todo_task import TodoTaskTool
from skills.local_loader import LocalSkillLoader


class ToolRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_registry_exposes_descriptors_and_category_lookup(self) -> None:
        registry = ToolRegistry()
        registry.register(ListDirectoryTreeTool())
        registry.register(SearchFilesTool())
        registry.register(ReadFileExcerptTool())
        registry.register(GetDocumentOutlineTool())
        registry.register(TodoTaskTool())
        registry.register(AskQuestionTool())
        registry.register(SkillLoaderTool(LocalSkillLoader(search_roots=[])))

        descriptors = registry.get_descriptors()
        descriptor_names = sorted(d.name for d in descriptors)
        self.assertEqual(
            [
                "ask_question",
                "get_document_outline",
                "list_directory_tree",
                "read_file_excerpt",
                "search_files",
                "skill_loader",
                "todo_task",
            ],
            descriptor_names,
        )
        self.assertEqual(["todo_task"], [tool.name for tool in registry.list_by_category("task")])
        self.assertEqual(["ask_question"], [tool.name for tool in registry.list_by_category("interaction")])
        search_descriptor = next(d for d in descriptors if d.name == "search_files")
        self.assertTrue(search_descriptor.read_only)
        self.assertEqual("low", search_descriptor.risk_level)
        self.assertIn("search", search_descriptor.tags)

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


if __name__ == "__main__":
    unittest.main()
