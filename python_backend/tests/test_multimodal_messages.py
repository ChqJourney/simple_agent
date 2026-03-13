import base64
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.user import Message, Session


class MultimodalMessageTests(unittest.TestCase):
    def test_session_persists_and_reloads_image_attachments(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "diagram.png"
            image_path.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRXcAAAAASUVORK5CYII="))

            session = Session("session-1", temp_dir)
            session.add_message(
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
            )

            reloaded = Session("session-1", temp_dir)

            self.assertEqual(1, len(reloaded.messages))
            self.assertEqual("image", reloaded.messages[0].attachments[0]["kind"])
            self.assertEqual(str(image_path), reloaded.messages[0].attachments[0]["path"])

    def test_get_messages_for_llm_embeds_image_attachments_as_data_urls(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "diagram.png"
            image_path.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRXcAAAAASUVORK5CYII="))

            session = Session("session-1", temp_dir)
            session.add_message(
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
            )

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
            session.add_message(
                Message(
                    role="user",
                    content="Check these paths:\n- src/app.ts\n- src/components",
                )
            )

            llm_messages = session.get_messages_for_llm()

            self.assertEqual(
                "Check these paths:\n- src/app.ts\n- src/components",
                llm_messages[0]["content"],
            )


if __name__ == "__main__":
    unittest.main()
