import React from 'react';
import { Message } from '../../types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  currentStreamingContent?: string;
  currentReasoningContent?: string;
  isStreaming?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  currentStreamingContent = '',
  currentReasoningContent = '',
  isStreaming = false,
}) => {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, currentStreamingContent, currentReasoningContent]);

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
        />
      ))}
      
      {isStreaming && currentStreamingContent && (
        <MessageItem
          message={{
            id: 'streaming',
            role: 'assistant',
            content: '',
            status: 'streaming',
          }}
          isStreaming={true}
          streamingContent={currentStreamingContent}
        />
      )}
    </div>
  );
};