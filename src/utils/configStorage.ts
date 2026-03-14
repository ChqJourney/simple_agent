import { createJSONStorage, StateStorage } from "zustand/middleware";

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const tauriWindow = window as Window & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  };

  return typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function";
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage ?? null;
}

async function isTauriFsAvailable(): Promise<boolean> {
  if (!hasTauriRuntime()) {
    return false;
  }

  try {
    await import("@tauri-apps/plugin-fs");
    await import("@tauri-apps/api/path");
    return true;
  } catch {
    return false;
  }
}

async function getConfigFilePath(name: string): Promise<string | null> {
  if (!(await isTauriFsAvailable())) {
    return null;
  }

  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const baseDir = await appDataDir();
  return join(baseDir, `${name}.json`);
}

export function createConfigStateStorage(): StateStorage<Promise<void> | void> {
  return {
    getItem: async (name) => {
      const filePath = await getConfigFilePath(name);
      if (!filePath) {
        return getLocalStorage()?.getItem(name) ?? null;
      }

      const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
      if (!(await exists(filePath))) {
        return null;
      }

      return readTextFile(filePath);
    },
    setItem: async (name, value) => {
      const filePath = await getConfigFilePath(name);
      if (!filePath) {
        getLocalStorage()?.setItem(name, value);
        return;
      }

      const { appDataDir } = await import("@tauri-apps/api/path");
      const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
      await mkdir(await appDataDir(), { recursive: true });
      await writeTextFile(filePath, value);
    },
    removeItem: async (name) => {
      const filePath = await getConfigFilePath(name);
      if (!filePath) {
        getLocalStorage()?.removeItem(name);
        return;
      }

      const { exists, remove } = await import("@tauri-apps/plugin-fs");
      if (await exists(filePath)) {
        await remove(filePath);
      }
    },
  };
}

export const configPersistStorage = createJSONStorage(() => createConfigStateStorage());
