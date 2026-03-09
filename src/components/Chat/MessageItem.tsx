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
    <div className={`message-item ${message.role}`}>
      <div className="message-header">
        <span className="message-role">
          {isUser ? 'You' : isTool ? 'Tool' : 'Assistant'}
        </span>
        {message.usage && (
          <span className="message-usage">
            {message.usage.total_tokens} tokens
          </span>
        )}
      </div>
      
      <div className="message-content">
        {isAssistant && isStreaming && streamingContent ? (
          <StreamingMessage content={streamingContent} isStreaming={true} />
        ) : (
          <ReactMarkdown components={markdownComponents}>
            {message.content || ''}
          </ReactMarkdown>
        )}
        
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="tool-calls">
            {message.tool_calls.map((toolCall) => (
              <ToolCallDisplay key={toolCall.tool_call_id} toolCall={toolCall} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};