import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Message, AssistantStatus } from '../../types';
import { StreamingMessage } from './StreamingMessage';
import { markdownComponents } from '../../utils/markdown';
import { ReasoningBlock } from '../Reasoning/ReasoningBlock';
import { ToolCallDisplay } from '../Tools/ToolCallDisplay';
import { UserStatusIndicator } from './UserStatusIndicator';
import { AssistantStatusIndicator } from './AssistantStatusIndicator';

interface MessageItemProps {
  message: Message;
  isStreaming?: boolean;
  streamingContent?: string;
  assistantStatus?: AssistantStatus;
  currentToolName?: string;
}

export const MessageItem = memo<MessageItemProps>(({
  message,
  isStreaming = false,
  streamingContent = '',
  assistantStatus,
  currentToolName,
}) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isReasoning = message.role === 'reasoning';
  const isTool = message.role === 'tool';

  if (isReasoning) {
    return <ReasoningBlock content={message.content || ''} />;
  }

  const hasBodyContent = Boolean(
    (isAssistant && isStreaming ? streamingContent : message.content) ||
      (message.tool_calls && message.tool_calls.length > 0)
  );

  return (
    <div
      className={`max-w-[85%] ${
        isUser
          ? 'ml-auto text-right'
          : isTool
            ? 'rounded-xl px-4 py-3 bg-orange-50 dark:bg-orange-950 text-sm'
            : ''
      }`}
    >
      <div className={`flex items-center mb-2 ${isUser ? 'justify-end gap-2' : 'justify-between'}`}>
        <span className="font-semibold text-xs text-gray-600 dark:text-gray-400">
          {isUser ? 'You' : isTool ? 'Tool' : 'Assistant'}
        </span>
        {message.usage && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {message.usage.total_tokens} tokens
          </span>
        )}
      </div>

      {hasBodyContent && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100 leading-relaxed">
          {isAssistant && isStreaming ? (
            streamingContent ? (
              <StreamingMessage content={streamingContent} isStreaming={true} />
            ) : null
          ) : (
            <ReactMarkdown components={markdownComponents}>
              {message.content || ''}
            </ReactMarkdown>
          )}

          {message.tool_calls && message.tool_calls.length > 0 && (
            <div className="mt-3 space-y-2">
              {message.tool_calls.map((toolCall) => (
                <ToolCallDisplay key={toolCall.tool_call_id} toolCall={toolCall} />
              ))}
            </div>
          )}
        </div>
      )}

      {isUser && message.userStatus && (
        <UserStatusIndicator status={message.userStatus} />
      )}

      {isAssistant && assistantStatus && (isStreaming || assistantStatus === 'completed') && (
        <AssistantStatusIndicator status={assistantStatus} toolName={currentToolName} />
      )}
    </div>
  );
});

MessageItem.displayName = 'MessageItem';
