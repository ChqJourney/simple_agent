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

export async function getAppUpdateConfigState(): Promise<AppUpdateConfigState> {
  return invoke<AppUpdateConfigState>('get_app_update_config_state');
}

export async function checkForAppUpdate(): Promise<AppUpdateCheckResult> {
  return invoke<AppUpdateCheckResult>('check_for_app_update');
}

export async function installAppUpdate(): Promise<AppUpdateInstallResult> {
  return invoke<AppUpdateInstallResult>('install_app_update');
}
