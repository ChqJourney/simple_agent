import React from 'react';
import ReactMarkdown from 'react-markdown';
import { markdownComponents } from '../../utils/markdown';

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export const StreamingMessage: React.FC<StreamingMessageProps> = ({ content, isStreaming }) => {
  return (
    <div className="streaming-message">
      <ReactMarkdown components={markdownComponents}>
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="cursor animate-pulse">|</span>}
    </div>
  );
};