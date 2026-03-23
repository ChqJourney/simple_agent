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
        content: "Always verify traffic before deploy.",
      },
    });

    expect(details).toContain("Skill: deploy-checks");
    expect(details).toContain("Source: workspace");
    expect(details).toContain("Frontmatter:");
    expect(details).toContain("Instructions:");
  });
});
