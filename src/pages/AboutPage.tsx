import React, { useEffect, useState } from 'react';
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

const FALLBACK_INFO: AboutInfo = {
  name: 'work agent',
  version: '0.1.0',
  identifier: 'photonee',
  tauriVersion: '',
  mode: import.meta.env.MODE,
};

export const AboutPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [aboutInfo, setAboutInfo] = useState<AboutInfo>(FALLBACK_INFO);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

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

        if (!configState.configured) {
          setUpdateStatus('unavailable');
          setUpdateMessage(configState.reason || t('about.update.unavailableHint'));
          return;
        }

        setUpdateStatus('idle');
        setUpdateMessage(t('about.update.readyHint'));
      } catch (error) {
        if (!cancelled) {
          setUpdateStatus('error');
          setUpdateMessage(error instanceof Error ? error.message : t('about.update.checkFailed'));
        }
      }
    };

    void loadUpdateConfig();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateMessage(null);
    setAvailableVersion(null);

    try {
      const result = await checkForAppUpdate();
      if (!result.configured) {
        setUpdateStatus('unavailable');
        setUpdateMessage(t('about.update.unavailableHint'));
        return;
      }

      if (!result.updateAvailable) {
        setUpdateStatus('up-to-date');
        setUpdateMessage(t('about.update.upToDate', { version: result.currentVersion }));
        return;
      }

      setUpdateStatus('available');
      setAvailableVersion(result.version);
      setUpdateMessage(
        result.body?.trim()
          ? result.body
          : t('about.update.availableHint', { version: result.version || t('about.unknown') })
      );
    } catch (error) {
      setUpdateStatus('error');
      setUpdateMessage(error instanceof Error ? error.message : t('about.update.checkFailed'));
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateStatus('installing');
    setUpdateMessage(t('about.update.installingHint'));

    try {
      const result = await installAppUpdate();
      setUpdateStatus('idle');
      setUpdateMessage(
        t('about.update.installedHint', { version: result.version || availableVersion || t('about.unknown') })
      );
      setAvailableVersion(null);
    } catch (error) {
      setUpdateStatus('error');
      setUpdateMessage(error instanceof Error ? error.message : t('about.update.installFailed'));
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
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {updateMessage || t('about.update.readyHint')}
                </div>
                {availableVersion ? (
                  <div className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                    {t('about.update.availableVersion', { version: availableVersion })}
                  </div>
                ) : null}
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
