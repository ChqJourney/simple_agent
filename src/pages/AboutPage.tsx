import React, { useEffect, useRef, useState } from 'react';
import { getIdentifier, getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { checkForAppUpdate, getAppUpdateConfigState, installAppUpdate } from '../utils/updater';

interface AboutInfo {
  name: string;
  version: string;
  identifier: string;
  tauriVersion: string;
  mode: string;
}

type UpdateStatus = 'idle' | 'checking' | 'installing' | 'up-to-date' | 'available' | 'error' | 'unavailable';
type UpdateNoticeTone = 'info' | 'success' | 'error';

const FALLBACK_INFO: AboutInfo = {
  name: 'work agent',
  version: '0.1.0',
  identifier: 'photonee',
  tauriVersion: '',
  mode: import.meta.env.MODE,
};

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallbackMessage;
}

export const AboutPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [aboutInfo, setAboutInfo] = useState<AboutInfo>(FALLBACK_INFO);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<{ tone: UpdateNoticeTone; message: string } | null>(null);
  const [updaterEndpoints, setUpdaterEndpoints] = useState<string[]>([]);
  const [updaterLogPath, setUpdaterLogPath] = useState<string | null>(null);
  const [updaterLastError, setUpdaterLastError] = useState<string | null>(null);
  const hasActiveUpdateInteraction = useRef(false);

  const updateStatusLabel = (() => {
    switch (updateStatus) {
      case 'checking':
        return t('about.update.status.checking');
      case 'installing':
        return t('about.update.status.installing');
      case 'available':
        return t('about.update.status.available');
      case 'up-to-date':
        return t('about.update.status.upToDate');
      case 'error':
        return t('about.update.status.error');
      case 'unavailable':
        return t('about.update.status.unavailable');
      default:
        return t('about.update.status.ready');
    }
  })();

  const updateStatusClasses = (() => {
    switch (updateStatus) {
      case 'checking':
      case 'installing':
        return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300';
      case 'available':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300';
      case 'up-to-date':
        return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
      case 'error':
        return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300';
      case 'unavailable':
        return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300';
      default:
        return 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';
    }
  })();

  const updateNoticeClasses = updateNotice?.tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
    : updateNotice?.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
      : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300';

  useEffect(() => {
    let cancelled = false;

    const loadAboutInfo = async () => {
      try {
        const [name, version, identifier, tauriVersion] = await Promise.all([
          getName(),
          getVersion(),
          getIdentifier(),
          getTauriVersion(),
        ]);

        if (!cancelled) {
          setAboutInfo({
            name,
            version,
            identifier,
            tauriVersion,
            mode: import.meta.env.MODE,
          });
        }
      } catch {
        if (!cancelled) {
          setAboutInfo(FALLBACK_INFO);
        }
      }
    };

    void loadAboutInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadUpdateConfig = async () => {
      try {
        const configState = await getAppUpdateConfigState();
        if (cancelled) {
          return;
        }

        if (hasActiveUpdateInteraction.current) {
          return;
        }

        setUpdaterEndpoints(configState.endpoints || []);
        setUpdaterLogPath(configState.logPath || null);
        setUpdaterLastError(configState.lastError || null);

        if (!configState.configured) {
          setUpdateStatus('unavailable');
          setUpdateMessage(configState.reason || t('about.update.unavailableHint'));
          setUpdateNotice({
            tone: 'info',
            message: configState.reason || t('about.update.unavailableHint'),
          });
          return;
        }

        setUpdateStatus('idle');
        setUpdateMessage(t('about.update.readyHint'));
        setUpdateNotice(null);
      } catch (error) {
        if (!cancelled) {
          if (hasActiveUpdateInteraction.current) {
            return;
          }
          setUpdateStatus('error');
          const message = getErrorMessage(error, t('about.update.checkFailed'));
          setUpdateMessage(message);
          setUpdateNotice({ tone: 'error', message });
        }
      }
    };

    void loadUpdateConfig();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleCheckForUpdates = async () => {
    hasActiveUpdateInteraction.current = true;
    setUpdateStatus('checking');
    setUpdateMessage(t('about.update.checkingHint'));
    setAvailableVersion(null);
    setUpdateNotice({
      tone: 'info',
      message: t('about.update.checkingHint'),
    });

    try {
      const result = await checkForAppUpdate();
      setLastCheckedAt(new Date().toLocaleString());
      setUpdaterLastError(null);
      if (!result.configured) {
        setUpdateStatus('unavailable');
        setUpdateMessage(t('about.update.unavailableHint'));
        setUpdateNotice({
          tone: 'info',
          message: t('about.update.unavailableHint'),
        });
        return;
      }

      if (!result.updateAvailable) {
        setUpdateStatus('up-to-date');
        const message = t('about.update.upToDate', { version: result.currentVersion });
        setUpdateMessage(message);
        setUpdateNotice({
          tone: 'success',
          message,
        });
        return;
      }

      setUpdateStatus('available');
      setAvailableVersion(result.version);
      const message =
        result.body?.trim()
          ? result.body
          : t('about.update.availableHint', { version: result.version || t('about.unknown') });
      setUpdateMessage(message);
      setUpdateNotice({
        tone: 'success',
        message: t('about.update.availableVersion', { version: result.version || t('about.unknown') }),
      });
    } catch (error) {
      setUpdateStatus('error');
      const message = getErrorMessage(error, t('about.update.checkFailed'));
      setUpdateMessage(message);
      setUpdateNotice({ tone: 'error', message });
      setUpdaterLastError(message);
    }
  };

  const handleInstallUpdate = async () => {
    hasActiveUpdateInteraction.current = true;
    setUpdateStatus('installing');
    setUpdateMessage(t('about.update.installingHint'));
    setUpdateNotice({
      tone: 'info',
      message: t('about.update.installingHint'),
    });

    try {
      const result = await installAppUpdate();
      setUpdateStatus('idle');
      const message = t('about.update.installedHint', {
        version: result.version || availableVersion || t('about.unknown'),
      });
      setUpdateMessage(message);
      setUpdateNotice({ tone: 'success', message });
      setAvailableVersion(null);
    } catch (error) {
      setUpdateStatus('error');
      const message = getErrorMessage(error, t('about.update.installFailed'));
      setUpdateMessage(message);
      setUpdateNotice({ tone: 'error', message });
      setUpdaterLastError(message);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(241,245,249,0.95),rgba(255,255,255,1))] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,1))]">
      <header className="flex h-16 items-center justify-between border-b border-gray-200/80 px-4 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-xl p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label={t('about.back')}
            title={t('about.back')}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{t('about.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('about.subtitle')}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {t('about.settings')}
        </button>
      </header>

      <main className="mx-auto max-w-4xl p-6">
        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-xl shadow-slate-200/60 dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/20">
          <div className="border-b border-gray-200 px-6 py-6 dark:border-gray-800">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">
              {t('about.product')}
            </div>
            <div className="mt-3 text-3xl font-semibold text-gray-900 dark:text-white">{aboutInfo.name}</div>
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t('about.version', { version: aboutInfo.version })}
            </div>
          </div>

          <div className="grid gap-4 p-6 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{t('about.identifier')}</div>
              <div className="mt-2 break-all font-mono text-sm text-gray-900 dark:text-gray-100">{aboutInfo.identifier}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{t('about.tauriRuntime')}</div>
              <div className="mt-2 font-mono text-sm text-gray-900 dark:text-gray-100">
                {aboutInfo.tauriVersion || t('about.unknown')}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{t('about.frontendMode')}</div>
              <div className="mt-2 font-mono text-sm text-gray-900 dark:text-gray-100">{aboutInfo.mode}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{t('about.stack')}</div>
              <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">React 19 + Vite + Tauri 2</div>
            </div>
          </div>

          <div className="border-t border-gray-200 px-6 py-6 dark:border-gray-800">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                  {t('about.update.title')}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${updateStatusClasses}`}>
                    {updateStatusLabel}
                  </span>
                  {lastCheckedAt ? (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {t('about.update.lastChecked', { value: lastCheckedAt })}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {updateMessage || t('about.update.readyHint')}
                </div>
                {availableVersion ? (
                  <div className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                    {t('about.update.availableVersion', { version: availableVersion })}
                  </div>
                ) : null}
                {updateNotice ? (
                  <div
                    className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-medium ${updateNoticeClasses}`}
                    role="status"
                    aria-live="polite"
                  >
                    {updateNotice.message}
                  </div>
                ) : null}
                <div className="mt-4 grid gap-3 rounded-2xl border border-gray-200/80 bg-slate-50/80 p-4 text-sm dark:border-gray-800 dark:bg-slate-950/40">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                      {t('about.update.feed')}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-gray-200">
                      {updaterEndpoints.length > 0 ? updaterEndpoints.join('\n') : t('about.update.none')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                      {t('about.update.logFile')}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-gray-200">
                      {updaterLogPath || t('about.update.none')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                      {t('about.update.lastError')}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-gray-200">
                      {updaterLastError || t('about.update.none')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleCheckForUpdates()}
                  disabled={updateStatus === 'checking' || updateStatus === 'installing' || updateStatus === 'unavailable'}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {updateStatus === 'checking' ? t('about.update.checking') : t('about.update.check')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleInstallUpdate()}
                  disabled={updateStatus !== 'available' && updateStatus !== 'installing'}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {updateStatus === 'installing' ? t('about.update.installing') : t('about.update.install')}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
