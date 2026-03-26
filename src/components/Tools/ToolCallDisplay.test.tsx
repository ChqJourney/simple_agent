import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallDisplay } from "./ToolCallDisplay";

describe("ToolCallDisplay", () => {
  it("shows business summary and badges for execution tools", () => {
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

    expect(screen.getByText("高级执行")).toBeTruthy();
    expect(screen.getByText("高级兜底工具")).toBeTruthy();
    expect(screen.getByText("正在使用高级 Shell 执行作为兜底方案")).toBeTruthy();
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

    expect(screen.getByText("技能")).toBeTruthy();
    expect(screen.getByText("只读")).toBeTruthy();
    expect(screen.getByText("正在加载技能 deploy-checks")).toBeTruthy();
    expect(screen.getByText("技能请求")).toBeTruthy();
  });

  it("truncates oversized technical details before rendering", () => {
    const hugeContent = "x".repeat(5000);

    render(
      <ToolCallDisplay
        collapsible={false}
        toolCall={{
          tool_call_id: "write-1",
          name: "file_write",
          arguments: {
            path: "report.txt",
            content: hugeContent,
          },
        }}
      />
    );

    expect(screen.getByText(/truncated/i)).toBeTruthy();
    expect(screen.queryByText(hugeContent)).toBeNull();
  });
});
