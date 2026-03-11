import { AssistantStatus } from '../../types';

interface AssistantStatusIndicatorProps {
  status: AssistantStatus;
  toolName?: string;
}

export const AssistantStatusIndicator = ({ status, toolName }: AssistantStatusIndicatorProps) => {
  if (status === 'idle') {
    return null;
  }

  if (status === 'completed') {
    return (
      <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500 dark:text-gray-400">
        <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        <span>Completed</span>
      </div>
    );
  }

  const statusConfig: Record<Exclude<AssistantStatus, 'idle' | 'completed'>, string> = {
    waiting: 'Waiting for response...',
    thinking: 'Thinking...',
    streaming: 'Streaming response...',
    tool_calling: 'Calling tool...',
  };

  const isToolCalling = status === 'tool_calling';

  return (
    <div
      className={`flex items-center gap-1.5 mt-2 text-xs text-gray-500 dark:text-gray-400 ${
        isToolCalling ? '' : 'animate-pulse-subtle'
      }`}
    >
      {isToolCalling ? (
        <svg className="w-3 h-3 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ) : (
        <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      )}
      <span>{statusConfig[status]}</span>
      {isToolCalling && toolName && (
        <span className="text-blue-500 dark:text-blue-400">[{toolName}]</span>
      )}
    </div>
  );
};
