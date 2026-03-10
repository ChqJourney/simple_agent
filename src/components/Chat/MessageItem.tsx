import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Message } from '../../types';
import { StreamingMessage } from './StreamingMessage';
import { markdownComponents } from '../../utils/markdown';
import { ReasoningBlock } from '../Reasoning/ReasoningBlock';
import { ToolCallDisplay } from '../Tools/ToolCallDisplay';

interface MessageItemProps {
  message: Message;
  isStreaming?: boolean;
  streamingContent?: string;
}

export const MessageItem: React.FC<MessageItemProps> = ({ 
  message, 
  isStreaming = false,
  streamingContent = '',
}) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isReasoning = message.role === 'reasoning';
  const isTool = message.role === 'tool';

  if (isReasoning) {
    return <ReasoningBlock content={message.content || ''} />;
  }

  return (
    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
      isUser 
        ? 'ml-auto bg-blue-50 dark:bg-blue-950' 
        : isTool 
        ? 'bg-orange-50 dark:bg-orange-950 rounded-xl text-sm'
        : 'bg-gray-50 dark:bg-gray-800'
    }`}>
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-xs text-gray-600 dark:text-gray-400">
          {isUser ? 'You' : isTool ? 'Tool' : 'Assistant'}
        </span>
        {message.usage && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {message.usage.total_tokens} tokens
          </span>
        )}
      </div>
      
      <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100 leading-relaxed">
        {isAssistant && isStreaming && streamingContent ? (
          <StreamingMessage content={streamingContent} isStreaming={true} />
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
    </div>
  );
};