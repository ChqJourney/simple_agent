import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Message, AssistantStatus } from '../../types';
import { StreamingMessage } from './StreamingMessage';
import { markdownComponents, markdownRemarkPlugins, parseMarkdown } from '../../utils/markdown';
import { ReasoningBlock } from '../Reasoning/ReasoningBlock';
import { ToolCallDisplay, ToolMessageDisplay } from '../Tools';
import { UserStatusIndicator } from './UserStatusIndicator';
import { AssistantStatusIndicator } from './AssistantStatusIndicator';
import { CopyMessageButton } from './CopyMessageButton';
import { ImageAttachmentGallery } from './ImageAttachmentGallery';

interface MessageItemProps {
  message: Message;
  isStreaming?: boolean;
  streamingContent?: string;
  reasoningContent?: string;
  assistantStatus?: AssistantStatus;
  currentToolName?: string;
  hideHeader?: boolean;
}

export const MessageItem = memo<MessageItemProps>(({
  message,
  isStreaming = false,
  streamingContent = '',
  reasoningContent = '',
  assistantStatus,
  currentToolName,
  hideHeader = false,
}) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isReasoning = message.role === 'reasoning';
  const isTool = message.role === 'tool';

  if (isTool) {
    return <ToolMessageDisplay message={message} collapsible={true} />;
  }

  if (isReasoning) {
    return (
      <div className="w-full">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            Assistant
          </span>
        </div>
        <ReasoningBlock content={message.content || ''} />
      </div>
    );
  }

  const hasBodyContent = Boolean(
    (isAssistant && isStreaming ? streamingContent : message.content) ||
      (message.attachments && message.attachments.length > 0) ||
      (message.tool_calls && message.tool_calls.length > 0)
  );
  const hasReasoning = Boolean(reasoningContent);
  const copyableContent = (isAssistant && isStreaming ? streamingContent : message.content)?.trim() || '';
  const hasCopyableContent = copyableContent.length > 0;
  const bodyClassName = isUser
    ? `prose prose-sm max-w-none rounded-[1.35rem] border border-slate-200 bg-slate-100/90 px-4 py-3 text-gray-900 shadow-sm dark:border-slate-700 dark:bg-slate-800/85 dark:text-gray-100 dark:prose-invert ${hasReasoning ? 'mt-3' : ''}`
    : `prose prose-sm max-w-none text-gray-900 leading-relaxed dark:prose-invert dark:text-gray-100 ${hasReasoning ? 'mt-3' : ''}`;

  return (
    <div
      className={`${
        isUser
          ? 'w-full max-w-[80%]'
          : 'w-full max-w-none'
      }`}
    >
      {!hideHeader && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold text-xs text-gray-600 dark:text-gray-400">
            {isUser ? 'You' : 'Assistant'}
          </span>
          <div className="flex items-center gap-2">
            {message.usage && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {message.usage.total_tokens} tokens
              </span>
            )}
            {hasCopyableContent && <CopyMessageButton text={copyableContent} />}
          </div>
        </div>
      )}

      {hasReasoning && <ReasoningBlock content={reasoningContent} />}

      {hasBodyContent && (
        <div className={bodyClassName}>
          {isAssistant && isStreaming ? (
            streamingContent ? (
              <StreamingMessage content={streamingContent} isStreaming={true} />
            ) : null
          ) : (
            <ReactMarkdown components={markdownComponents} remarkPlugins={markdownRemarkPlugins}>
              {parseMarkdown(message.content || '')}
            </ReactMarkdown>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <ImageAttachmentGallery attachments={message.attachments} align="start" />
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
