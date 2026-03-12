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

  const renderedMessages: React.ReactNode[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.role === 'reasoning') {
      const nextMessage = messages[index + 1];

      if (nextMessage?.role === 'assistant') {
        renderedMessages.push(
          <MessageItem
            key={nextMessage.id}
            message={nextMessage}
            reasoningContent={message.content || ''}
            assistantStatus={nextMessage.id === completedAssistantMessageId ? 'completed' : undefined}
            currentToolName={nextMessage.id === completedAssistantMessageId ? currentToolName : undefined}
          />
        );
        index += 1;
        continue;
      }
    }

    renderedMessages.push(
      <MessageItem
        key={message.id}
        message={message}
        assistantStatus={message.id === completedAssistantMessageId ? 'completed' : undefined}
        currentToolName={message.id === completedAssistantMessageId ? currentToolName : undefined}
      />
    );
  }

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-6 md:px-6">
      {messages.length === 0 && !isStreaming && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <p>Just input what you want</p>
        </div>
      )}

      <div className="space-y-5">
        {renderedMessages}

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
            reasoningContent={currentReasoningContent}
            assistantStatus={assistantStatus}
            currentToolName={currentToolName}
          />
        )}
      </div>
    </div>
  );
});

MessageList.displayName = 'MessageList';
