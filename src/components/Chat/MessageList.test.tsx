import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageList } from "./MessageList";
import type { Message } from "../../types";

describe("MessageList", () => {
  it("keeps the formal assistant content visible while collapsing round details by default", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Check the workspace",
        status: "completed",
      },
      {
        id: "reasoning-1",
        role: "reasoning",
        content: "Need to inspect the repository first.",
        status: "completed",
      },
      {
        id: "assistant-tool-call",
        role: "assistant",
        content: null,
        tool_calls: [
          {
            tool_call_id: "tool-1",
            name: "shell_execute",
            arguments: { command: "ls" },
          },
        ],
        status: "completed",
      },
      {
        id: "tool-result-1",
        role: "tool",
        content: "shell_execute 执行成功",
        tool_call_id: "tool-1",
        name: "shell_execute",
        toolMessage: {
          kind: "result",
          toolName: "shell_execute",
          success: true,
          details: "exit_code: 0\nstdout:\nREADME.md",
        },
        status: "completed",
      },
      {
        id: "assistant-final",
        role: "assistant",
        content: "Workspace looks healthy.",
        status: "completed",
      },
    ];

    render(
      <MessageList
        messages={messages}
        isStreaming={false}
        assistantStatus="completed"
      />
    );

    expect(screen.getByText("Workspace looks healthy.")).toBeTruthy();
    expect(screen.queryByText("Need to inspect the repository first.")).toBeNull();
    expect(screen.queryByText(/exit_code: 0/)).toBeNull();
    const messageListText = screen.getByText("Workspace looks healthy.").closest(".space-y-5")?.textContent || "";
    expect(messageListText.indexOf("Assistant")).toBeLessThan(messageListText.indexOf("thinking 1"));
    expect(messageListText.indexOf("thinking 1")).toBeLessThan(messageListText.indexOf("Workspace looks healthy."));

    fireEvent.click(screen.getByRole("button", { name: /thinking 1/i }));

    expect(screen.getByText("Need to inspect the repository first.")).toBeTruthy();
    expect(screen.getByText(/exit_code: 0/)).toBeTruthy();
  });
});
