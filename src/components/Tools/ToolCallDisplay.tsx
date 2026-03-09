import React from 'react';
import { ToolCall } from '../../types';

interface ToolCallDisplayProps {
  toolCall: ToolCall;
  result?: {
    success: boolean;
    output: unknown;
  };
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ toolCall, result }) => {
  return (
    <div className="tool-call-display my-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-blue-600">
          {toolCall.name}
        </span>
        {result && (
          <span className={`text-xs px-2 py-0.5 rounded ${
            result.success 
              ? 'bg-green-100 text-green-700' 
              : 'bg-red-100 text-red-700'
          }`}>
            {result.success ? 'Success' : 'Failed'}
          </span>
        )}
      </div>
      
      <div className="text-xs text-gray-600">
        <span className="font-medium">Arguments:</span>
        <pre className="mt-1 p-2 bg-gray-100 rounded overflow-auto">
          {JSON.stringify(toolCall.arguments, null, 2)}
        </pre>
      </div>
      
      {result && (
        <div className="text-xs text-gray-600 mt-2">
          <span className="font-medium">Output:</span>
          <pre className="mt-1 p-2 bg-gray-100 rounded overflow-auto max-h-40">
            {typeof result.output === 'string' 
              ? result.output 
              : JSON.stringify(result.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};