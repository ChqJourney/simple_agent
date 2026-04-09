import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.agent import Agent
from core.user import Message, Session, UserManager
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


class SlowStreamingLLM(BaseLLM):
    def __init__(self):
        super().__init__({'model': 'slow-test-model'})
        self.first_chunk_sent = asyncio.Event()
        self.resume_stream = asyncio.Event()

    async def stream(self, messages, tools=None):
        yield {
            'choices': [{'delta': {'content': 'partial'}}]
        }
        self.first_chunk_sent.set()
        await self.resume_stream.wait()
        yield {
            'choices': [{'delta': {'content': ' tail'}}]
        }

    async def complete(self, messages, tools=None):
        return {}


class HangingStreamingLLM(BaseLLM):
    def __init__(self):
        super().__init__({'model': 'hanging-test-model'})
        self.stream_started = asyncio.Event()

    async def stream(self, messages, tools=None):
        self.stream_started.set()
        await asyncio.Future()
        if False:
            yield {
                'choices': [{'delta': {'content': 'never'}}]
            }

    async def complete(self, messages, tools=None):
        return {}


class TimeoutBeforeFirstChunkLLM(BaseLLM):
    def __init__(self):
        super().__init__({
            'model': 'timeout-before-first-chunk',
            'runtime': {'timeout_seconds': 0.05},
        })
        self.stream_attempts = 0
        self.closed = 0

    async def stream(self, messages, tools=None):
        self.stream_attempts += 1
        try:
            await asyncio.Future()
        finally:
            self.closed += 1
        if False:
            yield {}

    async def complete(self, messages, tools=None):
        return {}


class TimeoutAfterPartialChunkLLM(BaseLLM):
    def __init__(self):
        super().__init__({
            'model': 'timeout-after-partial-chunk',
            'runtime': {'timeout_seconds': 0.05},
        })
        self.closed = 0

    async def stream(self, messages, tools=None):
        try:
            yield {
                'choices': [{'delta': {'content': 'partial answer'}}]
            }
            await asyncio.Future()
        finally:
            self.closed += 1

    async def complete(self, messages, tools=None):
        return {}


class UsageReportingLLM(BaseLLM):
    def __init__(self):
        super().__init__({
            'model': 'usage-test-model',
            'runtime': {'context_length': 128000},
        })

    async def stream(self, messages, tools=None):
        self.latest_usage = {
            'prompt_tokens': 4096,
            'completion_tokens': 256,
            'total_tokens': 4352,
            'context_length': 128000,
        }
        yield {
            'choices': [{'delta': {'content': 'usage aware answer'}}]
        }

    async def complete(self, messages, tools=None):
        return {}


class ToolCallProgressLLM(BaseLLM):
    def __init__(self):
        super().__init__({'model': 'tool-progress-test-model'})

    async def stream(self, messages, tools=None):
        yield {
            'choices': [{
                'delta': {
                    'tool_calls': [{
                        'index': 0,
                        'id': 'tool-1',
                        'function': {'name': 'file_write'},
                    }]
                }
            }]
        }
        yield {
            'choices': [{
                'delta': {
                    'tool_calls': [{
                        'index': 0,
                        'function': {'arguments': '{"path":"notes.txt","content":"'},
                    }]
                }
            }]
        }
        yield {
            'choices': [{
                'delta': {
                    'tool_calls': [{
                        'index': 0,
                        'function': {'arguments': ('x' * 2500) + '"}'},
                    }]
                }
            }]
        }

    async def complete(self, messages, tools=None):
        return {}


class CapturingWindowedLLM(BaseLLM):
    def __init__(self):
        super().__init__({
            'model': 'windowed-test-model',
            'runtime': {
                'context_length': 120,
                'max_output_tokens': 20,
            },
        })
        self.seen_messages = []

    async def stream(self, messages, tools=None):
        self.seen_messages = list(messages)
        yield {
            'choices': [{'delta': {'content': 'trimmed answer'}}]
        }

    async def complete(self, messages, tools=None):
        return {}


class ForcedCompactionStreamingLLM(BaseLLM):
    def __init__(self):
        super().__init__({
            'model': 'forced-windowed-test-model',
            'runtime': {
                'context_length': 420,
                'max_output_tokens': 40,
            },
        })
        self.seen_messages = []

    async def stream(self, messages, tools=None):
        self.seen_messages = list(messages)
        yield {
            'choices': [{'delta': {'content': 'compacted answer'}}]
        }

    async def complete(self, messages, tools=None):
        return {}


class MediumContextStreamingLLM(BaseLLM):
    def __init__(self):
        super().__init__({
            'model': 'medium-windowed-test-model',
            'runtime': {
                'context_length': 32000,
                'max_output_tokens': 2048,
            },
        })
        self.seen_messages = []

    async def stream(self, messages, tools=None):
        self.seen_messages = list(messages)
        yield {
            'choices': [{'delta': {'content': 'medium answer'}}]
        }

    async def complete(self, messages, tools=None):
        return {}


class FakeCompactionLLM(BaseLLM):
    def __init__(self):
        super().__init__({
            'provider': 'openai',
            'profile_name': 'background',
            'model': 'fake-compactor',
        })
        self.complete_calls = 0
        self.closed = False

    async def stream(self, messages, tools=None):
        if False:
            yield {}

    async def complete(self, messages, tools=None):
        self.complete_calls += 1
        return {
            'choices': [
                {
                    'message': {
                        'content': json.dumps(
                            {
                                'current_task': 'Keep the session moving',
                                'completed_milestones': ['Captured older context'],
                                'decisions_and_constraints': ['Preserve recent raw turns'],
                                'important_user_preferences': [],
                                'important_files_and_paths': [],
                                'key_tool_results': [],
                                'open_loops': ['Continue with the latest request'],
                                'risks_or_unknowns': [],
                                'raw_summary_text': 'Older context was compacted.',
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ]
        }

    async def aclose(self):
        self.closed = True


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

    async def test_stream_llm_response_emits_tool_call_progress_before_tool_call_is_complete(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-1')
        await user_manager.bind_session_to_connection('session-1', 'conn-1')

        agent = Agent(ToolCallProgressLLM(), ToolRegistry(), user_manager)
        assistant_message = await agent._stream_llm_response([], [], session, 'run-1')

        progress_messages = [m for m in sent_messages if m.get('type') == 'tool_call_progress']
        self.assertGreaterEqual(len(progress_messages), 2)
        self.assertEqual('file_write', progress_messages[0]['name'])
        self.assertEqual(0, progress_messages[0]['arguments_character_count'])
        self.assertGreaterEqual(progress_messages[-1]['arguments_character_count'], 2500)
        self.assertEqual('file_write', assistant_message.tool_calls[0]['function']['name'])

        temp_dir.cleanup()

    async def test_interrupt_during_stream_persists_partial_assistant_for_follow_up_context(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = SlowStreamingLLM()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-1')
        await user_manager.bind_session_to_connection('session-1', 'conn-1')

        agent = Agent(llm, ToolRegistry(), user_manager)
        task = asyncio.create_task(agent.run('hello', session))

        await asyncio.wait_for(llm.first_chunk_sent.wait(), timeout=1)
        agent.interrupt()
        llm.resume_stream.set()
        await asyncio.wait_for(task, timeout=1)

        event_types = [message.get('type') for message in sent_messages]
        self.assertIn('interrupted', event_types)
        self.assertNotIn('completed', event_types)
        self.assertEqual(['user', 'assistant'], [message.role for message in session.messages])
        self.assertEqual('partial', session.messages[-1].content)

        temp_dir.cleanup()

    async def test_cancelled_stream_does_not_persist_empty_assistant_message(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = HangingStreamingLLM()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-1')
        await user_manager.bind_session_to_connection('session-1', 'conn-1')

        agent = Agent(llm, ToolRegistry(), user_manager)
        task = asyncio.create_task(agent.run('hello', session))

        await asyncio.wait_for(llm.stream_started.wait(), timeout=1)
        task.cancel()
        await asyncio.wait_for(task, timeout=1)

        event_types = [message.get('type') for message in sent_messages]
        self.assertIn('interrupted', event_types)
        self.assertNotIn('completed', event_types)
        self.assertEqual(['user'], [message.role for message in session.messages])

        temp_dir.cleanup()

    async def test_stream_timeout_before_first_chunk_retries_and_finishes_with_error(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = TimeoutBeforeFirstChunkLLM()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-timeout-first')
        await user_manager.bind_session_to_connection('session-timeout-first', 'conn-1')

        agent = Agent(llm, ToolRegistry(), user_manager, max_retries=2)
        await asyncio.wait_for(agent.run('hello', session), timeout=5)

        retry_messages = [message for message in sent_messages if message.get('type') == 'retry']
        error_messages = [message for message in sent_messages if message.get('type') == 'error']

        self.assertEqual(2, llm.stream_attempts)
        self.assertEqual(2, llm.closed)
        self.assertEqual(1, len(retry_messages))
        self.assertEqual(1, len(error_messages))
        self.assertFalse(error_messages[0].get('preserve_partial'))
        self.assertEqual(['user'], [message.role for message in session.messages])

        temp_dir.cleanup()

    async def test_stream_timeout_after_partial_chunk_preserves_partial_without_retrying(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = TimeoutAfterPartialChunkLLM()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-timeout-partial')
        await user_manager.bind_session_to_connection('session-timeout-partial', 'conn-1')

        agent = Agent(llm, ToolRegistry(), user_manager, max_retries=2)
        await asyncio.wait_for(agent.run('hello', session), timeout=3)

        retry_messages = [message for message in sent_messages if message.get('type') == 'retry']
        error_messages = [message for message in sent_messages if message.get('type') == 'error']

        self.assertEqual(1, llm.closed)
        self.assertEqual([], retry_messages)
        self.assertEqual(1, len(error_messages))
        self.assertTrue(error_messages[0].get('preserve_partial'))
        self.assertEqual(['user', 'assistant'], [message.role for message in session.messages])
        self.assertEqual('partial answer', session.messages[-1].content)

        temp_dir.cleanup()

    async def test_agent_completed_event_includes_latest_usage_snapshot(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-1')
        await user_manager.bind_session_to_connection('session-1', 'conn-1')

        agent = Agent(UsageReportingLLM(), ToolRegistry(), user_manager)
        await agent.run('hello', session)

        completed = [m for m in sent_messages if m.get('type') == 'completed']

        self.assertEqual(1, len(completed))
        self.assertEqual(4096, completed[0]['usage']['prompt_tokens'])
        self.assertEqual(128000, completed[0]['usage']['context_length'])
        self.assertEqual(4096, session.messages[-1].usage['prompt_tokens'])

        session_path = Path(temp_dir.name) / '.agent' / 'sessions' / 'session-1.jsonl'
        persisted_entries = [
            json.loads(line)
            for line in session_path.read_text(encoding='utf-8').splitlines()
            if line.strip()
        ]
        self.assertEqual(4096, persisted_entries[-1]['usage']['prompt_tokens'])
        self.assertEqual(128000, persisted_entries[-1]['usage']['context_length'])

        temp_dir.cleanup()

    async def test_agent_trims_old_history_to_fit_context_window(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = CapturingWindowedLLM()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-1')
        await user_manager.bind_session_to_connection('session-1', 'conn-1')

        await session.add_message_async(Message(role='user', content='old-user-' + ('a' * 220)))
        await session.add_message_async(Message(role='assistant', content='old-assistant-' + ('b' * 220)))
        await session.add_message_async(Message(role='user', content='recent-user-' + ('c' * 60)))

        agent = Agent(llm, ToolRegistry(), user_manager)
        await agent.run('latest prompt', session)

        serialized_messages = [str(message.get('content')) for message in llm.seen_messages]
        self.assertTrue(any('latest prompt' in content for content in serialized_messages))
        self.assertFalse(any('old-user-' in content for content in serialized_messages))
        self.assertTrue(serialized_messages[0])
        self.assertEqual('system', llm.seen_messages[0]['role'])

        temp_dir.cleanup()

    async def test_agent_forced_compaction_persists_memory_and_replays_memory_plus_recent_turns(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = ForcedCompactionStreamingLLM()
        compaction_llms = []

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-compact')
        await user_manager.bind_session_to_connection('session-compact', 'conn-1')

        for index in range(13):
            await session.add_message_async(
                Message(
                    role='user' if index % 2 == 0 else 'assistant',
                    content=f'old-message-{index}-' + ('x' * 90),
                )
            )
        await session.add_message_async(
            Message(
                role='assistant',
                content='latest usage anchor',
                usage={
                    'prompt_tokens': 360,
                    'completion_tokens': 40,
                    'total_tokens': 400,
                    'context_length': 420,
                },
            )
        )

        def make_compaction_llm():
            llm_instance = FakeCompactionLLM()
            compaction_llms.append(llm_instance)
            return llm_instance

        agent = Agent(
            llm,
            ToolRegistry(),
            user_manager,
            compaction_llm_factory=make_compaction_llm,
        )
        await agent.run('latest prompt for compaction', session)

        memory = session.load_memory()
        self.assertIsNotNone(memory)
        self.assertEqual(6, memory.covered_until_message_index)
        self.assertEqual('Keep the session moving', memory.current_task)
        self.assertEqual(1, len(compaction_llms))
        self.assertEqual(1, compaction_llms[0].complete_calls)
        self.assertTrue(compaction_llms[0].closed)

        contents = [str(message.get('content')) for message in llm.seen_messages]
        self.assertEqual('system', llm.seen_messages[0]['role'])
        self.assertTrue(any('Session memory (compacted history):' in content for content in contents))
        self.assertFalse(any('old-message-0-' in content for content in contents))
        self.assertTrue(any('latest prompt for compaction' in content for content in contents))
        self.assertTrue(
            any(
                message.get('type') == 'run_event'
                and message.get('event', {}).get('event_type') == 'session_compaction_completed'
                for message in sent_messages
            )
        )
        compaction_completed = next(
            message.get('event')
            for message in sent_messages
            if message.get('type') == 'run_event'
            and message.get('event', {}).get('event_type') == 'session_compaction_completed'
        )
        self.assertEqual(420, compaction_completed['payload']['context_length'])

        temp_dir.cleanup()

    async def test_agent_schedules_background_compaction_without_blocking_current_response(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = CapturingWindowedLLM()
        scheduled_runs = []

        async def send_callback(message):
            sent_messages.append(message)

        async def background_scheduler(session, run_id):
            scheduled_runs.append((session.session_id, run_id))

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-bg')
        await user_manager.bind_session_to_connection('session-bg', 'conn-1')

        for index in range(15):
            await session.add_message_async(
                Message(
                    role='user' if index % 2 == 0 else 'assistant',
                    content=f'background-message-{index}-' + ('y' * 24),
                )
            )
        await session.add_message_async(
            Message(
                role='assistant',
                content='latest usage anchor',
                usage={
                    'prompt_tokens': 80,
                    'completion_tokens': 10,
                    'total_tokens': 90,
                    'context_length': 120,
                },
            )
        )

        agent = Agent(
            llm,
            ToolRegistry(),
            user_manager,
            background_compaction_scheduler=background_scheduler,
        )

        await agent.run('continue current task', session)

        self.assertEqual(1, len(scheduled_runs))
        self.assertEqual('session-bg', scheduled_runs[0][0])
        self.assertTrue(any(message.get('type') == 'completed' for message in sent_messages))

        temp_dir.cleanup()

    async def test_agent_schedules_background_compaction_from_latest_real_usage_for_chinese_session(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = MediumContextStreamingLLM()
        scheduled_runs = []

        async def send_callback(message):
            sent_messages.append(message)

        async def background_scheduler(session, run_id):
            scheduled_runs.append((session.session_id, run_id))

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-chinese-bg')
        await user_manager.bind_session_to_connection('session-chinese-bg', 'conn-1')

        prompts = [
            '读取 clock_history.md，总结一下',
            '预测一下未来的时钟会什么样',
            '时间到底是什么东西',
            '写首现代诗吧，时间的神秘',
            '再来一首七绝吧',
            '把刚才的内容写入当前目录',
        ]
        for index, prompt in enumerate(prompts):
            await session.add_message_async(
                Message(
                    role='user' if index % 2 == 0 else 'assistant',
                    content=prompt + ('，' + ('时' * 80)),
                )
            )
        await session.add_message_async(
            Message(
                role='assistant',
                content='上一轮回答',
                usage={
                    'prompt_tokens': 23600,
                    'completion_tokens': 120,
                    'total_tokens': 23720,
                    'context_length': 32000,
                },
            )
        )

        agent = Agent(
            llm,
            ToolRegistry(),
            user_manager,
            background_compaction_scheduler=background_scheduler,
        )

        await agent.run('继续', session)

        self.assertEqual(1, len(scheduled_runs))
        self.assertEqual('session-chinese-bg', scheduled_runs[0][0])
        self.assertTrue(any(message.get('type') == 'completed' for message in sent_messages))

        temp_dir.cleanup()

    async def test_agent_emits_background_compaction_skipped_when_soft_threshold_has_no_old_prefix(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        sent_messages = []
        user_manager = UserManager()
        llm = MediumContextStreamingLLM()

        async def send_callback(message):
            sent_messages.append(message)

        await user_manager.register_connection('conn-1', send_callback)
        session = await user_manager.create_session(temp_dir.name, 'session-bg-skip')
        await user_manager.bind_session_to_connection('session-bg-skip', 'conn-1')

        await session.add_message_async(Message(role='user', content='第一轮问题'))
        await session.add_message_async(
            Message(
                role='assistant',
                content='上一轮回答',
                usage={
                    'prompt_tokens': 22000,
                    'completion_tokens': 200,
                    'total_tokens': 22200,
                    'context_length': 32000,
                },
            )
        )

        agent = Agent(
            llm,
            ToolRegistry(),
            user_manager,
            background_compaction_scheduler=lambda current_session, run_id: asyncio.sleep(0),
        )

        await agent.run('continue fresh task', session)

        skipped_event = next(
            (
                message.get('event')
                for message in sent_messages
                if message.get('type') == 'run_event'
                and message.get('event', {}).get('event_type') == 'session_compaction_skipped'
            ),
            None,
        )
        self.assertIsNotNone(skipped_event)
        self.assertEqual('background', skipped_event['payload']['strategy'])
        self.assertEqual('no_compactable_prefix', skipped_event['payload']['reason'])

        temp_dir.cleanup()


if __name__ == '__main__':
    unittest.main()
