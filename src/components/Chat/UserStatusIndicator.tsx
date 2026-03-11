import { UserMessageStatus } from '../../types';

interface UserStatusIndicatorProps {
  status: UserMessageStatus;
}

export const UserStatusIndicator = ({ status }: UserStatusIndicatorProps) => {
  if (status === 'sending') {
    return (
      <div className="flex items-center justify-end gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Sending...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
      <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
      <span>Sent</span>
    </div>
  );
};
