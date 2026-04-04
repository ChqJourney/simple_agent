import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutPage } from "./AboutPage";
import { useUIStore } from "../stores";

const navigateMock = vi.hoisted(() => vi.fn());
const getAppUpdateConfigStateMock = vi.hoisted(() => vi.fn());
const checkForAppUpdateMock = vi.hoisted(() => vi.fn());
const installAppUpdateMock = vi.hoisted(() => vi.fn());
const getNameMock = vi.hoisted(() => vi.fn());
const getVersionMock = vi.hoisted(() => vi.fn());
const getIdentifierMock = vi.hoisted(() => vi.fn());
const getTauriVersionMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@tauri-apps/api/app", () => ({
  getName: getNameMock,
  getVersion: getVersionMock,
  getIdentifier: getIdentifierMock,
  getTauriVersion: getTauriVersionMock,
}));

vi.mock("../utils/updater", () => ({
  getAppUpdateConfigState: getAppUpdateConfigStateMock,
  checkForAppUpdate: checkForAppUpdateMock,
  installAppUpdate: installAppUpdateMock,
}));

describe("AboutPage", () => {
  beforeEach(() => {
    localStorage.clear();
    navigateMock.mockReset();
    getAppUpdateConfigStateMock.mockReset();
    checkForAppUpdateMock.mockReset();
    installAppUpdateMock.mockReset();
    getNameMock.mockReset();
    getVersionMock.mockReset();
    getIdentifierMock.mockReset();
    getTauriVersionMock.mockReset();

    useUIStore.setState((state) => ({
      ...state,
      locale: "en-US",
    }));

    getNameMock.mockResolvedValue("work agent");
    getVersionMock.mockResolvedValue("0.1.0");
    getIdentifierMock.mockResolvedValue("photonee");
    getTauriVersionMock.mockResolvedValue("2.0.0");
    getAppUpdateConfigStateMock.mockResolvedValue({
      configured: true,
      reason: null,
    });
    installAppUpdateMock.mockResolvedValue({
      installed: true,
      version: "0.2.0",
    });
  });

  it("shows a visible success state when the installed version is already current", async () => {
    checkForAppUpdateMock.mockResolvedValue({
      configured: true,
      currentVersion: "0.1.0",
      updateAvailable: false,
      version: null,
      body: null,
      date: null,
    });

    render(<AboutPage />);

    await screen.findByText("This build can check for new releases when an updater feed is configured.");
    fireEvent.click(await screen.findByRole("button", { name: "Check for Updates" }));

    await waitFor(() => {
      expect(screen.getAllByText("You are already on the latest version (0.1.0).").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Up to Date")).toBeTruthy();
    expect(screen.getByText(/Last checked:/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("You are already on the latest version (0.1.0).");
  });

  it("shows the available version and enables install when an update is found", async () => {
    checkForAppUpdateMock.mockResolvedValue({
      configured: true,
      currentVersion: "0.1.0",
      updateAvailable: true,
      version: "0.2.0",
      body: "",
      date: null,
    });

    render(<AboutPage />);

    await screen.findByText("This build can check for new releases when an updater feed is configured.");
    fireEvent.click(await screen.findByRole("button", { name: "Check for Updates" }));

    await waitFor(() => {
      expect(screen.getAllByText("Available version: 0.2.0").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByText("Update Ready")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Install Update" }) as HTMLButtonElement).disabled).toBe(false);
    });

    expect(screen.getByRole("status").textContent).toContain("Available version: 0.2.0");
  });
});
