import React, { useEffect, useId, useRef } from 'react';
import { ToolCall, ToolDecision, ToolDecisionScope } from '../../types';

interface ToolConfirmModalProps {
  toolCall: ToolCall;
  onDecision: (decision: ToolDecision, scope?: ToolDecisionScope) => void;
}

export const ToolConfirmModal: React.FC<ToolConfirmModalProps> = ({
  toolCall,
  onDecision,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialogElement = dialogRef.current;
    if (!dialogElement) {
      return undefined;
    }

    const focusableElements = dialogElement.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    firstFocusable?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDecision('reject');
        return;
      }

      if (event.key !== 'Tab' || focusableElements.length === 0) {
        return;
      }

      const activeElement = document.activeElement;
      if (event.shiftKey) {
        if (activeElement === firstFocusable || !dialogElement.contains(activeElement)) {
          event.preventDefault();
          lastFocusable?.focus();
        }
        return;
      }

      if (activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onDecision]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={() => onDecision('reject')}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-2xl rounded-[1.75rem] border border-gray-200 bg-white p-7 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="mb-5 text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm Tool Execution</h3>

        <div className="mb-6">
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            The assistant wants to execute the following tool:
          </p>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-700/70">
            <p className="font-semibold text-blue-600 dark:text-blue-400">{toolCall.name}</p>
            <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-white/80 p-3 text-xs leading-5 text-gray-900 dark:bg-gray-900/70 dark:text-gray-100">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={() => onDecision('reject')}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Reject
          </button>
          <button
            onClick={() => onDecision('approve_once')}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600"
          >
            Approve Once
          </button>
          <button
            onClick={() => onDecision('approve_always', 'session')}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
          >
            Always This Session
          </button>
          <button
            onClick={() => onDecision('approve_always', 'workspace')}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-green-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-600"
          >
            Always This Workspace
          </button>
        </div>
      </div>
    </div>
  );
};
