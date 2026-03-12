import React from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const toneByStatus: Record<ConnectionStatus, string> = {
  connecting: 'bg-yellow-500',
  connected: 'bg-green-500',
  disconnected: 'bg-red-500',
};

const labelByStatus: Record<ConnectionStatus, string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

export const WSStatusIndicator: React.FC = () => {
  const { connectionStatus } = useWebSocket();

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1" title={labelByStatus[connectionStatus]}>
      <span
        className={`h-2.5 w-2.5 rounded-full ${toneByStatus[connectionStatus]}`}
        aria-hidden="true"
      />
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {labelByStatus[connectionStatus]}
      </span>
    </div>
  );
};
