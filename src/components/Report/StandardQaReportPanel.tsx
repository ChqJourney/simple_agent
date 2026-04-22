import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../../i18n';
import type { Message } from '../../types';
import {
  fetchStandardQaReportPdfProgress,
  fetchStandardQaReportSummary,
  startStandardQaReportPdfGeneration,
  type StandardQaReportProgress,
  type StandardQaReportSummary,
} from '../../utils/standardQaReport';

interface StandardQaReportPanelProps {
  session?: {
    session_id: string;
    workspace_path: string;
    title?: string;
  };
  messages: Message[];
}

type SummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: StandardQaReportSummary; generatedAt: string; cached: boolean }
  | { status: 'error'; error: string };

type ReportState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'success'; path: string; generatedAt: string; cached: boolean }
  | { status: 'error'; error: string };

interface ReportProgress {
  percent: number;
  message: string;
  generatedTokens?: number;
  generatedCharacters?: number;
}

const REPORT_PROGRESS_POLL_MS = import.meta.env.MODE === 'test' ? 0 : 900;

function hasReportableConversation(messages: Message[]): boolean {
  const hasUser = messages.some((message) => message.role === 'user' && message.content?.trim());
  const hasAssistant = messages.some((message) => (
    message.role === 'assistant'
    && message.status === 'completed'
    && message.content?.trim()
  ));
  return hasUser && hasAssistant;
}

function getConversationDigestInput(messages: Message[]): string {
  return JSON.stringify(
    messages
      .filter((message) => ['user', 'assistant', 'tool'].includes(message.role))
      .map((message) => ({
        role: message.role,
        content: message.content,
        status: message.status,
        timestamp: message.timestamp,
        name: message.name,
      }))
  );
}

function sanitizeFilename(value: string): string {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-').replace(/\s+/g, '-');
  return (cleaned || 'standard-qa-report').slice(0, 80);
}

function ensurePdfExtension(path: string): string {
  return path.toLowerCase().endsWith('.pdf') ? path : `${path}.pdf`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function summaryList(items: string[], emptyLabel: string) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="rounded-2xl bg-white/75 px-3 py-2 text-sm text-gray-700 shadow-sm ring-1 ring-gray-100 dark:bg-slate-900/70 dark:text-gray-200 dark:ring-slate-800">
          {item}
        </li>
      ))}
    </ul>
  );
}

function progressMessage(progress: StandardQaReportProgress, t: ReturnType<typeof useI18n>['t']): string {
  if (progress.cached) {
    return t('report.standardQa.progressCached');
  }
  if (progress.phase === 'loading') {
    return t('report.standardQa.progressPreparing');
  }
  if (progress.phase === 'llm_stream') {
    return progress.generated_tokens > 0
      ? t('report.standardQa.progressTokens', { count: progress.generated_tokens })
      : t('report.standardQa.progressMainModel');
  }
  if (progress.phase === 'parsing') {
    return t('report.standardQa.progressParsing');
  }
  if (progress.phase === 'rendering') {
    return t('report.standardQa.progressRendering');
  }
  if (progress.phase === 'encoding') {
    return t('report.standardQa.progressEncoding');
  }
  if (progress.phase === 'completed') {
    return t('report.standardQa.progressDone');
  }
  return progress.detail || t('report.standardQa.progressStillWorking');
}

export const StandardQaReportPanel: React.FC<StandardQaReportPanelProps> = ({
  session,
  messages,
}) => {
  const { t, formatDateTime, locale } = useI18n();
  const [summaryState, setSummaryState] = useState<SummaryState>({ status: 'idle' });
  const [reportState, setReportState] = useState<ReportState>({ status: 'idle' });
  const [reportProgress, setReportProgress] = useState<ReportProgress | null>(null);
  const hasConversation = hasReportableConversation(messages);
  const isStreaming = messages.some((message) => message.status === 'streaming');
  const digestInput = useMemo(() => getConversationDigestInput(messages), [messages]);
  const conversationTurns = messages.filter((message) => message.role === 'user').length;
  const assistantTurns = messages.filter((message) => message.role === 'assistant' && message.content?.trim()).length;
  const defaultFilename = `${sanitizeFilename(session?.title || t('report.standardQa.defaultFilename'))}.pdf`;

  useEffect(() => {
    if (!session?.workspace_path || !session.session_id || !hasConversation) {
      setSummaryState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setSummaryState({ status: 'loading' });
    void fetchStandardQaReportSummary(session.workspace_path, session.session_id)
      .then((result) => {
        if (!cancelled) {
          setSummaryState({
            status: 'ready',
            summary: result.summary,
            generatedAt: result.generated_at,
            cached: result.cached,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSummaryState({
            status: 'error',
            error: error instanceof Error ? error.message : t('report.standardQa.summaryError'),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.workspace_path, session?.session_id, hasConversation, digestInput, locale]);

  const handleGenerateReport = async () => {
    if (!session?.workspace_path || !session.session_id || !hasConversation || isStreaming || reportState.status === 'generating') {
      return;
    }

    setReportState({ status: 'idle' });
    setReportProgress(null);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const selected = await save({
        title: t('report.standardQa.saveDialogTitle'),
        defaultPath: defaultFilename,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!selected) {
        return;
      }

      setReportState({ status: 'generating' });
      setReportProgress({
        percent: 12,
        message: t('report.standardQa.progressPreparing'),
      });
      let progress = await startStandardQaReportPdfGeneration(session.workspace_path, session.session_id);
      setReportProgress({
        percent: progress.progress_percent,
        message: progressMessage(progress, t),
        generatedTokens: progress.generated_tokens,
        generatedCharacters: progress.generated_characters,
      });
      while (progress.status === 'queued' || progress.status === 'running') {
        await delay(REPORT_PROGRESS_POLL_MS);
        progress = await fetchStandardQaReportPdfProgress(progress.report_id);
        setReportProgress({
          percent: progress.progress_percent,
          message: progressMessage(progress, t),
          generatedTokens: progress.generated_tokens,
          generatedCharacters: progress.generated_characters,
        });
      }
      if (progress.status === 'failed') {
        throw new Error(progress.error || t('report.standardQa.generateError'));
      }
      if (!progress.pdf_base64 || !progress.generated_at) {
        throw new Error(t('report.standardQa.generateError'));
      }
      const outputPath = ensurePdfExtension(selected);
      await invoke('write_report_pdf', {
        selectedPath: outputPath,
        pdfBase64: progress.pdf_base64,
      });
      setReportProgress({
        percent: 100,
        message: t('report.standardQa.progressDone'),
        generatedTokens: progress.generated_tokens,
        generatedCharacters: progress.generated_characters,
      });
      setReportState({
        status: 'success',
        path: outputPath,
        generatedAt: progress.generated_at,
        cached: progress.cached,
      });
    } catch (error) {
      setReportProgress(null);
      setReportState({
        status: 'error',
        error: error instanceof Error ? error.message : t('report.standardQa.generateError'),
      });
    }
  };

  const buttonDisabled = !hasConversation || isStreaming || reportState.status === 'generating';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-cyan-200/70 bg-gradient-to-b from-white via-cyan-50/50 to-slate-50 shadow-[0_24px_60px_-40px_rgba(8,145,178,0.75)] dark:border-cyan-900/70 dark:from-slate-950 dark:via-slate-950 dark:to-cyan-950/30">
      <div className="border-b border-cyan-100/90 px-4 py-4 dark:border-cyan-900/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-950 dark:text-white">
              {t('report.standardQa.title')}
            </p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {t('report.standardQa.subtitle')}
            </p>
          </div>
          <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-800 dark:bg-cyan-950/70 dark:text-cyan-200">
            {t('report.standardQa.templateBadge')}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/75 px-3 py-3 shadow-sm ring-1 ring-cyan-100 dark:bg-slate-900/70 dark:ring-cyan-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
              {t('report.standardQa.questions')}
            </p>
            <p className="mt-2 text-2xl font-semibold text-gray-950 dark:text-white">{conversationTurns}</p>
          </div>
          <div className="rounded-2xl bg-white/75 px-3 py-3 shadow-sm ring-1 ring-cyan-100 dark:bg-slate-900/70 dark:ring-cyan-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
              {t('report.standardQa.answers')}
            </p>
            <p className="mt-2 text-2xl font-semibold text-gray-950 dark:text-white">{assistantTurns}</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!hasConversation ? (
          <div className="rounded-3xl border border-dashed border-gray-300 bg-white/60 px-4 py-6 text-sm text-gray-600 dark:border-gray-700 dark:bg-slate-900/40 dark:text-gray-300">
            {t('report.standardQa.empty')}
          </div>
        ) : summaryState.status === 'loading' ? (
          <div className="rounded-3xl bg-white/70 px-4 py-5 text-sm text-gray-600 shadow-sm ring-1 ring-gray-100 dark:bg-slate-900/60 dark:text-gray-300 dark:ring-slate-800">
            {t('report.standardQa.summaryLoading')}
          </div>
        ) : summaryState.status === 'error' ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">{t('report.standardQa.summaryUnavailable')}</p>
            <p className="mt-1">{summaryState.error}</p>
          </div>
        ) : summaryState.status === 'ready' ? (
          <div className="space-y-4">
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-200">
                {t('report.standardQa.summary')}
              </p>
              <h3 className="mt-2 text-base font-semibold text-gray-950 dark:text-white">
                {summaryState.summary.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-gray-700 dark:text-gray-200">
                {summaryState.summary.overview}
              </p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('report.standardQa.summaryGenerated', {
                  time: formatDateTime(summaryState.generatedAt),
                  source: summaryState.cached ? t('report.standardQa.cached') : t('report.standardQa.generated'),
                })}
              </p>
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-200">
                {t('report.standardQa.keyPoints')}
              </p>
              {summaryList(summaryState.summary.key_points, t('report.standardQa.noKeyPoints'))}
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-200">
                {t('report.standardQa.evidence')}
              </p>
              {summaryList(summaryState.summary.evidence_highlights, t('report.standardQa.noEvidence'))}
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-200">
                {t('report.standardQa.openQuestions')}
              </p>
              {summaryList(summaryState.summary.open_questions, t('report.standardQa.noOpenQuestions'))}
            </section>
          </div>
        ) : null}
      </div>

      <div className="border-t border-cyan-100/90 px-4 py-4 dark:border-cyan-900/60">
        {isStreaming && (
          <p className="mb-3 rounded-2xl bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
            {t('report.standardQa.waitForCompletion')}
          </p>
        )}
        {reportState.status === 'success' && (
          <p className="mb-3 rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
            {t('report.standardQa.saved', { path: reportState.path })}
          </p>
        )}
        {reportState.status === 'error' && (
          <p className="mb-3 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
            {reportState.error}
          </p>
        )}
        {reportState.status === 'generating' && reportProgress && (
          <div className="mb-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-3 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-100">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{reportProgress.message}</span>
              <span>{reportProgress.percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-cyan-100 dark:bg-cyan-950">
              <div
                className="h-full rounded-full bg-cyan-700 transition-all duration-700 dark:bg-cyan-300"
                style={{ width: `${reportProgress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-cyan-800/80 dark:text-cyan-100/75">
              {reportProgress.generatedTokens
                ? t('report.standardQa.progressTokenDetail', {
                    tokens: reportProgress.generatedTokens,
                    chars: reportProgress.generatedCharacters || 0,
                  })
                : t('report.standardQa.progressHint')}
            </p>
          </div>
        )}
        <button
          type="button"
          disabled={buttonDisabled}
          onClick={handleGenerateReport}
          className={[
            'w-full rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
            buttonDisabled
              ? 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
              : 'bg-cyan-700 text-white shadow-lg shadow-cyan-900/20 hover:bg-cyan-800 dark:bg-cyan-500 dark:text-cyan-950 dark:hover:bg-cyan-400',
          ].join(' ')}
        >
          {reportState.status === 'generating'
            ? t('report.standardQa.generating')
            : t('report.standardQa.generate')}
        </button>
      </div>
    </div>
  );
};
