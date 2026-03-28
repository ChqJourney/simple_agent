import React, { useEffect, useState } from 'react';
import { PendingQuestion } from '../../types';
import { ToolCard } from './ToolCard';

interface PendingQuestionCardProps {
  question: PendingQuestion;
  onSubmitAnswer: (answer: string) => void;
  onDismiss: () => void;
}

export const PendingQuestionCard: React.FC<PendingQuestionCardProps> = ({
  question,
  onSubmitAnswer,
  onDismiss,
}) => {
  const isSubmitting = question.status === 'submitting';
  const [draftAnswer, setDraftAnswer] = useState('');
  const trimmedAnswer = draftAnswer.trim();
  const canSubmitTextAnswer = !isSubmitting && trimmedAnswer.length > 0;

  useEffect(() => {
    setDraftAnswer('');
  }, [question.tool_call_id]);

  const handleSubmitAnswer = () => {
    if (!canSubmitTextAnswer) {
      return;
    }
    onSubmitAnswer(trimmedAnswer);
  };

  const helperText = question.options.length > 0
    ? 'Choose an option or type a custom answer.'
    : 'Type your answer below to let the assistant continue.';

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
                  onClick={() => onSubmitAnswer(option)}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/70"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              {helperText}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={draftAnswer}
                disabled={isSubmitting}
                onChange={(event) => setDraftAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSubmitAnswer();
                  }
                }}
                placeholder="Type your answer"
                className="min-w-0 flex-1 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-amber-950 outline-none transition-colors placeholder:text-amber-700/60 focus:border-amber-500 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-50 dark:placeholder:text-amber-200/60 dark:focus:border-amber-500"
              />
              <button
                type="button"
                disabled={!canSubmitTextAnswer}
                onClick={handleSubmitAnswer}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300 dark:bg-amber-500 dark:hover:bg-amber-400 dark:disabled:bg-amber-800"
              >
                Submit
              </button>
            </div>
          </div>

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
