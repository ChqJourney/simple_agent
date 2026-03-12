import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.agent import Agent
from core.user import Session, UserManager
from llms.base import BaseLLM
from tools.base import ToolRegistry


class FakeReasoningLLM(BaseLLM):
    def __init__(self):
        super().__init__({'model': 'test-model'})

    async def stream(self, messages, tools=None):
        yield {
            'choices': [{'delta': {'reasoning_content': 'step 1'}}]
        }
        yield {
            'choices': [{'delta': {'reasoning_content': ' + step 2'}}]
        }
        yield {
            'choices': [{'delta': {'content': 'answer'}}]
        }

    async def complete(self, messages, tools=None):
        return {}


class ReasoningStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_emits_reasoning_events_and_persists_reasoning_content(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-1')
        await user_manager.bind_session_to_connection('session-1', 'conn-1')

        agent = Agent(FakeReasoningLLM(), ToolRegistry(), user_manager)
        await agent.run('hello', session)

        reasoning_tokens = [m for m in sent_messages if m.get('type') == 'reasoning_token']
        reasoning_complete = [m for m in sent_messages if m.get('type') == 'reasoning_complete']

        self.assertEqual(['step 1', ' + step 2'], [m['content'] for m in reasoning_tokens])
        self.assertEqual(1, len(reasoning_complete))
        self.assertEqual('step 1 + step 2', session.messages[-1].reasoning_content)
        self.assertEqual('answer', session.messages[-1].content)

        temp_dir.cleanup()


if __name__ == '__main__':
    unittest.main()
