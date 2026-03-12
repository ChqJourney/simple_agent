import React, { useState } from 'react';

interface ReasoningBlockProps {
  content: string;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="text-gray-500 dark:text-gray-400">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left text-sm transition-colors hover:text-gray-700 dark:hover:text-gray-300"
      >
        <span className="font-medium">Thinking</span>
        <svg
          className={`h-4 w-4 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isExpanded && (
        <div className="mt-1 whitespace-pre-wrap pl-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {content}
        </div>
      )}
    </div>
  );
};
