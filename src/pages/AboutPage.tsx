import React, { useEffect, useState } from 'react';
import { getIdentifier, getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { useNavigate } from 'react-router-dom';

interface AboutInfo {
  name: string;
  version: string;
  identifier: string;
  tauriVersion: string;
  mode: string;
}

const FALLBACK_INFO: AboutInfo = {
  name: 'work_agent',
  version: '0.1.0',
  identifier: 'photonee',
  tauriVersion: 'unknown',
  mode: import.meta.env.MODE,
};

export const AboutPage: React.FC = () => {
  const navigate = useNavigate();
  const [aboutInfo, setAboutInfo] = useState<AboutInfo>(FALLBACK_INFO);

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

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(241,245,249,0.95),rgba(255,255,255,1))] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,1))]">
      <header className="flex h-16 items-center justify-between border-b border-gray-200/80 px-4 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-xl p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label="Go back"
            title="Go back"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">About</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Application metadata and runtime details.</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Settings
        </button>
      </header>

      <main className="mx-auto max-w-4xl p-6">
        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-xl shadow-slate-200/60 dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/20">
          <div className="border-b border-gray-200 px-6 py-6 dark:border-gray-800">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">
              Product
            </div>
            <div className="mt-3 text-3xl font-semibold text-gray-900 dark:text-white">{aboutInfo.name}</div>
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Version {aboutInfo.version}
            </div>
          </div>

          <div className="grid gap-4 p-6 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Identifier</div>
              <div className="mt-2 break-all font-mono text-sm text-gray-900 dark:text-gray-100">{aboutInfo.identifier}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Tauri Runtime</div>
              <div className="mt-2 font-mono text-sm text-gray-900 dark:text-gray-100">{aboutInfo.tauriVersion}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Frontend Mode</div>
              <div className="mt-2 font-mono text-sm text-gray-900 dark:text-gray-100">{aboutInfo.mode}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Stack</div>
              <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">React 19 + Vite + Tauri 2</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
