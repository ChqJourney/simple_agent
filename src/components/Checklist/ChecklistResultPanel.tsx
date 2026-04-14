import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { useChecklistStore } from '../../stores';
import {
  applyChecklistRowOverrides,
  type ChecklistRowOverride,
  type ChecklistJudgement,
  type ChecklistResultSummaryViewModel,
  type ChecklistResultViewModel,
} from '../../utils/checklistResults';
import { ChecklistResultTable } from './ChecklistResultTable';

interface ChecklistResultPanelProps {
  result: ChecklistResultViewModel;
  sessionId?: string | null;
}

const SUMMARY_TONES: Record<Exclude<ChecklistJudgement, 'na'> | 'missing', string> = {
  pass: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  fail: 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
  unknown: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  missing: 'bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
};

function summaryItems(summary: ChecklistResultSummaryViewModel, t: ReturnType<typeof useI18n>['t']) {
  return [
    { key: 'pass', label: t('checklist.panel.summary.pass'), value: summary.pass, tone: SUMMARY_TONES.pass },
    { key: 'fail', label: t('checklist.panel.summary.fail'), value: summary.fail, tone: SUMMARY_TONES.fail },
    { key: 'unknown', label: t('checklist.panel.summary.unknown'), value: summary.unknown, tone: SUMMARY_TONES.unknown },
    { key: 'missing', label: t('checklist.panel.summary.missing'), value: summary.missing, tone: SUMMARY_TONES.missing },
  ] as const;
}

const EMPTY_OVERRIDES: Record<string, ChecklistRowOverride> = {};

export const ChecklistResultPanel: React.FC<ChecklistResultPanelProps> = ({ result, sessionId }) => {
  const { t } = useI18n();
  const rowOverrides = useChecklistStore((state) => (
    sessionId
      ? state.sessions[sessionId]?.rowOverrides ?? EMPTY_OVERRIDES
      : EMPTY_OVERRIDES
  ));
  const mergedResult = useMemo(
    () => applyChecklistRowOverrides(result, rowOverrides),
    [result, rowOverrides]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-sky-200/70 bg-gradient-to-b from-white via-sky-50/40 to-white shadow-[0_24px_60px_-40px_rgba(14,116,144,0.7)] dark:border-sky-900/70 dark:from-slate-950 dark:via-slate-950 dark:to-sky-950/40">
      <div className="border-b border-sky-100/90 px-4 py-4 dark:border-sky-900/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('checklist.panel.title')}
            </p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {mergedResult.checklistTitle || t('checklist.panel.subtitle')}
            </p>
          </div>
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950/70 dark:text-sky-200">
            {mergedResult.summary.total} {t('checklist.panel.summary.total')}
          </span>
        </div>

        {mergedResult.sourceLabel && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t('checklist.panel.sourceLabel', { source: mergedResult.sourceLabel })}
          </p>
        )}

        {!mergedResult.isEvaluated && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">{t('checklist.panel.fallback.title')}</p>
            <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
              {t('checklist.panel.fallback.body')}
            </p>
          </div>
        )}
        <p className="mt-3 text-xs text-sky-900/70 dark:text-sky-200/70">
          {t('checklist.panel.editingHint')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-4">
        {summaryItems(mergedResult.summary, t).map((item) => (
          <div key={item.key} className={`rounded-2xl px-3 py-3 ${item.tone}`}>
            <p className="text-xs font-semibold uppercase tracking-wide">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <ChecklistResultTable rows={mergedResult.rows} sessionId={sessionId} />
      </div>
    </div>
  );
};
