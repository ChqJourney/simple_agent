import React from 'react';
import { useI18n } from '../../i18n';
import { ToolCall } from '../../types';
import {
  createToolCallDetailTitle,
  createToolCallSummary,
  formatToolTechnicalValue,
  getToolCategoryLabel,
  getToolImpactLabel,
} from '../../utils/toolMessages';
import { ToolCard } from './ToolCard';

interface ToolCallDisplayProps {
  toolCall: ToolCall;
  collapsible?: boolean;
  result?: {
    success: boolean;
    output: unknown;
  };
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  toolCall,
  collapsible = true,
  result,
}) => {
  const { t } = useI18n();
  const summary = createToolCallSummary(toolCall);
  const category = getToolCategoryLabel(toolCall.name);
  const impact = getToolImpactLabel(toolCall.name);
  const detailTitle = createToolCallDetailTitle(toolCall.name);

  return (
    <ToolCard summary={summary} collapsible={collapsible} badges={[category, impact]}>
      <div className="text-xs text-gray-600 dark:text-gray-400">
        <div className="rounded-xl border border-gray-200/80 bg-gray-50/80 px-3 py-2 text-[11px] leading-5 text-gray-700 dark:border-gray-700/80 dark:bg-gray-900/40 dark:text-gray-300">
          {impact === '只读' ? '该操作为只读，不会修改原文件。' : (
            impact === '高级兜底工具'
              ? '该操作属于高级兜底工具，只有在专用工具不足时才应使用。'
              : impact
          )}
        </div>

        <div className="mt-3 font-medium">{detailTitle}</div>
        <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
          {formatToolTechnicalValue(toolCall.arguments)}
        </pre>

        {result && (
          <>
            <div className="mt-3 font-medium">{t('common.output')}</div>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
              {formatToolTechnicalValue(result.output)}
            </pre>
          </>
        )}
      </div>
    </ToolCard>
  );
};
