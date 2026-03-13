import React from 'react';
import { ToolCall } from '../../types';
import { getToolCategoryLabel } from '../../utils/toolMessages';
import { ToolCard } from './ToolCard';

interface ToolCallDisplayProps {
  toolCall: ToolCall;
  result?: {
    success: boolean;
    output: unknown;
  };
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ toolCall, result }) => {
  const summary = `请求执行 ${toolCall.name}`;
  const category = getToolCategoryLabel(toolCall.name);

  return (
    <ToolCard summary={summary} collapsible={true} badges={[category]}>
      <div className="text-xs text-gray-600 dark:text-gray-400">
        <div className="font-medium">Arguments</div>
        <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
          {JSON.stringify(toolCall.arguments, null, 2)}
        </pre>

        {result && (
          <>
            <div className="mt-3 font-medium">Output</div>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
              {typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output, null, 2)}
            </pre>
          </>
        )}
      </div>
    </ToolCard>
  );
};
