import { AssistantStatus } from '../../types';

interface AssistantStatusIndicatorProps {
  status: AssistantStatus;
  toolName?: string;
}

export const AssistantStatusIndicator = ({ status, toolName }: AssistantStatusIndicatorProps) => {
  if (status === 'idle' || status === 'completed') {
    if (status === 'completed') {
      return (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500 dark:text-gray-400">
          <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span>已完成</span>
        </div>
      );
    }
    return null;
  }

  const statusConfig: Record<Exclude<AssistantStatus, 'idle' | 'completed'>, { text: string; animate: boolean }> = {
    waiting: { text: '等待中...', animate: true },
    thinking: { text: 'thinking...', animate: true },
    tool_calling: { text: 'tool calling...', animate: false },
  };

  const config = statusConfig[status];

  return (
    <div className={`flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ${config.animate ? 'animate-pulse-subtle' : ''}`}>
      <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      <span>{config.text}</span>
      {toolName && <span className="text-blue-500 dark:text-blue-400">[{toolName}]</span>}
    </div>
  );
};