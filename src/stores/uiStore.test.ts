import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./uiStore";

describe("uiStore persistence", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear?.();
    useUIStore.setState((state) => ({
      ...state,
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      rightPanelTab: "filetree",
      theme: "system",
      locale: "en-US",
      baseFontSize: 16,
      isPageLoading: false,
      leftPanelWidth: 256,
      rightPanelWidth: 288,
    }));
  });

  it("persists workspace panel widths", () => {
    useUIStore.getState().setLeftPanelWidth(312);
    useUIStore.getState().setRightPanelWidth(344);

    const persistedValue = localStorage.getItem("ui-storage");
    expect(persistedValue).not.toBeNull();

    const parsed = JSON.parse(persistedValue || "{}");
    expect(parsed.state.leftPanelWidth).toBe(312);
    expect(parsed.state.rightPanelWidth).toBe(344);
  });

  it("persists locale selection", () => {
    useUIStore.getState().setLocale("zh-CN");

    const persistedValue = localStorage.getItem("ui-storage");
    expect(persistedValue).not.toBeNull();

    const parsed = JSON.parse(persistedValue || "{}");
    expect(parsed.state.locale).toBe("zh-CN");
  });
});
