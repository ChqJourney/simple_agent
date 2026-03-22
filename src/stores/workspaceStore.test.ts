import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

describe("workspaceStore persistence", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear?.();
    useWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: [],
      currentWorkspace: null,
      changedFiles: {},
    }));
  });

  it("does not persist transient changed file markers", () => {
    const workspace = {
      id: "workspace-1",
      name: "repo",
      path: "C:/repo",
      lastOpened: "2026-03-22T09:00:00.000Z",
      createdAt: "2026-03-22T08:00:00.000Z",
    };

    useWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: [workspace],
      currentWorkspace: workspace,
      changedFiles: {
        "C:/repo/new-file.ts": "created",
      },
    }));

    const persistedValue = localStorage.getItem("workspace-storage");
    expect(persistedValue).not.toBeNull();

    const parsed = JSON.parse(persistedValue || "{}");
    expect(parsed.state.workspaces).toEqual([workspace]);
    expect(parsed.state.currentWorkspace).toEqual(workspace);
    expect(parsed.state.changedFiles).toBeUndefined();
  });
});
