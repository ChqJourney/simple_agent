import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { Message } from "../../types";

const readFileMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: readFileMock,
}));

describe("MessageList", () => {
  beforeEach(() => {
    readFileMock.mockReset();
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

    fireEvent.click(screen.getByRole("button", { name: /thinking 1 .*tool calls 1 .*tool results 1/i }));

    expect(screen.getByText("Need to inspect the repository first.")).toBeTruthy();
    expect(screen.getByText(/exit_code: 0/)).toBeTruthy();
  });

  it("renders friendly tool decision details when expanded", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Please inspect the files",
        status: "completed",
      },
      {
        id: "assistant-tool-call",
        role: "assistant",
        content: null,
        tool_calls: [
          {
            tool_call_id: "tool-1",
            name: "search_documents",
            arguments: { query: "ISO 17025" },
          },
        ],
        status: "completed",
      },
      {
        id: "tool-decision-1",
        role: "tool",
        content: "已允许 search_documents 本次执行",
        tool_call_id: "tool-1",
        name: "search_documents",
        toolMessage: {
          kind: "decision",
          toolName: "search_documents",
          decision: "approve_once",
          scope: "session",
        },
        status: "completed",
      },
      {
        id: "assistant-final",
        role: "assistant",
        content: "已开始分析。",
        status: "completed",
      },
    ];

    render(<MessageList messages={messages} isStreaming={false} assistantStatus="completed" />);

    fireEvent.click(screen.getByRole("button", { name: /tool calls 1/i }));

    expect(screen.getByText("该操作已获本次批准。")).toBeTruthy();
    expect(screen.getByText("这类操作通常不会修改原文件。")).toBeTruthy();
  });

  it("keeps in-progress reasoning after earlier detail messages within the same turn", async () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Analyze the standard",
        status: "completed",
      },
      {
        id: "assistant-tool-call",
        role: "assistant",
        content: null,
        tool_calls: [
          {
            tool_call_id: "tool-1",
            name: "search_documents",
            arguments: { query: "4.1" },
          },
        ],
        status: "completed",
      },
      {
        id: "tool-result-1",
        role: "tool",
        content: "文档搜索完成",
        tool_call_id: "tool-1",
        name: "search_documents",
        toolMessage: {
          kind: "result",
          toolName: "search_documents",
          success: true,
          details: "搜索完成\n命中数: 2\n涉及文件: 1",
        },
        status: "completed",
      },
    ];

    render(
      <MessageList
        messages={messages}
        isStreaming={true}
        currentReasoningContent="现在开始第二轮判断"
        assistantStatus="thinking"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("现在开始第二轮判断")).toBeTruthy();
      expect(screen.getByText("文档搜索完成")).toBeTruthy();
    });

    const detailContent = screen.getByText("现在开始第二轮判断").closest(".space-y-3")?.textContent || "";
    expect(detailContent.indexOf("文档搜索完成")).toBeLessThan(detailContent.indexOf("现在开始第二轮判断"));
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

  it("keeps block code styling on the pre container without inline code chrome", () => {
    const messages: Message[] = [
      {
        id: "assistant-code-block",
        role: "assistant",
        content: "```\\nconst answer = 42;\\n```",
        status: "completed",
      },
    ];

    const { container } = render(<MessageList messages={messages} />);
    const pre = container.querySelector("pre");
    const code = container.querySelector("pre > code");

    expect(pre).toBeTruthy();
    expect(pre?.className).toContain("border");
    expect(pre?.className).toContain("bg-slate-50");
    expect(code).toBeTruthy();
    expect(code?.className).toContain("font-mono");
    expect(code?.className).not.toContain("bg-slate-100");
    expect(code?.className).not.toContain("border-slate-200");
    expect(code?.className).not.toContain("rounded-md");
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

  it("shows image thumbnails in message history and opens a modal preview on double click", async () => {
    const messages: Message[] = [
      {
        id: "user-image",
        role: "user",
        content: "看看这张图",
        attachments: [
          {
            kind: "image",
            path: "/tmp/diagram.png",
            name: "diagram.png",
            mime_type: "image/png",
            data_url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
          },
        ],
        status: "completed",
      },
    ];

    render(<MessageList messages={messages} />);

    expect(screen.getByAltText("Attachment preview: diagram.png")).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Open image preview for diagram.png" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Image preview: diagram.png" })).toBeTruthy();
      expect(screen.getByAltText("Expanded preview: diagram.png")).toBeTruthy();
    });
  });

  it("loads a thumbnail from the local attachment path when history only has the file path", async () => {
    readFileMock.mockResolvedValue(Uint8Array.from([137, 80, 78, 71]));

    const messages: Message[] = [
      {
        id: "user-image-path-only",
        role: "user",
        content: "本地图片",
        attachments: [
          {
            kind: "image",
            path: "/tmp/from-disk.png",
            name: "from-disk.png",
            mime_type: "image/png",
          },
        ],
        status: "completed",
      },
    ];

    render(<MessageList messages={messages} />);

    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalledWith("/tmp/from-disk.png");
      expect(screen.getByAltText("Attachment preview: from-disk.png")).toBeTruthy();
    });
  });

  it("shows elapsed seconds for a completed historical assistant turn", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Measure this run",
        timestamp: "2026-03-28T10:00:00.000Z",
        status: "completed",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Done",
        timestamp: "2026-03-28T10:00:13.000Z",
        status: "completed",
      },
    ];

    render(<MessageList messages={messages} />);

    expect(screen.getByText("13s")).toBeTruthy();
  });

  it("updates elapsed seconds for the active run from run events", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-03-28T10:00:12.000Z"));

      const messages: Message[] = [
        {
          id: "user-1",
          role: "user",
          content: "Still running",
          timestamp: "2026-03-28T10:00:00.000Z",
          status: "completed",
        },
      ];

      render(
        <MessageList
          messages={messages}
          isStreaming={true}
          assistantStatus="thinking"
          runEvents={[
            {
              event_type: "run_started",
              session_id: "session-1",
              run_id: "run-1",
              payload: {},
              timestamp: "2026-03-28T10:00:00.000Z",
            },
          ]}
        />
      );

      expect(screen.getByText("12s")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(screen.getByText("15s")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a failed state with a resend button for failed assistant turns", () => {
    const onRetryMessage = vi.fn();
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Try again",
        status: "completed",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Error: backend failed",
        status: "error",
      },
    ];

    render(<MessageList messages={messages} onRetryMessage={onRetryMessage} />);

    expect(screen.getByText("Failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resend message" }));
    expect(onRetryMessage).toHaveBeenCalledWith(messages[0]);
  });

  it("shows retry notices and stall reasons inside the assistant turn details", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Please continue",
        status: "completed",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Partial answer that eventually completed.",
        status: "completed",
      },
    ];

    render(
      <MessageList
        messages={messages}
        runEvents={[
          {
            event_type: "run_started",
            session_id: "session-1",
            run_id: "run-1",
            payload: {},
            timestamp: "2026-03-28T10:00:00.000Z",
          },
          {
            event_type: "retry_scheduled",
            session_id: "session-1",
            run_id: "run-1",
            payload: {
              attempt: 2,
              details: "LLM stream stalled before completion.",
            },
            timestamp: "2026-03-28T10:00:01.000Z",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /runtime notices 1/i }));

    expect(screen.getByText("Retry scheduled")).toBeTruthy();
    expect(screen.getByText("attempt 2 - LLM stream stalled before completion.")).toBeTruthy();
  });

  it("keeps runtime notices at their chronological position within turn details", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Investigate",
        status: "completed",
        timestamp: "2026-03-28T10:00:00.000Z",
      },
      {
        id: "assistant-tool-call",
        role: "assistant",
        content: null,
        tool_calls: [
          {
            tool_call_id: "tool-1",
            name: "shell_execute",
            arguments: { command: "npm test" },
          },
        ],
        status: "completed",
        timestamp: "2026-03-28T10:00:01.000Z",
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
          details: "exit_code: 0\nstdout:\nPASS",
        },
        status: "completed",
        timestamp: "2026-03-28T10:00:02.000Z",
      },
      {
        id: "reasoning-1",
        role: "reasoning",
        content: "Now I can interpret the test result.",
        status: "completed",
        timestamp: "2026-03-28T10:00:04.000Z",
      },
    ];

    render(
      <MessageList
        messages={messages}
        runEvents={[
          {
            event_type: "run_started",
            session_id: "session-1",
            run_id: "run-1",
            payload: {},
            timestamp: "2026-03-28T10:00:00.000Z",
          },
          {
            event_type: "retry_scheduled",
            session_id: "session-1",
            run_id: "run-1",
            payload: {
              attempt: 2,
              details: "LLM stream stalled before completion.",
            },
            timestamp: "2026-03-28T10:00:03.000Z",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /runtime notices 1/i }));

    const detailContent = screen.getByText("Retry scheduled").closest(".space-y-3")?.textContent || "";
    expect(detailContent.indexOf("shell_execute 执行成功")).toBeLessThan(detailContent.indexOf("Retry scheduled"));
    expect(detailContent.indexOf("Retry scheduled")).toBeLessThan(detailContent.indexOf("Now I can interpret the test result."));
  });

  it("renders delegated worker cards in the message flow and opens a detail modal", async () => {
    const delegatedOutput = {
      event: "delegated_task",
      summary: "Background handled: Summarize unresolved risks",
      data: {
        risks: ["runtime clamp pending"],
      },
      expected_output: "json",
      worker: {
        profile_name: "background",
        provider: "openai",
        model: "gpt-4o-mini",
      },
    };

    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Please analyze the current risks",
        status: "completed",
      },
      {
        id: "assistant-tool-call",
        role: "assistant",
        content: null,
        tool_calls: [
          {
            tool_call_id: "delegate-1",
            name: "delegate_task",
            arguments: {
              task: "Summarize unresolved risks",
            },
          },
        ],
        status: "completed",
      },
      {
        id: "tool-result-1",
        role: "tool",
        content: "delegate_task 执行成功",
        tool_call_id: "delegate-1",
        name: "delegate_task",
        timestamp: "2026-03-28T10:00:02.000Z",
        toolMessage: {
          kind: "result",
          toolName: "delegate_task",
          success: true,
          details: JSON.stringify(delegatedOutput, null, 2),
          output: delegatedOutput,
        },
        status: "completed",
      },
      {
        id: "assistant-final",
        role: "assistant",
        content: "我已经整理好了。",
        status: "completed",
      },
    ];

    render(
      <MessageList
        messages={messages}
        runEvents={[
          {
            event_type: "delegated_task_started",
            session_id: "session-1",
            run_id: "run-1",
            payload: {
              tool_call_id: "delegate-1",
              task: "Summarize unresolved risks",
              expected_output: "json",
            },
            timestamp: "2026-03-28T10:00:00.000Z",
          },
          {
            event_type: "delegated_task_completed",
            session_id: "session-1",
            run_id: "run-1",
            payload: {
              tool_call_id: "delegate-1",
              success: true,
              worker_profile_name: "background",
              worker_provider: "openai",
              worker_model: "gpt-4o-mini",
            },
            timestamp: "2026-03-28T10:00:02.000Z",
          },
        ]}
      />,
    );

    const completedWorkerCard = screen.getByTestId("delegated-worker-card-delegate-1");
    expect(completedWorkerCard).toBeTruthy();
    expect(within(completedWorkerCard).getByText("Summarize unresolved risks")).toBeTruthy();
    expect(within(completedWorkerCard).getByText("Completed")).toBeTruthy();
    expect(within(completedWorkerCard).getByText("2s")).toBeTruthy();
    expect(screen.queryByText("delegate_task 执行成功")).toBeNull();
    const messageListText = screen.getByText("我已经整理好了。").closest(".space-y-5")?.textContent || "";
    expect(messageListText.indexOf("我已经整理好了。")).toBeLessThan(
      messageListText.indexOf("Summarize unresolved risks"),
    );

    fireEvent.click(completedWorkerCard);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Delegated worker detail: Summarize unresolved risks" }),
      ).toBeTruthy();
    });

    expect(screen.getByText("Background handled: Summarize unresolved risks")).toBeTruthy();
    expect(screen.getByText("openai/gpt-4o-mini · background")).toBeTruthy();
    expect(screen.getByText(/"risks"/)).toBeTruthy();
  });

  it("shows multiple running delegated workers with independent elapsed times", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-03-28T10:00:05.000Z"));

      const messages: Message[] = [
        {
          id: "user-1",
          role: "user",
          content: "Split the work",
          status: "completed",
        },
        {
          id: "assistant-tool-call",
          role: "assistant",
          content: null,
          tool_calls: [
            {
              tool_call_id: "delegate-1",
              name: "delegate_task",
              arguments: {
                task: "Collect open issues",
              },
            },
            {
              tool_call_id: "delegate-2",
              name: "delegate_task",
              arguments: {
                task: "Check runtime clamps",
              },
            },
          ],
          status: "completed",
        },
      ];

      render(
        <MessageList
          messages={messages}
          isStreaming={true}
          assistantStatus="tool_calling"
          runEvents={[
            {
              event_type: "run_started",
              session_id: "session-1",
              run_id: "run-1",
              payload: {},
              timestamp: "2026-03-28T10:00:00.000Z",
            },
            {
              event_type: "delegated_task_started",
              session_id: "session-1",
              run_id: "run-1",
              payload: {
                tool_call_id: "delegate-1",
                task: "Collect open issues",
              },
              timestamp: "2026-03-28T10:00:00.000Z",
            },
            {
              event_type: "delegated_task_started",
              session_id: "session-1",
              run_id: "run-1",
              payload: {
                tool_call_id: "delegate-2",
                task: "Check runtime clamps",
              },
              timestamp: "2026-03-28T10:00:02.000Z",
            },
          ]}
        />,
      );

      const workerCardOne = screen.getByTestId("delegated-worker-card-delegate-1");
      const workerCardTwo = screen.getByTestId("delegated-worker-card-delegate-2");

      expect(workerCardOne).toBeTruthy();
      expect(workerCardTwo).toBeTruthy();
      expect(screen.getAllByText("Running")).toHaveLength(2);
      expect(within(workerCardOne).getByText("5s")).toBeTruthy();
      expect(within(workerCardTwo).getByText("3s")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(within(workerCardOne).getByText("7s")).toBeTruthy();
      expect(within(workerCardTwo).getByText("5s")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
