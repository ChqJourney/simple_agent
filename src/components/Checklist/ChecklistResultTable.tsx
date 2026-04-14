import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { useChecklistStore } from '../../stores';
import {
  getChecklistRowKey,
  type ChecklistJudgement,
  type ChecklistResultRowViewModel,
  type ChecklistRowOverride,
} from '../../utils/checklistResults';

interface ChecklistResultTableProps {
  rows: ChecklistResultRowViewModel[];
  sessionId?: string | null;
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

const EMPTY_OVERRIDES: Record<string, ChecklistRowOverride> = {};

export const ChecklistResultTable: React.FC<ChecklistResultTableProps> = ({ rows, sessionId }) => {
  const { t } = useI18n();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(rows[0]?.id ?? null);
  const rowOverrides = useChecklistStore((state) => (
    sessionId
      ? state.sessions[sessionId]?.rowOverrides ?? EMPTY_OVERRIDES
      : EMPTY_OVERRIDES
  ));
  const upsertRowOverride = useChecklistStore((state) => state.upsertRowOverride);
  const clearRowOverride = useChecklistStore((state) => state.clearRowOverride);

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const isExpanded = expandedRowId === row.id;
        const rowKey = getChecklistRowKey(row);
        const hasManualOverride = Boolean(sessionId && rowOverrides[rowKey]);
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
                  {hasManualOverride && (
                    <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">
                      {t('checklist.panel.manualBadge')}
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
                    <textarea
                      aria-label={`${row.clause || row.id} ${t('checklist.panel.columns.evidence')}`}
                      disabled={!sessionId}
                      value={row.evidence}
                      onChange={(event) => {
                        if (!sessionId) {
                          return;
                        }
                        upsertRowOverride(sessionId, rowKey, { evidence: event.target.value });
                      }}
                      className="mt-2 min-h-24 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-sky-400 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-sky-500"
                      placeholder={t('checklist.panel.emptyValue')}
                    />
                  </section>

                  <section>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          {t('checklist.panel.columns.judgement')}
                        </span>
                        <select
                          aria-label={`${row.clause || row.id} ${t('checklist.panel.columns.judgement')}`}
                          disabled={!sessionId}
                          value={row.judgement}
                          onChange={(event) => {
                            if (!sessionId) {
                              return;
                            }
                            upsertRowOverride(sessionId, rowKey, {
                              judgement: event.target.value as ChecklistJudgement,
                            });
                          }}
                          className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-sky-400 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-200 dark:focus:border-sky-500"
                        >
                          <option value="pass">{judgementLabel('pass', t)}</option>
                          <option value="fail">{judgementLabel('fail', t)}</option>
                          <option value="unknown">{judgementLabel('unknown', t)}</option>
                          <option value="na">{judgementLabel('na', t)}</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          {t('checklist.panel.columns.confidence')}
                        </span>
                        <input
                          aria-label={`${row.clause || row.id} ${t('checklist.panel.columns.confidence')}`}
                          type="text"
                          disabled={!sessionId}
                          value={row.confidence || ''}
                          onChange={(event) => {
                            if (!sessionId) {
                              return;
                            }
                            upsertRowOverride(sessionId, rowKey, {
                              confidence: event.target.value,
                            });
                          }}
                          className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-sky-400 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-sky-500"
                          placeholder={t('checklist.panel.emptyValue')}
                        />
                      </label>
                    </div>
                  </section>

                  <section>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t('checklist.panel.columns.missingInfo')}
                    </p>
                    <textarea
                      aria-label={`${row.clause || row.id} ${t('checklist.panel.columns.missingInfo')}`}
                      disabled={!sessionId}
                      value={row.missingInformation.join('\n')}
                      onChange={(event) => {
                        if (!sessionId) {
                          return;
                        }
                        upsertRowOverride(sessionId, rowKey, {
                          missingInformation: event.target.value
                            .split('\n')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        });
                      }}
                      className="mt-2 min-h-24 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-sky-400 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-sky-500"
                      placeholder={t('checklist.panel.emptyValue')}
                    />
                  </section>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('checklist.panel.manualHint')}
                    </p>
                    {hasManualOverride && sessionId && (
                      <button
                        type="button"
                        onClick={() => clearRowOverride(sessionId, rowKey)}
                        className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        {t('checklist.panel.resetManual')}
                      </button>
                    )}
                  </div>

                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};
