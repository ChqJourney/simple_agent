import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

function ensureStorage(name: "localStorage" | "sessionStorage") {
  const existing = globalThis[name];
  if (existing && typeof existing.getItem === "function" && typeof existing.setItem === "function") {
    return;
  }

  let store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage,
  });
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear?.();
});
