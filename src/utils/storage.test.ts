import { describe, expect, it } from "vitest";
import { deserializeSessionHistoryEntry } from "./storage";

describe("storage", () => {
  it("preserves image attachment data urls when deserializing session history", () => {
    const messages = deserializeSessionHistoryEntry({
      role: "user",
      content: "Review this image",
      attachments: [
        {
          kind: "image",
          path: "diagram.png",
          name: "diagram.png",
          mime_type: "image/png",
          data_url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].attachments).toEqual([
      expect.objectContaining({
        kind: "image",
        name: "diagram.png",
        data_url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
      }),
    ]);
  });

  it("preserves assistant usage metadata when deserializing session history", () => {
    const messages = deserializeSessionHistoryEntry({
      role: "assistant",
      content: "Done",
      usage: {
        prompt_tokens: 4096,
        completion_tokens: 256,
        total_tokens: 4352,
        context_length: 128000,
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].usage).toEqual({
      prompt_tokens: 4096,
      completion_tokens: 256,
      total_tokens: 4352,
      context_length: 128000,
    });
  });

  it("prefers persisted tool success metadata over content heuristics", () => {
    const messages = deserializeSessionHistoryEntry({
      role: "tool",
      tool_call_id: "tool-1",
      name: "file_read",
      content: "Error: README.md",
      success: true,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe("completed");
    expect(messages[0].content).toBe("文件读取完成");
    expect(messages[0].toolMessage).toEqual({
      kind: "result",
      toolName: "file_read",
      success: true,
      details: "Error: README.md",
    });
  });

  it("falls back to legacy persisted tool content heuristics", () => {
    const messages = deserializeSessionHistoryEntry({
      role: "tool",
      tool_call_id: "tool-2",
      name: "file_read",
      content: "Error: file missing",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe("error");
    expect(messages[0].toolMessage).toEqual({
      kind: "result",
      toolName: "file_read",
      success: false,
      details: "Error: file missing",
    });
  });
});
