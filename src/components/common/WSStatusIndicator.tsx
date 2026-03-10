import React from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const WSStatusIndicator: React.FC = () => {
  const { isConnected } = useWebSocket();
  
  const status: ConnectionStatus = isConnected ? 'connected' : 'disconnected';

  const statusConfig: Record<ConnectionStatus, { color: string; label: string; icon: string }> = {
    connecting: { color: 'text-yellow-500', label: 'Connecting...', icon: '⏳' },
    connected: { color: 'text-green-500', label: 'Connected', icon: '🟢' },
    disconnected: { color: 'text-red-500', label: 'Disconnected', icon: '🔴' },
  };

  const config = statusConfig[status];

  const handleClick = () => {
    if (status === 'disconnected') {
      window.location.reload();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
        status === 'disconnected' ? 'hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer' : 'cursor-default'
      }`}
      title={config.label}
    >
      <span>{config.icon}</span>
      {status === 'disconnected' && (
        <span className="text-xs text-red-500">Reconnect</span>
      )}
    </button>
  );
};