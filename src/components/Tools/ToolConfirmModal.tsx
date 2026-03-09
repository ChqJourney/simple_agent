import React from 'react';
import { ToolCall } from '../../types';

interface ToolConfirmModalProps {
  toolCall: ToolCall;
  onConfirm: (approved: boolean) => void;
}

export const ToolConfirmModal: React.FC<ToolConfirmModalProps> = ({
  toolCall,
  onConfirm,
}) => {
  return (
    <div className="tool-confirm-modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">Confirm Tool Execution</h3>
        
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            The assistant wants to execute the following tool:
          </p>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="font-medium text-blue-600">{toolCall.name}</p>
            <pre className="mt-2 text-xs overflow-auto">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
        </div>
        
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => onConfirm(false)}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Reject
          </button>
          <button
            onClick={() => onConfirm(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
};