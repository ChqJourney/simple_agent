import React from 'react';
import { useConfigStore } from '../../stores/configStore';
import { resolveRuntimePolicy } from '../../utils/config';
import { TokenUsage } from '../../types';

interface TokenUsageWidgetProps {
  usage?: TokenUsage;
  mode?: 'request' | 'context_estimate';
}

function formatUsageTitle(usage: TokenUsage, effectiveContextLength: number | undefined, mode: 'request' | 'context_estimate'): string {
  const contextInfo = effectiveContextLength ? ` / context: ${effectiveContextLength}` : '';

  if (mode === 'context_estimate') {
    return [
      'Current context estimate',
      `prompt: ${usage.prompt_tokens}${contextInfo}`,
      'derived from latest session compaction',
    ].join('\n');
  }

  const lines = [
    'Last request usage',
    `prompt: ${usage.prompt_tokens}${contextInfo}`,
    `completion: ${usage.completion_tokens}`,
    `total: ${usage.total_tokens}`,
  ];

  if (typeof usage.reasoning_tokens === 'number') {
    lines.push(`reasoning: ${usage.reasoning_tokens}`);
  }

  return lines.join('\n');
}

export const TokenUsageWidget: React.FC<TokenUsageWidgetProps> = ({ usage, mode = 'request' }) => {
  const config = useConfigStore((state) => state.config);
  const configuredContextLength = config
    ? resolveRuntimePolicy(config.runtime, 'conversation').context_length
    : undefined;
  const contextLength = usage?.context_length ?? configuredContextLength;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const percentage = contextLength && contextLength > 0
    ? Math.min(100, Math.round((promptTokens / contextLength) * 100))
    : null;
  const circumference = 2 * Math.PI * 16;
  const strokeDashoffset = percentage === null
    ? circumference
    : circumference - (percentage / 100) * circumference;

  return (
    <div
      className="flex h-8 w-8 items-center justify-center rounded-full"
      title={usage ? formatUsageTitle(usage, contextLength, mode) : undefined}
    >
      <div className="relative h-8 w-8">
        <svg className="h-8 w-8 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-gray-200 dark:text-gray-700"
          />
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="text-blue-500 transition-all"
            style={{
              strokeDasharray: circumference,
              strokeDashoffset,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold text-gray-700 dark:text-gray-200">
          {percentage === null ? '--' : `${percentage}%`}
        </div>
      </div>
    </div>
  );
};
