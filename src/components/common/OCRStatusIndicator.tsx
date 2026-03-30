import React from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useConfigStore } from '../../stores/configStore';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';

const toneByStatus = {
  available: 'bg-emerald-500',
  unavailable: 'bg-slate-400',
  starting: 'bg-amber-500',
} as const;

const labelByStatus = {
  available: 'OCR: available',
  unavailable: 'OCR: unavailable',
  starting: 'OCR: starting',
} as const;

export const OCRStatusIndicator: React.FC = () => {
  const config = useConfigStore((state) => state.config);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const activeSession = useChatStore((state) => (
    currentSessionId ? state.sessions[currentSessionId] : undefined
  ));
  const { ocrStatus } = useWebSocket();

  if (!config?.ocr?.enabled) {
    return null;
  }

  const isOcrRunning = activeSession?.assistantStatus === 'tool_calling'
    && activeSession.currentToolName === 'ocr_extract';
  const status = isOcrRunning ? 'starting' : ocrStatus.status;
  const title = status === 'unavailable' && !ocrStatus.installed
    ? 'OCR sidecar is enabled but not installed.'
    : labelByStatus[status];

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1" title={title}>
      <span
        className={`h-2.5 w-2.5 rounded-full ${toneByStatus[status]}`}
        aria-hidden="true"
      />
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {labelByStatus[status]}
      </span>
    </div>
  );
};
