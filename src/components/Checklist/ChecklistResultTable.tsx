import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import type { ChecklistJudgement, ChecklistResultRowViewModel } from '../../utils/checklistResults';

interface ChecklistResultTableProps {
  rows: ChecklistResultRowViewModel[];
}

const JUDGEMENT_TONE: Record<ChecklistJudgement, string> = {
  pass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200',
  fail: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200',
  unknown: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200',
  na: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

function judgementLabel(judgement: ChecklistJudgement, t: ReturnType<typeof useI18n>['t']): string {
  return t(`checklist.panel.judgement.${judgement}`);
}

export const ChecklistResultTable: React.FC<ChecklistResultTableProps> = ({ rows }) => {
  const { t } = useI18n();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(rows[0]?.id ?? null);

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const isExpanded = expandedRowId === row.id;
        return (
          <article
            key={row.id}
            className="overflow-hidden rounded-[1.35rem] border border-gray-200 bg-white/90 shadow-sm transition-colors dark:border-gray-800 dark:bg-gray-950/70"
          >
            <button
              type="button"
              onClick={() => setExpandedRowId(isExpanded ? null : row.id)}
              className="flex w-full items-start gap-3 px-4 py-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {row.clause && (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
                      {row.clause}
                    </span>
                  )}
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${JUDGEMENT_TONE[row.judgement]}`}>
                    {judgementLabel(row.judgement, t)}
                  </span>
                  {row.locatorLabel && (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                      {row.locatorLabel}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm font-medium leading-6 text-gray-900 dark:text-white">
                  {row.requirement}
                </p>
              </div>
              <svg
                className={`mt-1 h-5 w-5 shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 4l6 6-6 6" />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-200 bg-gray-50/70 px-4 py-4 text-sm dark:border-gray-800 dark:bg-gray-900/60">
                <div className="space-y-4">
                  <section>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t('checklist.panel.columns.evidence')}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-200">
                      {row.evidence || t('checklist.panel.emptyValue')}
                    </p>
                  </section>

                  {row.confidence && (
                    <section>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t('checklist.panel.columns.confidence')}
                      </p>
                      <p className="mt-1 text-gray-700 dark:text-gray-200">{row.confidence}</p>
                    </section>
                  )}

                  <section>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t('checklist.panel.columns.missingInfo')}
                    </p>
                    {row.missingInformation.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-700 dark:text-gray-200">
                        {row.missingInformation.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-gray-700 dark:text-gray-200">
                        {t('checklist.panel.emptyValue')}
                      </p>
                    )}
                  </section>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};
