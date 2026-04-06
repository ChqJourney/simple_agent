import { invoke } from '@tauri-apps/api/core';

export interface AppUpdateConfigState {
  configured: boolean;
  reason: string | null;
  endpoints: string[];
  logPath: string | null;
  lastError: string | null;
}

export interface AppUpdateCheckResult {
  configured: boolean;
  currentVersion: string;
  updateAvailable: boolean;
  version: string | null;
  body: string | null;
  date: string | null;
}

export interface AppUpdateInstallResult {
  installed: boolean;
  version: string | null;
}

interface AppUpdateConfigStatePayload {
  configured: boolean;
  reason: string | null;
  endpoints?: string[];
  log_path?: string | null;
  logPath?: string | null;
  last_error?: string | null;
  lastError?: string | null;
}

interface AppUpdateCheckResultPayload {
  configured: boolean;
  current_version?: string;
  currentVersion?: string;
  update_available?: boolean;
  updateAvailable?: boolean;
  version?: string | null;
  body?: string | null;
  date?: string | null;
}

function normalizeUpdateConfigState(payload: AppUpdateConfigStatePayload): AppUpdateConfigState {
  return {
    configured: payload.configured,
    reason: payload.reason ?? null,
    endpoints: Array.isArray(payload.endpoints) ? payload.endpoints : [],
    logPath: payload.logPath ?? payload.log_path ?? null,
    lastError: payload.lastError ?? payload.last_error ?? null,
  };
}

function normalizeUpdateCheckResult(payload: AppUpdateCheckResultPayload): AppUpdateCheckResult {
  return {
    configured: payload.configured,
    currentVersion: payload.currentVersion ?? payload.current_version ?? '',
    updateAvailable: payload.updateAvailable ?? payload.update_available ?? false,
    version: payload.version ?? null,
    body: payload.body ?? null,
    date: payload.date ?? null,
  };
}

export async function getAppUpdateConfigState(): Promise<AppUpdateConfigState> {
  const payload = await invoke<AppUpdateConfigStatePayload>('get_app_update_config_state');
  return normalizeUpdateConfigState(payload);
}

export async function checkForAppUpdate(): Promise<AppUpdateCheckResult> {
  const payload = await invoke<AppUpdateCheckResultPayload>('check_for_app_update');
  return normalizeUpdateCheckResult(payload);
}

export async function installAppUpdate(): Promise<AppUpdateInstallResult> {
  return invoke<AppUpdateInstallResult>('install_app_update');
}
