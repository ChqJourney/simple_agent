import { describe, expect, it } from "vitest";
import { renderToolResultDetails } from "./toolMessages";

describe("toolMessages", () => {
  it("formats structured execution outputs for display", () => {
    const details = renderToolResultDetails(true, {
      exit_code: 0,
      stdout: "hello",
      stderr: "",
    });

    expect(details).toContain("exit_code: 0");
    expect(details).toContain("stdout:");
    expect(details).toContain("hello");
  });

  it("formats pending questions in a readable way", () => {
    const details = renderToolResultDetails(true, {
      event: "pending_question",
      question: "Continue deployment?",
      details: "Production traffic is low right now.",
      options: ["continue", "wait"],
    });

    expect(details).toContain("Question: Continue deployment?");
    expect(details).toContain("Production traffic is low right now.");
    expect(details).toContain("continue, wait");
  });

  it("formats skill loader outputs in a readable way", () => {
    const details = renderToolResultDetails(true, {
      event: "skill_loader",
      skill: {
        name: "deploy-checks",
        description: "Deployment checklist",
        source: "workspace",
        source_path: "/tmp/workspace/.agent/skills/deploy-checks/SKILL.md",
        frontmatter: "name: deploy-checks\ndescription: Deployment checklist",
        content: [
          "Always verify traffic before deploy.",
          "Check error budget before deploy.",
          "Review rollback steps.",
          "Validate metrics dashboards.",
          "Confirm on-call ownership.",
          "Post deployment note.",
          "Archive screenshots.",
        ].join("\n"),
      },
    });

    expect(details).toContain("Skill: deploy-checks");
    expect(details).toContain("Source: workspace");
    expect(details).toContain("Frontmatter:");
    expect(details).toContain("Instructions preview:");
    expect(details).toContain("Post deployment note.");
    expect(details).not.toContain("Archive screenshots.");
    expect(details).toContain("...");
  });

  it("shows stderr in failed execution outputs", () => {
    const details = renderToolResultDetails(false, {
      exit_code: 1,
      stdout: "",
      stderr: "ModuleNotFoundError: No module named 'pdfplumber'",
    }, "Python exited with code 1");

    expect(details).toContain("Error: Python exited with code 1");
    expect(details).toContain("exit_code: 1");
    expect(details).toContain("stderr:");
    expect(details).toContain("ModuleNotFoundError: No module named 'pdfplumber'");
  });

  it("shows simple error message when output has no execution details", () => {
    const details = renderToolResultDetails(false, "something broke", "Tool crashed");

    expect(details).toBe("Error: Tool crashed");
  });
});
