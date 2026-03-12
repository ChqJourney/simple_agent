import { memo, useRef, useEffect } from 'react';
import { Message, AssistantStatus } from '../../types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  currentStreamingContent?: string;
  currentReasoningContent?: string;
  isStreaming?: boolean;
  assistantStatus?: AssistantStatus;
  currentToolName?: string;
}

export const MessageList = memo<MessageListProps>(({
  messages,
  currentStreamingContent = '',
  currentReasoningContent = '',
  isStreaming = false,
  assistantStatus,
  currentToolName,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, currentStreamingContent, currentReasoningContent]);

  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const completedAssistantMessageId = !isStreaming && assistantStatus === 'completed'
    ? lastAssistantMessage?.id
    : undefined;

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && !isStreaming && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <p>Start a conversation</p>
        </div>
      )}

      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          assistantStatus={message.id === completedAssistantMessageId ? 'completed' : undefined}
          currentToolName={message.id === completedAssistantMessageId ? currentToolName : undefined}
        />
      ))}

      {isStreaming && currentReasoningContent && (
        <MessageItem
          message={{
            id: 'streaming-reasoning',
            role: 'reasoning',
            content: currentReasoningContent,
            status: 'streaming',
          }}
        />
      )}

      {isStreaming && (
        <MessageItem
          message={{
            id: 'streaming',
            role: 'assistant',
            content: '',
            status: 'streaming',
          }}
          isStreaming={true}
          streamingContent={currentStreamingContent}
          assistantStatus={assistantStatus}
          currentToolName={currentToolName}
        />
      )}
    </div>
  );
});

MessageList.displayName = 'MessageList';
