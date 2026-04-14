import React from 'react';
import { useI18n } from '../../i18n';
import type { ChecklistResultViewModel } from '../../utils/checklistResults';

interface ChecklistResultNoticeProps {
  result: ChecklistResultViewModel;
  onOpenChecklist: () => void;
  onDismiss?: () => void;
}

export const ChecklistResultNotice: React.FC<ChecklistResultNoticeProps> = ({
  result,
  onOpenChecklist,
  onDismiss,
}) => {
  const { t } = useI18n();

  return (
    <div className="mx-4 mb-3 rounded-[1.6rem] border border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-sky-100/80 px-4 py-4 shadow-[0_18px_38px_-26px_rgba(14,116,144,0.55)] dark:border-sky-900/80 dark:from-slate-900 dark:via-slate-900 dark:to-sky-950/70">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-600/20">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 10h11m0 0-4-4m4 4-4 4" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">
            {t('checklist.panel.notice.title')}
          </p>
          <p className="mt-1 text-sm text-sky-900/80 dark:text-sky-200/80">
            {t('checklist.panel.notice.body', { count: result.summary.total })}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenChecklist}
          className="shrink-0 rounded-2xl bg-sky-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-950 dark:bg-sky-100 dark:text-sky-950 dark:hover:bg-white"
        >
          {t('checklist.panel.notice.action')}
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('common.dismiss')}
            className="shrink-0 rounded-2xl p-2 text-sky-800/70 transition-colors hover:bg-sky-100 hover:text-sky-950 dark:text-sky-200/70 dark:hover:bg-sky-900/60 dark:hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
