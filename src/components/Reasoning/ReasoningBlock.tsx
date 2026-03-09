import React, { useState } from 'react';

interface ReasoningBlockProps {
  content: string;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="reasoning-block my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
      >
        <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
        <span>Reasoning</span>
      </button>
      
      {isExpanded && (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
};