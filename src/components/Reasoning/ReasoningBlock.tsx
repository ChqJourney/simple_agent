import React, { useState } from 'react';

interface ReasoningBlockProps {
  content: string;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="my-2 bg-gray-50 dark:bg-gray-800 border-l-4 border-gray-400 dark:border-gray-500 px-3 py-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
      >
        <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
        <span className="font-medium">Reasoning</span>
      </button>
      
      {isExpanded && (
        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
};