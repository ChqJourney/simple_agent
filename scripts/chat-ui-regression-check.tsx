import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCallDisplay } from '../src/components/Tools/ToolCallDisplay';
import { MessageItem } from '../src/components/Chat/MessageItem';
import { MessageList } from '../src/components/Chat/MessageList';
import { ReasoningBlock } from '../src/components/Reasoning/ReasoningBlock';
import { useChatStore } from '../src/stores/chatStore';
import { deserializeSessionHistoryEntry } from '../src/utils/storage';

function textContent(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function resetStore() {
  useChatStore.setState({ sessions: {} });
}

function checkToolCallSummary() {
  const markup = renderToStaticMarkup(
    <ToolCallDisplay
      toolCall={{
        tool_call_id: 'call-1',
        name: 'file_write',
        arguments: { path: 'notes.txt', content: 'hello' },
      }}
    />
  );

  const text = textContent(markup);
  assert.match(text, /请求执行 file_write/, 'tool call should render collapsed request summary');
  assert.doesNotMatch(markup, /rounded-2xl/, 'tool call should no longer render as a card');
  assert.doesNotMatch(markup, /bg-gray-100\/90/, 'tool call should no longer use a card background');
  assert.match(markup, /cursor-pointer/, 'tool call summary should remain visibly clickable');
}

function checkToolDecisionSummary() {
  resetStore();
  const store = useChatStore.getState();
  store.addToolDecision('session-1', 'call-1', 'file_write', 'approve_once', 'session');
  const session = useChatStore.getState().sessions['session-1'];
  const toolDecisionMessage = session.messages[0];

  assert.equal(
    toolDecisionMessage.content,
    '请求执行 file_write accept once',
    'tool decision content should use the approved summary copy'
  );

  const markup = renderToStaticMarkup(<MessageItem message={toolDecisionMessage} />);
  const text = textContent(markup);
  assert.match(text, /请求执行 file_write accept once/, 'tool decision card should show the approved summary');
  assert.doesNotMatch(markup, /rounded-2xl/, 'tool decision should no longer render as a card');
}

function checkToolResultSummary() {
  resetStore();
  useChatStore.setState({
    sessions: {
      'session-1': {
        messages: [],
        currentStreamingContent: '',
        currentReasoningContent: '',
        isStreaming: false,
        assistantStatus: 'idle',
        currentToolName: undefined,
        pendingToolConfirm: undefined,
      },
    },
  });

  const store = useChatStore.getState();
  store.setToolResult('session-1', 'call-2', true, { ok: true }, undefined, 'file_write');
  const session = useChatStore.getState().sessions['session-1'];
  const toolResultMessage = session.messages[0];

  assert.equal(
    toolResultMessage.content,
    'file_write 执行成功',
    'tool result collapsed summary should indicate success with tool name'
  );

  const markup = renderToStaticMarkup(<MessageItem message={toolResultMessage} />);
  const text = textContent(markup);
  assert.match(text, /file_write 执行成功/, 'tool result card should show the collapsed summary');
  assert.doesNotMatch(markup, /rounded-2xl/, 'tool result should no longer render as a card');
}

function checkAssistantLabelPrecedesThinking() {
  const markup = renderToStaticMarkup(
    <MessageList
      messages={[
        {
          id: 'reasoning-1',
          role: 'reasoning',
          content: 'internal trace',
          status: 'completed',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'final answer',
          status: 'completed',
        },
      ]}
    />
  );

  const text = textContent(markup);
  const assistantIndex = text.indexOf('Assistant');
  const thinkingIndex = text.indexOf('Thinking');

  assert.notEqual(assistantIndex, -1, 'assistant label should be rendered');
  assert.notEqual(thinkingIndex, -1, 'thinking label should be rendered');
  assert.ok(assistantIndex < thinkingIndex, 'assistant label should appear before the thinking block');
}

function checkThinkingBlockIsTextual() {
  const markup = renderToStaticMarkup(<ReasoningBlock content="internal trace" />);

  assert.match(markup, /cursor-pointer/, 'thinking summary should show a pointer cursor');
  assert.doesNotMatch(markup, /rounded-2xl/, 'thinking block should no longer render as a card');
  assert.doesNotMatch(markup, /bg-gray-100\/90/, 'thinking block should no longer use a card background');
}

function checkPersistedToolMessagesAreNormalized() {
  const toolNamesById = new Map<string, string>();
  const [assistantMessage] = deserializeSessionHistoryEntry(
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'file_write',
            arguments: '{"path":"test.txt","content":"hello"}',
          },
        },
      ],
    },
    toolNamesById
  );

  assert.equal(assistantMessage.tool_calls?.[0]?.name, 'file_write');
  assert.deepEqual(assistantMessage.tool_calls?.[0]?.arguments, {
    path: 'test.txt',
    content: 'hello',
  });

  const assistantMarkup = renderToStaticMarkup(<MessageItem message={assistantMessage} />);
  const assistantText = textContent(assistantMarkup);
  assert.match(
    assistantText,
    /\u8bf7\u6c42\u6267\u884c file_write/,
    'persisted assistant tool call should render the tool name instead of undefined'
  );

  const [decisionMessage] = deserializeSessionHistoryEntry(
    {
      role: 'tool',
      tool_call_id: 'call-1',
      name: 'tool_decision',
      content: 'decision=approve_once; scope=session; reason=user_action',
    },
    toolNamesById
  );

  const decisionMarkup = renderToStaticMarkup(<MessageItem message={decisionMessage} />);
  const decisionText = textContent(decisionMarkup);
  assert.match(
    decisionText,
    /\u8bf7\u6c42\u6267\u884c file_write accept once/,
    'persisted tool decision should render the normalized summary copy'
  );
  assert.doesNotMatch(
    decisionText,
    /decision=approve_once; scope=session; reason=user_action/,
    'persisted tool decision should not leak the raw serialized payload'
  );

  const [resultMessage] = deserializeSessionHistoryEntry(
    {
      role: 'tool',
      tool_call_id: 'call-1',
      name: 'file_write',
      content: 'Successfully wrote to C:\\\\temp\\\\test.txt',
    },
    toolNamesById
  );

  const resultMarkup = renderToStaticMarkup(<MessageItem message={resultMessage} />);
  const resultText = textContent(resultMarkup);
  assert.match(
    resultText,
    /file_write \u6267\u884c\u6210\u529f/,
    'persisted tool result should render a collapsed success summary'
  );
  assert.doesNotMatch(
    resultText,
    /Successfully wrote to C:\\temp\\test.txt/,
    'persisted tool result should hide raw details while collapsed'
  );
}

try {
  checkToolCallSummary();
  checkToolDecisionSummary();
  checkToolResultSummary();
  checkAssistantLabelPrecedesThinking();
  checkThinkingBlockIsTextual();
  checkPersistedToolMessagesAreNormalized();
  console.log('chat ui regression checks passed');
} catch (error) {
  console.error('chat ui regression checks failed');
  throw error;
}
