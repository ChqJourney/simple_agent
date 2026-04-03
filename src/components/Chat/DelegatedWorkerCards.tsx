import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { formatToolTechnicalValue } from '../../utils/toolMessages';

export type DelegatedWorkerStatus = 'running' | 'completed' | 'failed';

export interface DelegatedWorkerViewModel {
  toolCallId: string;
  taskLabel: string;
  status: DelegatedWorkerStatus;
  statusLabel: string;
  elapsedLabel?: string;
  expectedOutput?: string;
  summary?: string;
  data?: unknown;
  error?: string | null;
  startedAt?: string;
  completedAt?: string;
  workerProfileName?: string;
  workerProvider?: string;
  workerModel?: string;
}

interface DelegatedWorkerCardsProps {
  workers: DelegatedWorkerViewModel[];
}

function getStatusStyles(status: DelegatedWorkerStatus): string {
  if (status === 'running') {
    return 'border-blue-200/90 bg-blue-50/90 text-blue-700 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-200';
  }

  if (status === 'failed') {
    return 'border-red-200/90 bg-red-50/90 text-red-700 dark:border-red-800/80 dark:bg-red-950/40 dark:text-red-200';
  }

  return 'border-emerald-200/90 bg-emerald-50/90 text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-950/40 dark:text-emerald-200';
}

function renderStatusIcon(status: DelegatedWorkerStatus) {
  if (status === 'running') {
    return (
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.24" strokeWidth="2.2" />
        <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }

  if (status === 'failed') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 10.5l3.1 3.1L15 6.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WorkerDetailModal({
  worker,
  onClose,
}: {
  worker: DelegatedWorkerViewModel;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const workerLabel = useMemo(() => {
    const parts = [worker.workerProvider, worker.workerModel].filter(Boolean);
    return parts.length > 0 ? parts.join('/') : undefined;
  }, [worker.workerModel, worker.workerProvider]);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.delegated.modalLabel', { task: worker.taskLabel })}
        className="w-full max-w-2xl rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
              {t('chat.delegated.title')}
            </div>
            <h3 className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {worker.taskLabel}
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {worker.statusLabel}
              {worker.elapsedLabel ? ` · ${worker.elapsedLabel}` : ''}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('chat.delegated.close')}
            title={t('chat.delegated.close')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <div className="grid gap-3 rounded-2xl border border-gray-200/80 bg-gray-50/80 p-4 dark:border-gray-700/80 dark:bg-gray-950/50 md:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.toolCall')}</div>
              <div className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-gray-200">{worker.toolCallId}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.workerModel')}</div>
              <div className="mt-1 text-xs text-gray-700 dark:text-gray-200">
                {workerLabel || t('common.unavailable')}
                {worker.workerProfileName ? ` · ${worker.workerProfileName}` : ''}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.started')}</div>
              <div className="mt-1 text-xs text-gray-700 dark:text-gray-200">{worker.startedAt || t('common.unavailable')}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.completed')}</div>
              <div className="mt-1 text-xs text-gray-700 dark:text-gray-200">{worker.completedAt || t('chat.delegated.stillRunning')}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.expectedOutput')}</div>
              <div className="mt-1 text-xs text-gray-700 dark:text-gray-200">{worker.expectedOutput || t('chat.delegated.defaultExpectedOutput')}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.status')}</div>
              <div className="mt-1 text-xs text-gray-700 dark:text-gray-200">{worker.statusLabel}</div>
            </div>
          </div>

          {worker.summary && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.summary')}</div>
              <div className="rounded-2xl border border-gray-200/80 bg-white/80 p-4 text-sm leading-6 text-gray-800 dark:border-gray-700/80 dark:bg-gray-950/50 dark:text-gray-100">
                {worker.summary}
              </div>
            </div>
          )}

          {worker.error && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-500 dark:text-red-300">{t('chat.delegated.error')}</div>
              <pre className="overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-red-200/90 bg-red-50/90 p-4 font-mono text-[12px] leading-5 text-red-700 dark:border-red-800/80 dark:bg-red-950/40 dark:text-red-200">
                {worker.error}
              </pre>
            </div>
          )}

          {typeof worker.data !== 'undefined' && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{t('chat.delegated.structuredData')}</div>
              <pre className="overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-gray-200/80 bg-gray-50/80 p-4 font-mono text-[12px] leading-5 text-gray-700 dark:border-gray-700/80 dark:bg-gray-950/50 dark:text-gray-200">
                {formatToolTechnicalValue(worker.data)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const DelegatedWorkerCards = memo<DelegatedWorkerCardsProps>(({ workers }) => {
  const { t } = useI18n();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.toolCallId === selectedWorkerId) ?? null,
    [selectedWorkerId, workers],
  );

  if (workers.length === 0) {
    return null;
  }

  return (
    <>
      <div className="space-y-2">
        {workers.map((worker) => {
          const styles = getStatusStyles(worker.status);

          return (
            <button
              key={worker.toolCallId}
              type="button"
              onClick={() => setSelectedWorkerId(worker.toolCallId)}
              className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-transform hover:-translate-y-0.5 hover:shadow-sm ${styles}`}
              aria-label={t('chat.delegated.open', { task: worker.taskLabel })}
              data-testid={`delegated-worker-card-${worker.toolCallId}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0">{renderStatusIcon(worker.status)}</span>
                <span className="truncate text-sm font-medium leading-6">{worker.taskLabel}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs font-medium">
                <span>{worker.statusLabel}</span>
                {worker.elapsedLabel && (
                  <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px]">
                    {worker.elapsedLabel}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedWorker && (
        <WorkerDetailModal
          worker={selectedWorker}
          onClose={() => setSelectedWorkerId(null)}
        />
      )}
    </>
  );
});

DelegatedWorkerCards.displayName = 'DelegatedWorkerCards';
