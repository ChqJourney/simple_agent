import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSystemSkills, listWorkspaceSkills } from "./systemSkills";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("systemSkills", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("scans system skills through the Tauri backend", async () => {
    invokeMock.mockResolvedValue({
      root_path: "/system-skills",
      root_paths: ["/portable/skills", "/system-skills"],
      skills: [{ name: "deploy-checks", description: "System skill", path: "/system-skills/deploy-checks/SKILL.md" }],
    });

    await expect(listSystemSkills()).resolves.toEqual({
      rootPath: "/portable/skills",
      rootPaths: ["/portable/skills", "/system-skills"],
      skills: [{ name: "deploy-checks", description: "System skill", path: "/system-skills/deploy-checks/SKILL.md" }],
    });
    expect(invokeMock).toHaveBeenCalledWith("scan_system_skills");
  });

  it("scans workspace skills through the Tauri backend", async () => {
    invokeMock.mockResolvedValue({
      root_path: "/workspace/.agent/skills",
      skills: [{ name: "repo-helper", description: "Workspace skill", path: "/workspace/.agent/skills/repo-helper/SKILL.md" }],
    });

    await expect(listWorkspaceSkills("/workspace")).resolves.toEqual({
      rootPath: "/workspace/.agent/skills",
      rootPaths: ["/workspace/.agent/skills"],
      skills: [{ name: "repo-helper", description: "Workspace skill", path: "/workspace/.agent/skills/repo-helper/SKILL.md" }],
    });
    expect(invokeMock).toHaveBeenCalledWith("scan_workspace_skills", { workspacePath: "/workspace" });
  });
});
