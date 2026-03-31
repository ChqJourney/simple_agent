import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { FileTree } from "./FileTree";

const readDirMock = vi.hoisted(() => vi.fn());
const copyFileMock = vi.hoisted(() => vi.fn());
const existsMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: readDirMock,
  copyFile: copyFileMock,
  exists: existsMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("FileTree", () => {
  beforeEach(() => {
    readDirMock.mockReset();
    copyFileMock.mockReset();
    existsMock.mockReset();
    openMock.mockReset();
    invokeMock.mockReset();
    readDirMock.mockResolvedValue([
      { name: "existing.txt", isDirectory: false },
      { name: "new.txt", isDirectory: false },
    ]);
    copyFileMock.mockResolvedValue(undefined);
    existsMock.mockResolvedValue(false);
    openMock.mockResolvedValue(null);

    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: {
        id: "workspace-1",
        name: "repo",
        path: "C:/repo",
        lastOpened: "2026-03-13T00:00:00.000Z",
        createdAt: "2026-03-13T00:00:00.000Z",
      },
      changedFiles: {
        "C:/repo/existing.txt": "updated",
        "C:/repo/new.txt": "created",
      },
    }));
  });

  it("highlights created and updated files with distinct styles", async () => {
    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText("existing.txt")).toBeTruthy();
      expect(screen.getByText("new.txt")).toBeTruthy();
    });

    expect(screen.getByText("existing.txt").closest("div")?.className).toContain("ring-amber");
    expect(screen.getByText("new.txt").closest("div")?.className).toContain("ring-emerald");
  });

  it("ignores stale child directory loads after switching workspaces", async () => {
    let resolveChildDir: ((value: Array<{ name: string; isDirectory: boolean }>) => void) | undefined;

    readDirMock
      .mockResolvedValueOnce([
        { name: "src", isDirectory: true },
      ])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveChildDir = resolve;
          })
      )
      .mockResolvedValueOnce([
        { name: "workspace-2.txt", isDirectory: false },
      ]);

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText("src")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("src"));

    act(() => {
      useWorkspaceStore.setState((state) => ({
        ...state,
        currentWorkspace: {
          id: "workspace-2",
          name: "repo-2",
          path: "C:/repo-2",
          lastOpened: "2026-03-13T00:01:00.000Z",
          createdAt: "2026-03-13T00:01:00.000Z",
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByText("workspace-2.txt")).toBeTruthy();
    });

    await act(async () => {
      resolveChildDir?.([
        { name: "old-child.txt", isDirectory: false },
      ]);
      await Promise.resolve();
    });

    expect(screen.queryByText("old-child.txt")).toBeNull();
    expect(screen.getByText("workspace-2.txt")).toBeTruthy();
  });

  it("renders different icon kinds for different file types", async () => {
    readDirMock.mockResolvedValueOnce([
      { name: "src", isDirectory: true },
      { name: "app.tsx", isDirectory: false },
      { name: "package.json", isDirectory: false },
      { name: "notes.md", isDirectory: false },
      { name: "screenshot.png", isDirectory: false },
    ]);

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText("src")).toBeTruthy();
      expect(screen.getByText("app.tsx")).toBeTruthy();
      expect(screen.getByText("package.json")).toBeTruthy();
      expect(screen.getByText("notes.md")).toBeTruthy();
      expect(screen.getByText("screenshot.png")).toBeTruthy();
    });

    expect(screen.getByText("src").previousElementSibling?.getAttribute("data-icon-kind")).toBe("folder");
    expect(screen.getByText("app.tsx").previousElementSibling?.getAttribute("data-icon-kind")).toBe("typescript");
    expect(screen.getByText("package.json").previousElementSibling?.getAttribute("data-icon-kind")).toBe("json");
    expect(screen.getByText("notes.md").previousElementSibling?.getAttribute("data-icon-kind")).toBe("markdown");
    expect(screen.getByText("screenshot.png").previousElementSibling?.getAttribute("data-icon-kind")).toBe("image");
  });

  it("imports external files into the current workspace root and refreshes the tree", async () => {
    readDirMock
      .mockResolvedValueOnce([
        { name: "existing.txt", isDirectory: false },
      ])
      .mockResolvedValueOnce([
        { name: "existing.txt", isDirectory: false },
        { name: "imported.md", isDirectory: false },
      ]);
    openMock.mockResolvedValue(["C:/Downloads/imported.md"]);

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText("existing.txt")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Import files" }));

    await waitFor(() => {
      expect(copyFileMock).toHaveBeenCalledWith("C:/Downloads/imported.md", "C:/repo/imported.md");
    });

    await waitFor(() => {
      expect(screen.getByText("imported.md")).toBeTruthy();
    });
  });

  it("shows a conflict message when an imported filename already exists", async () => {
    openMock.mockResolvedValue(["C:/Downloads/existing.txt"]);
    existsMock.mockResolvedValue(true);

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText("existing.txt")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Import files" }));

    await waitFor(() => {
      expect(screen.getByText("Skipped existing files: existing.txt")).toBeTruthy();
    });
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it("opens the current workspace folder from the file tree header", async () => {
    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText("existing.txt")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("open_workspace_folder", {
        selectedPath: "C:/repo",
      });
    });
  });
});
