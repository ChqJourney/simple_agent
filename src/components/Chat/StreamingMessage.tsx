import React, { useDeferredValue, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { markdownComponents, markdownRemarkPlugins, parseMarkdown } from '../../utils/markdown';

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export const StreamingMessage: React.FC<StreamingMessageProps> = ({ content, isStreaming }) => {
  const deferredContent = useDeferredValue(content);
  const renderedContent = isStreaming ? deferredContent : content;
  const parsedMarkdown = useMemo(
    () => parseMarkdown(renderedContent),
    [renderedContent],
  );

  return (
    <div className="min-h-5">
      <ReactMarkdown components={markdownComponents} remarkPlugins={markdownRemarkPlugins}>
        {parsedMarkdown}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-0.5 h-5 bg-gray-900 dark:bg-gray-100 animate-blink align-bottom ml-0.5">|</span>}
    </div>
  );
};
