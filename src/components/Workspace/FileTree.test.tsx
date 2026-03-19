import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { FileTree } from "./FileTree";

const readDirMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: readDirMock,
}));

describe("FileTree", () => {
  beforeEach(() => {
    readDirMock.mockReset();
    readDirMock.mockResolvedValue([
      { name: "existing.txt", isDirectory: false },
      { name: "new.txt", isDirectory: false },
    ]);

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
});
