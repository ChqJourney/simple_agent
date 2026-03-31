import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../types";
import { clearActiveDraggedFileDescriptors, setActiveDraggedFileDescriptors } from "../../utils/internalDragState";
import { MessageInput } from "./MessageInput";

const readFileMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", async () => {
  const actual = await vi.importActual<typeof import("@tauri-apps/plugin-fs")>("@tauri-apps/plugin-fs");
  return {
    ...actual,
    readFile: readFileMock,
  };
});

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

function createImageDragMetadata(fileName: string, mimeType: string) {
  return {
    files: [],
    getData: () => "",
    setData: vi.fn(),
    clearData: vi.fn(),
    dropEffect: "copy",
    effectAllowed: "all",
    items: [
      {
        kind: "file",
        type: mimeType,
        getAsFile: () => new File(["image-bytes"], fileName, { type: mimeType }),
      },
    ],
    types: ["Files"],
  };
}

function createClipboardData(files: File[] = []) {
  return {
    files,
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
    types: files.length > 0 ? ["Files"] : [],
  };
}

describe("MessageInput", () => {
  beforeEach(() => {
    clearActiveDraggedFileDescriptors();
    readFileMock.mockReset();
    readFileMock.mockResolvedValue(Uint8Array.from([137, 80, 78, 71]));
  });

  it("keeps the image drop zone hidden until an image drag enters", () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);

    expect(screen.queryByLabelText("Image attachment drop zone")).toBeNull();

    const composer = screen.getByTestId("composer-shell");
    const imageFile = new File(["image-bytes"], "diagram.png", { type: "image/png" });
    const dataTransfer = createDataTransfer({}, [imageFile]);

    fireEvent.dragEnter(composer, { dataTransfer });

    expect(screen.getByLabelText("Image attachment drop zone")).toBeTruthy();
  });

  it("detects image file drags even before DataTransfer.files is populated", () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);

    const composer = screen.getByTestId("composer-shell");
    fireEvent.dragEnter(composer, {
      dataTransfer: createImageDragMetadata("diagram.png", "image/png"),
    });

    expect(screen.getByLabelText("Image attachment drop zone")).toBeTruthy();
  });

  it("detects image drags coming from the workspace file tree", () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);
    setActiveDraggedFileDescriptors([
      {
        path: "/workspace/assets/diagram.png",
        name: "diagram.png",
        isDirectory: false,
        isImage: true,
      },
    ]);

    const composer = screen.getByTestId("composer-shell");
    fireEvent.dragEnter(composer, {
      dataTransfer: {
        files: [],
        getData: () => "",
        setData: vi.fn(),
        clearData: vi.fn(),
        dropEffect: "copy",
        effectAllowed: "all",
        items: [],
        types: ["application/x-tauri-agent-file", "application/x-tauri-agent-image", "text/plain"],
      },
    });

    expect(screen.getByLabelText("Image attachment drop zone")).toBeTruthy();
  });

  it("falls back to the active workspace drag descriptor when drop data is stripped", async () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);
    setActiveDraggedFileDescriptors([
      {
        path: "/workspace/assets/diagram.png",
        name: "diagram.png",
        isDirectory: false,
        isImage: true,
      },
    ]);

    const composer = screen.getByTestId("composer-shell");
    fireEvent.drop(composer, {
      dataTransfer: {
        files: [],
        getData: () => "",
        setData: vi.fn(),
        clearData: vi.fn(),
        dropEffect: "copy",
        effectAllowed: "all",
        items: [],
        types: ["text/plain"],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("diagram.png")).toBeTruthy();
    });
  });

  it("shows dragged file and folder references inside the prompt input", () => {
    render(<MessageInput onSend={vi.fn()} />);

    const textarea = screen.getByPlaceholderText("Type your message...");
    const dataTransfer = createDataTransfer({
      "application/x-tauri-agent-file": JSON.stringify([
        { path: "src/app.ts", name: "app.ts", isDirectory: false, isImage: false },
        { path: "src/components", name: "components", isDirectory: true, isImage: false },
      ]),
    });

    fireEvent.drop(textarea, { dataTransfer });

    expect((textarea as HTMLTextAreaElement).value).toBe("app.ts components");
    expect(screen.getAllByText("app.ts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("components").length).toBeGreaterThan(0);
  });

  it("inserts dropped file references at the current cursor position", () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Type your message...") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Review  please" } });
    textarea.setSelectionRange(7, 7);

    fireEvent.drop(textarea, {
      dataTransfer: createDataTransfer({
        "application/x-tauri-agent-file": JSON.stringify({
          path: "/workspace/src/app.ts",
          name: "app.ts",
          isDirectory: false,
          isImage: false,
        }),
      }),
    });

    expect(textarea.value).toBe("Review app.ts please");
    expect(screen.getAllByText("app.ts").length).toBeGreaterThan(0);
  });

  it("sends absolute file paths while showing filenames to the user", () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Type your message...") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Review these files" } });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    fireEvent.drop(textarea, {
      dataTransfer: createDataTransfer({
        "application/x-tauri-agent-file": JSON.stringify([
          { path: "/workspace/src/app.ts", name: "app.ts", isDirectory: false, isImage: false },
          { path: "/workspace/src/components", name: "components", isDirectory: true, isImage: false },
        ]),
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith(
      "Review these files /workspace/src/app.ts /workspace/src/components",
      [],
      "Review these files app.ts components",
    );
  });

  it("removes inline file tokens as a whole with Backspace and Delete", () => {
    render(<MessageInput onSend={vi.fn()} />);

    const textarea = screen.getByPlaceholderText("Type your message...") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Review please" } });
    textarea.setSelectionRange(7, 7);

    fireEvent.drop(textarea, {
      dataTransfer: createDataTransfer({
        "application/x-tauri-agent-file": JSON.stringify({
          path: "/workspace/src/app.ts",
          name: "app.ts",
          isDirectory: false,
          isImage: false,
        }),
      }),
    });

    expect(textarea.value).toBe("Review app.ts please");

    textarea.setSelectionRange(13, 13);
    fireEvent.keyDown(textarea, { key: "Backspace" });
    expect(textarea.value).toBe("Review please");

    textarea.setSelectionRange(7, 7);
    fireEvent.drop(textarea, {
      dataTransfer: createDataTransfer({
        "application/x-tauri-agent-file": JSON.stringify({
          path: "/workspace/src/app.ts",
          name: "app.ts",
          isDirectory: false,
          isImage: false,
        }),
      }),
    });

    expect(textarea.value).toBe("Review app.ts please");

    textarea.setSelectionRange(7, 7);
    fireEvent.keyDown(textarea, { key: "Delete" });
    expect(textarea.value).toBe("Review please");
  });

  it("adds dropped images as attachments and sends them with the message", async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} supportsImageAttachments={true} />);

    const imageFile = new File(["image-bytes"], "diagram.png", { type: "image/png" });
    const dataTransfer = createDataTransfer({}, [imageFile]);
    const composer = screen.getByTestId("composer-shell");

    fireEvent.dragEnter(composer, { dataTransfer });

    const attachmentZone = screen.getByLabelText("Image attachment drop zone");

    fireEvent.drop(attachmentZone, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText("diagram.png")).toBeTruthy();
    });
    expect(screen.getByAltText("Attachment preview: diagram.png")).toBeTruthy();

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
      ],
      "Review this screenshot",
    );
  });

  it("allows sending a message with image attachments only", async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} supportsImageAttachments={true} />);

    const imageFile = new File(["image-bytes"], "diagram.png", { type: "image/png" });
    const dataTransfer = createDataTransfer({}, [imageFile]);
    const composer = screen.getByTestId("composer-shell");

    fireEvent.dragEnter(composer, { dataTransfer });

    const attachmentZone = screen.getByLabelText("Image attachment drop zone");

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
      ],
      "",
    );
  });

  it("can attach an image dropped onto the composer shell directly", async () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);

    const composer = screen.getByTestId("composer-shell");
    const imageFile = new File(["image-bytes"], "shell-drop.png", { type: "image/png" });
    const dataTransfer = createDataTransfer({}, [imageFile]);

    fireEvent.drop(composer, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText("shell-drop.png")).toBeTruthy();
    });
  });

  it("accepts workspace file references dropped onto the composer shell", async () => {
    render(<MessageInput onSend={vi.fn()} />);

    const composer = screen.getByTestId("composer-shell");
    fireEvent.drop(composer, {
      dataTransfer: createDataTransfer({
        "application/x-tauri-agent-file": JSON.stringify({
          path: "/workspace/docs/guide.md",
          name: "guide.md",
          isDirectory: false,
          isImage: false,
        }),
      }),
    });

    await waitFor(() => {
      expect(screen.getAllByText("guide.md").length).toBeGreaterThan(0);
    });
  });

  it("treats an image dropped from the workspace file tree onto the textarea as a path token", async () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);

    const textarea = screen.getByPlaceholderText("Type your message...") as HTMLTextAreaElement;
    const dataTransfer = createDataTransfer({
      "application/x-tauri-agent-file": JSON.stringify({
        path: "/workspace/assets/diagram.png",
        name: "diagram.png",
        isDirectory: false,
        isImage: true,
      }),
      "application/x-tauri-agent-image": "/workspace/assets/diagram.png",
      "text/plain": "/workspace/assets/diagram.png",
    });

    fireEvent.drop(textarea, { dataTransfer });

    await waitFor(() => {
      expect(screen.getAllByText("diagram.png").length).toBeGreaterThan(0);
    });
    expect(readFileMock).not.toHaveBeenCalled();
    expect(screen.queryByAltText("Attachment preview: diagram.png")).toBeNull();
    expect(textarea.value).toBe("diagram.png");
  });

  it("adds pasted images as attachments and shows a thumbnail preview", async () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);

    const textarea = screen.getByLabelText("Message input");
    const imageFile = new File(["image-bytes"], "clipboard.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: createClipboardData([imageFile]),
    });

    await waitFor(() => {
      expect(screen.getByText("clipboard.png")).toBeTruthy();
    });

    expect(
      screen.getByAltText("Attachment preview: clipboard.png").getAttribute("src")
    ).toMatch(/^data:image\/png;base64,/);
  });

  it("removes an attachment through its delete button", async () => {
    render(<MessageInput onSend={vi.fn()} supportsImageAttachments={true} />);

    const textarea = screen.getByLabelText("Message input");
    const imageFile = new File(["image-bytes"], "clipboard.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: createClipboardData([imageFile]),
    });

    await waitFor(() => {
      expect(screen.getByText("clipboard.png")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove attachment clipboard.png" }));

    await waitFor(() => {
      expect(screen.queryByText("clipboard.png")).toBeNull();
    });
  });

  it("shows execution mode selector with Regular and Free options", () => {
    render(<MessageInput onSend={vi.fn()} />);

    const composer = screen.getByTestId("composer-shell");
    const selector = screen.getByLabelText("Execution mode");
    const sendButton = screen.getByRole("button", { name: "Send message" });
    const textarea = screen.getByPlaceholderText("Type your message...") as HTMLTextAreaElement;

    expect(selector.textContent).toContain("Regular");
    fireEvent.click(selector);
    expect(screen.getByRole("option", { name: /Regular/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Free/ })).toBeTruthy();
    expect(textarea.rows).toBe(5);
    expect(composer.contains(selector)).toBe(true);
    expect(composer.contains(sendButton)).toBe(true);
  });

  it("keeps the textarea editable while streaming but does not send", () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} isStreaming={true} />);

    const textarea = screen.getByLabelText("Message input") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);

    fireEvent.change(textarea, { target: { value: "Draft next request" } });
    expect(textarea.value).toBe("Draft next request");

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeTruthy();
  });
});
