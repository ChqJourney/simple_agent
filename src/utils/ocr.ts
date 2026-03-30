import { invoke } from '@tauri-apps/api/core';

export interface OcrSidecarInstallInfo {
  appDir: string;
  installDir: string;
  installed: boolean;
  version?: string | null;
}

interface OcrSidecarInstallPayload {
  app_dir: string;
  install_dir: string;
  installed: boolean;
  version?: string | null;
}

function normalizeInstallPayload(payload: OcrSidecarInstallPayload): OcrSidecarInstallInfo {
  return {
    appDir: payload.app_dir,
    installDir: payload.install_dir,
    installed: payload.installed,
    version: payload.version ?? null,
  };
}

export async function inspectOcrSidecarInstallation(): Promise<OcrSidecarInstallInfo> {
  const payload = await invoke<OcrSidecarInstallPayload>('inspect_ocr_sidecar_installation');
  return normalizeInstallPayload(payload);
}

export async function installOcrSidecar(sourceDir: string): Promise<OcrSidecarInstallInfo> {
  const payload = await invoke<OcrSidecarInstallPayload>('install_ocr_sidecar', { sourceDir });
  return normalizeInstallPayload(payload);
}
