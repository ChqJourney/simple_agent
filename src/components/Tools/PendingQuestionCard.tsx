import React from 'react';
import { PendingQuestion } from '../../types';
import { ToolCard } from './ToolCard';

interface PendingQuestionCardProps {
  question: PendingQuestion;
  onSelectOption: (option: string) => void;
  onDismiss: () => void;
}

export const PendingQuestionCard: React.FC<PendingQuestionCardProps> = ({
  question,
  onSelectOption,
  onDismiss,
}) => {
  const isSubmitting = question.status === 'submitting';

  return (
    <div className="mx-5 mb-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/60 md:mx-6">
      <ToolCard
        summary={question.question}
        badges={['interaction']}
        tone="neutral"
        defaultExpanded={true}
      >
        <div className="space-y-3 text-sm text-amber-950 dark:text-amber-100">
          {question.details && (
            <p className="leading-6 text-amber-900/90 dark:text-amber-200">
              {question.details}
            </p>
          )}

          {question.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => onSelectOption(option)}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/70"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {isSubmitting && (
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              Submitting answer...
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onDismiss}
              className="text-xs font-medium uppercase tracking-[0.14em] text-amber-700 transition-colors hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-300 dark:hover:text-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      </ToolCard>
    </div>
  );
};
