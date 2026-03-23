import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallDisplay } from "./ToolCallDisplay";

describe("ToolCallDisplay", () => {
  it("shows the inferred tool category for execution tools", () => {
    render(
      <ToolCallDisplay
        toolCall={{
          tool_call_id: "shell-1",
          name: "shell_execute",
          arguments: {
            command: "echo hello",
          },
        }}
      />
    );

    expect(screen.getByText("execution")).toBeTruthy();
  });

  it("renders a skill-specific summary for skill loader calls", () => {
    render(
      <ToolCallDisplay
        collapsible={false}
        toolCall={{
          tool_call_id: "skill-1",
          name: "skill_loader",
          arguments: {
            skill_name: "deploy-checks",
            source: "workspace",
          },
        }}
      />
    );

    expect(screen.getByText("skill")).toBeTruthy();
    expect(screen.getByText("请求加载 skill deploy-checks")).toBeTruthy();
    expect(screen.getByText("Skill request")).toBeTruthy();
  });
});
