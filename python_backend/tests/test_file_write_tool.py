import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.file_write import FileWriteTool


class FileWriteToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_write_preserves_content_without_appending_newline(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        tool = FileWriteTool()
        target_path = Path(temp_dir.name) / 'example.txt'

        result = await tool.execute(
            path='example.txt',
            content='line-without-newline',
            tool_call_id='tool-1',
            workspace_path=temp_dir.name,
        )

        self.assertTrue(result.success)
        self.assertEqual('line-without-newline', target_path.read_text(encoding='utf-8'))
        self.assertEqual('file_write', result.output['event'])
        self.assertEqual('created', result.output['change'])
        self.assertEqual(str(target_path.resolve()), str(Path(result.output['path']).resolve()))

        temp_dir.cleanup()

    async def test_write_supports_explicit_encoding(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        tool = FileWriteTool()
        target_path = Path(temp_dir.name) / 'latin1.txt'

        result = await tool.execute(
            path='latin1.txt',
            content='café',
            encoding='latin-1',
            tool_call_id='tool-2',
            workspace_path=temp_dir.name,
        )

        self.assertTrue(result.success)
        self.assertEqual(b'caf\xe9', target_path.read_bytes())

        temp_dir.cleanup()

    async def test_write_rejects_reference_library_paths_outside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_dir, tempfile.TemporaryDirectory() as ref_dir:
            tool = FileWriteTool()
            reference_target = Path(ref_dir) / 'standard.md'

            result = await tool.execute(
                path=str(reference_target),
                content='do not overwrite',
                tool_call_id='tool-3',
                workspace_path=workspace_dir,
                reference_library_roots=[ref_dir],
            )

            self.assertFalse(result.success)
            self.assertIn('inside workspace', result.error or '')
            self.assertFalse(reference_target.exists())


if __name__ == '__main__':
    unittest.main()
