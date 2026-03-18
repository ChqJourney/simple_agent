import React from 'react';
import { ToolCall, ToolDecision, ToolDecisionScope } from '../../types';

interface ToolConfirmModalProps {
  toolCall: ToolCall;
  onDecision: (decision: ToolDecision, scope?: ToolDecisionScope) => void;
}

export const ToolConfirmModal: React.FC<ToolConfirmModalProps> = ({
  toolCall,
  onDecision,
}) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Confirm Tool Execution</h3>

        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            The assistant wants to execute the following tool:
          </p>
          <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <p className="font-medium text-blue-600 dark:text-blue-400">{toolCall.name}</p>
            <pre className="mt-2 text-xs overflow-auto text-gray-900 dark:text-gray-100">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => onDecision('reject')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => onDecision('approve_once')}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            Approve Once
          </button>
          <button
            onClick={() => onDecision('approve_always', 'session')}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
          >
            Always This Session
          </button>
          <button
            onClick={() => onDecision('approve_always', 'workspace')}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
          >
            Always This Workspace
          </button>
        </div>
      </div>
    </div>
  );
};
