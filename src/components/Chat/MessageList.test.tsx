import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { Message } from "../../types";

describe("MessageList", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(),
      },
    });
  });

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

  it("copies visible user and assistant message bodies from the message list", async () => {
    const writeTextMock = vi.mocked(navigator.clipboard.writeText);
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Copy this user message",
        status: "completed",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Copy this assistant reply",
        status: "completed",
      },
    ];

    render(<MessageList messages={messages} />);

    const copyButtons = screen.getAllByRole("button", { name: "Copy message" });
    fireEvent.click(copyButtons[0]);
    fireEvent.click(copyButtons[1]);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenNthCalledWith(1, "Copy this user message");
      expect(writeTextMock).toHaveBeenNthCalledWith(2, "Copy this assistant reply");
    });
  });

  it("renders assistant soft line breaks and list blocks as markdown", () => {
    const messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "概览\n下一行\n总结：\n- 第一项\n- 第二项",
        status: "completed",
      },
    ];

    const { container } = render(<MessageList messages={messages} />);

    expect(container.querySelector("br")).toBeTruthy();
    expect(container.querySelector("ul")).toBeTruthy();
    expect(screen.getByText("第一项")).toBeTruthy();
    expect(screen.getByText("第二项")).toBeTruthy();
  });

  it("renders markdown tables in assistant messages", () => {
    const messages: Message[] = [
      {
        id: "assistant-table",
        role: "assistant",
        content: "## 表格\n| 技能名称 | 说明 |\n| --- | --- |\n| docx | 文档处理 |",
        status: "completed",
      },
    ];

    const { container } = render(<MessageList messages={messages} />);

    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector("table")?.className).toContain("border-collapse");
    expect(container.querySelector("thead")).toBeTruthy();
    expect(container.querySelector("tbody")).toBeTruthy();
    expect(container.querySelector("th")?.className).toContain("border-r");
    expect(container.querySelector("td")?.className).toContain("px-4");
    expect(screen.getByText("技能名称")).toBeTruthy();
    expect(screen.getByText("docx")).toBeTruthy();
  });

  it("keeps the current scroll position when the user is reading older messages", async () => {
    const { rerender } = render(
      <MessageList
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "First reply",
            status: "completed",
          },
        ]}
      />
    );

    const scroller = screen.getByTestId("message-list-scroll") as HTMLDivElement;
    let scrollHeight = 300;

    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });

    scroller.scrollTop = 140;
    fireEvent.scroll(scroller);

    scrollHeight = 520;
    rerender(
      <MessageList
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "First reply",
            status: "completed",
          },
        ]}
        currentStreamingContent="streaming update"
        isStreaming={true}
      />
    );

    await waitFor(() => {
      expect(scroller.scrollTop).toBe(140);
    });
  });

  it("auto-scrolls when the user is already near the bottom", async () => {
    const { rerender } = render(
      <MessageList
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "First reply",
            status: "completed",
          },
        ]}
      />
    );

    const scroller = screen.getByTestId("message-list-scroll") as HTMLDivElement;
    let scrollHeight = 300;

    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });

    scroller.scrollTop = 175;
    fireEvent.scroll(scroller);

    scrollHeight = 520;
    rerender(
      <MessageList
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "First reply",
            status: "completed",
          },
        ]}
        currentStreamingContent="streaming update"
        isStreaming={true}
      />
    );

    await waitFor(() => {
      expect(scroller.scrollTop).toBe(520);
    });
  });
});
