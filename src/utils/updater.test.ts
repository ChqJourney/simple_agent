import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { checkForAppUpdate, getAppUpdateConfigState } from './updater';

describe('updater payload normalization', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('normalizes snake_case updater config payloads from Tauri', async () => {
    invokeMock.mockResolvedValue({
      configured: true,
      reason: null,
      endpoints: ['https://updates.example.com/latest.json'],
      log_path: 'C:\\logs\\updater.log',
      last_error: 'socket reset',
    });

    await expect(getAppUpdateConfigState()).resolves.toEqual({
      configured: true,
      reason: null,
      endpoints: ['https://updates.example.com/latest.json'],
      logPath: 'C:\\logs\\updater.log',
      lastError: 'socket reset',
    });
  });

  it('normalizes snake_case updater check payloads from Tauri', async () => {
    invokeMock.mockResolvedValue({
      configured: true,
      current_version: '1.0.6',
      update_available: true,
      version: '1.0.7',
      body: null,
      date: null,
    });

    await expect(checkForAppUpdate()).resolves.toEqual({
      configured: true,
      currentVersion: '1.0.6',
      updateAvailable: true,
      version: '1.0.7',
      body: null,
      date: null,
    });
  });
});
