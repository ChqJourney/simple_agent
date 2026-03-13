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
});
