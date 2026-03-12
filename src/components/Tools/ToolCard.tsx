import React, { useState } from 'react';

type ToolCardTone = 'neutral' | 'success' | 'danger';

interface ToolCardProps {
  summary: string;
  tone?: ToolCardTone;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
}

const toneStyles: Record<ToolCardTone, string> = {
  neutral: 'text-gray-500 dark:text-gray-400',
  success: 'text-green-700 dark:text-green-400',
  danger: 'text-red-700 dark:text-red-400',
};

export const ToolCard: React.FC<ToolCardProps> = ({
  summary,
  tone = 'neutral',
  collapsible = false,
  defaultExpanded = false,
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!collapsible) {
    return (
      <div className={toneStyles[tone]}>
        <div className="text-sm font-medium leading-6">{summary}</div>
        {children && <div className="mt-1 pl-4">{children}</div>}
      </div>
    );
  }

  return (
    <div className={toneStyles[tone]}>
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
        aria-expanded={isExpanded}
      >
        <span className="text-sm font-medium leading-6">{summary}</span>
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

      {isExpanded && children && <div className="mt-1 pl-4">{children}</div>}
    </div>
  );
};
