import React, { useState } from 'react';

type ToolCardTone = 'neutral' | 'success' | 'danger';

interface ToolCardProps {
  summary: string;
  tone?: ToolCardTone;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  badges?: string[];
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
  badges = [],
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const badgeElements = badges.length > 0 ? (
    <div className="flex flex-wrap items-center gap-2">
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          {badge}
        </span>
      ))}
    </div>
  ) : null;

  if (!collapsible) {
    return (
      <div className={toneStyles[tone]}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium leading-6">{summary}</div>
          {badgeElements}
        </div>
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
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span className="text-sm font-medium leading-6">{summary}</span>
          {badgeElements}
        </div>
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
