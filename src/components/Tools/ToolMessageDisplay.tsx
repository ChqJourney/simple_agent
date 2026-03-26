import React from 'react';
import { Message } from '../../types';
import {
  createToolDecisionDetailLines,
  getToolCategoryLabel,
  getToolImpactLabel,
} from '../../utils/toolMessages';
import { ToolCard } from './ToolCard';

interface ToolMessageDisplayProps {
  message: Message;
  collapsible?: boolean;
}

export const ToolMessageDisplay: React.FC<ToolMessageDisplayProps> = ({
  message,
  collapsible = true,
}) => {
  const toolName = message.name || message.toolMessage?.toolName || 'tool';
  const summary = message.content || toolName;
  const badges = [getToolCategoryLabel(toolName), getToolImpactLabel(toolName)];

  if (message.toolMessage?.kind === 'decision') {
    const tone = message.toolMessage.decision === 'reject' ? 'danger' : 'success';
    const lines = createToolDecisionDetailLines(
      toolName,
      message.toolMessage.decision,
      message.toolMessage.scope,
      message.toolMessage.reason,
    );

    return (
      <div className="w-full">
        <ToolCard summary={summary} tone={tone} collapsible={collapsible} badges={badges}>
          <div className="space-y-1 text-xs leading-5 text-gray-700 dark:text-gray-300">
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </ToolCard>
      </div>
    );
  }

  if (message.toolMessage?.kind === 'result') {
    return (
      <div className="w-full">
        <ToolCard summary={summary} collapsible={collapsible} badges={badges}>
          <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
            {message.toolMessage.details}
          </pre>
        </ToolCard>
      </div>
    );
  }

  return (
    <div className="w-full">
      <ToolCard summary={summary} collapsible={Boolean(message.content)} badges={badges}>
        {message.content && (
          <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
            {message.content}
          </pre>
        )}
      </ToolCard>
    </div>
  );
};
