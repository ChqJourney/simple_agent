import { render, screen, waitFor } from "@testing-library/react";
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
});
