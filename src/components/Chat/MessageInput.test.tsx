import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../types";
import { MessageInput } from "./MessageInput";

function createDataTransfer(payloads: Record<string, string>, files: File[] = []) {
  return {
    files,
    getData: (type: string) => payloads[type] || "",
    setData: vi.fn(),
    clearData: vi.fn(),
    dropEffect: "copy",
    effectAllowed: "all",
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
    types: Object.keys(payloads),
  };
}

describe("MessageInput", () => {
  it("inserts dragged file and folder paths into the prompt textarea", () => {
    render(<MessageInput onSend={vi.fn()} />);

    const textarea = screen.getByPlaceholderText("Type your message...");
    const dataTransfer = createDataTransfer({
      "application/x-tauri-agent-file": JSON.stringify([
        { path: "src/app.ts", name: "app.ts", isDirectory: false, isImage: false },
        { path: "src/components", name: "components", isDirectory: true, isImage: false },
      ]),
    });

    fireEvent.drop(textarea, { dataTransfer });

    expect((textarea as HTMLTextAreaElement).value).toContain("src/app.ts");
    expect((textarea as HTMLTextAreaElement).value).toContain("src/components");
  });

  it("adds dropped images as attachments and sends them with the message", async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const attachmentZone = screen.getByLabelText("Image attachment drop zone");
    const imageFile = new File(["image-bytes"], "diagram.png", { type: "image/png" });
    const dataTransfer = createDataTransfer({}, [imageFile]);

    fireEvent.drop(attachmentZone, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText("diagram.png")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText("Type your message...");
    fireEvent.change(textarea, { target: { value: "Review this screenshot" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith(
      "Review this screenshot",
      [
        expect.objectContaining<Partial<Attachment>>({
          kind: "image",
          name: "diagram.png",
          mime_type: "image/png",
          data_url: expect.stringMatching(/^data:image\/png;base64,/),
        }),
      ]
    );
  });

  it("allows sending a message with image attachments only", async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const attachmentZone = screen.getByLabelText("Image attachment drop zone");
    const imageFile = new File(["image-bytes"], "diagram.png", { type: "image/png" });
    const dataTransfer = createDataTransfer({}, [imageFile]);

    fireEvent.drop(attachmentZone, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText("diagram.png")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith(
      "",
      [
        expect.objectContaining<Partial<Attachment>>({
          kind: "image",
          name: "diagram.png",
          data_url: expect.stringMatching(/^data:image\/png;base64,/),
        }),
      ]
    );
  });

  it("shows execution mode selector with Regular and Free options", () => {
    render(<MessageInput onSend={vi.fn()} />);

    const selector = screen.getByLabelText("Execution mode") as HTMLSelectElement;
    expect(selector.value).toBe("regular");
    expect(screen.getByRole("option", { name: "Regular" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Free" })).toBeTruthy();
  });
});
