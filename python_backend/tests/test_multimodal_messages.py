import asyncio
import base64
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.user import Message, Session
from runtime.contracts import SessionCompactionRecord, SessionMemorySnapshot


class MultimodalMessageTests(unittest.TestCase):
    def test_session_persists_and_reloads_image_attachments(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "diagram.png"
            image_path.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRXcAAAAASUVORK5CYII="))

            session = Session("session-1", temp_dir)
            asyncio.run(session.add_message_async(
                Message(
                    role="user",
                    content="Describe this image",
                    attachments=[
                        {
                            "kind": "image",
                            "path": str(image_path),
                            "name": "diagram.png",
                            "mime_type": "image/png",
                        }
                    ],
                )
            ))

            reloaded = Session.from_disk("session-1", temp_dir)

            self.assertEqual(1, len(reloaded.messages))
            self.assertEqual("image", reloaded.messages[0].attachments[0]["kind"])
            self.assertEqual(str(image_path), reloaded.messages[0].attachments[0]["path"])

    def test_get_messages_for_llm_embeds_image_attachments_as_data_urls(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "diagram.png"
            image_path.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRXcAAAAASUVORK5CYII="))

            session = Session("session-1", temp_dir)
            asyncio.run(session.add_message_async(
                Message(
                    role="user",
                    content="Summarize the screenshot",
                    attachments=[
                        {
                            "kind": "image",
                            "path": str(image_path),
                            "name": "diagram.png",
                            "mime_type": "image/png",
                        }
                    ],
                )
            ))

            llm_messages = session.get_messages_for_llm()

            self.assertIsInstance(llm_messages[0]["content"], list)
            self.assertEqual("text", llm_messages[0]["content"][0]["type"])
            self.assertEqual("image_url", llm_messages[0]["content"][1]["type"])
            self.assertTrue(
                llm_messages[0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
            )

    def test_dragged_paths_stay_as_plain_text_messages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-1", temp_dir)
            asyncio.run(session.add_message_async(
                Message(
                    role="user",
                    content="Check these paths:\n- src/app.ts\n- src/components",
                )
            ))

            llm_messages = session.get_messages_for_llm()

            self.assertEqual(
                "Check these paths:\n- src/app.ts\n- src/components",
                llm_messages[0]["content"],
            )

    def test_get_messages_for_llm_does_not_replay_assistant_reasoning_content_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-1", temp_dir)
            asyncio.run(session.add_message_async(
                Message(
                    role="assistant",
                    content="I'll inspect that.",
                    reasoning_content="Need to check file layout first.",
                )
            ))

            llm_messages = session.get_messages_for_llm()

            self.assertEqual("assistant", llm_messages[0]["role"])
            self.assertNotIn("reasoning_content", llm_messages[0])

    def test_get_messages_for_llm_can_include_reasoning_when_explicitly_requested(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-1", temp_dir)
            asyncio.run(session.add_message_async(
                Message(
                    role="assistant",
                    content="I'll inspect that.",
                    reasoning_content="Need to check file layout first.",
                    tool_calls=[
                        {
                            "id": "call-1",
                            "type": "function",
                            "function": {
                                "name": "read_file",
                                "arguments": "{\"path\":\"README.md\"}",
                            },
                        }
                    ],
                )
            ))

            llm_messages = session.get_messages_for_llm(include_reasoning_content=True)

            self.assertEqual("assistant", llm_messages[0]["role"])
            self.assertEqual("Need to check file layout first.", llm_messages[0]["reasoning_content"])
            self.assertEqual("read_file", llm_messages[0]["tool_calls"][0]["function"]["name"])

    def test_get_messages_for_llm_preserves_reasoning_for_assistant_tool_call_messages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-1", temp_dir)
            asyncio.run(session.add_message_async(
                Message(
                    role="assistant",
                    content="I'll inspect that.",
                    reasoning_content="Need to check file layout first.",
                    tool_calls=[
                        {
                            "id": "call-1",
                            "type": "function",
                            "function": {
                                "name": "read_file",
                                "arguments": "{\"path\":\"README.md\"}",
                            },
                        }
                    ],
                )
            ))

            llm_messages = session.get_messages_for_llm()

            self.assertEqual("assistant", llm_messages[0]["role"])
            self.assertEqual("Need to check file layout first.", llm_messages[0]["reasoning_content"])
            self.assertEqual("read_file", llm_messages[0]["tool_calls"][0]["function"]["name"])

    def test_session_memory_round_trips_snapshot_and_compaction_record(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-1", temp_dir)
            memory = SessionMemorySnapshot(
                session_id="session-1",
                covered_until_message_index=4,
                current_task="Implement phase 1",
                open_loops=["Add tests"],
                estimated_tokens=180,
            )
            record = SessionCompactionRecord(
                compaction_id="compact-1",
                strategy="forced",
                source_start_index=0,
                source_end_index=4,
                pre_tokens_estimate=1800,
                post_tokens_estimate=180,
                model={
                    "profile_name": "primary",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                },
            )

            session.save_memory(memory)
            session.append_compaction_record(record)

            loaded_memory = session.load_memory()

            self.assertIsNotNone(loaded_memory)
            self.assertEqual(4, loaded_memory.covered_until_message_index)
            self.assertEqual("Implement phase 1", loaded_memory.current_task)
            self.assertEqual(["Add tests"], loaded_memory.open_loops)
            self.assertTrue(session.get_compactions_file_path().exists())

            with session.get_compactions_file_path().open("r", encoding="utf-8") as f:
                lines = [line.strip() for line in f if line.strip()]

            self.assertEqual(1, len(lines))
            self.assertIn("\"strategy\": \"forced\"", lines[0])

    def test_session_clear_removes_memory_and_compaction_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-1", temp_dir)
            session.save_memory(SessionMemorySnapshot(session_id="session-1"))
            session.append_compaction_record(
                SessionCompactionRecord(
                    compaction_id="compact-1",
                    strategy="background",
                    source_start_index=0,
                    source_end_index=1,
                    pre_tokens_estimate=100,
                    post_tokens_estimate=20,
                )
            )

            self.assertTrue(session.get_memory_file_path().exists())
            self.assertTrue(session.get_compactions_file_path().exists())

            session.clear()

            self.assertFalse(session.get_memory_file_path().exists())
            self.assertFalse(session.get_compactions_file_path().exists())


class AsyncSessionPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_session_persistence_round_trips_messages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = await Session.load_or_create("session-async", temp_dir)
            await session.add_message_async(
                Message(
                    role="user",
                    content="Persist this asynchronously",
                )
            )

            reloaded = await Session.load_or_create("session-async", temp_dir)

            self.assertEqual(1, len(reloaded.messages))
            self.assertEqual("Persist this asynchronously", reloaded.messages[0].content)

    async def test_async_session_memory_round_trips_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = await Session.load_or_create("session-async", temp_dir)
            memory = SessionMemorySnapshot(
                session_id="session-async",
                covered_until_message_index=7,
                current_task="Persist memory asynchronously",
            )

            await session.save_memory_async(memory)

            reloaded = await Session.load_or_create("session-async", temp_dir)
            loaded_memory = reloaded.load_memory()

            self.assertIsNotNone(loaded_memory)
            self.assertEqual(7, loaded_memory.covered_until_message_index)
            self.assertEqual("Persist memory asynchronously", loaded_memory.current_task)


if __name__ == "__main__":
    unittest.main()
