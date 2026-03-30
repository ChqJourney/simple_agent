import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConfigStore } from "../../stores/configStore";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { OcrStatusPayload } from "../../types";
import { OCRStatusIndicator } from "./OCRStatusIndicator";

const ocrStatusState = vi.hoisted((): OcrStatusPayload => ({
  enabled: false,
  installed: false,
  status: "unavailable",
  version: null,
  engine: null,
  api_version: null,
  root_dir: null,
}));

vi.mock("../../contexts/WebSocketContext", () => ({
  useWebSocket: () => ({
    ocrStatus: ocrStatusState,
  }),
}));

describe("OCRStatusIndicator", () => {
  beforeEach(() => {
    useConfigStore.setState({ config: null as never });
    useSessionStore.setState((state) => ({
      ...state,
      currentSessionId: "session-a",
    }));
    useChatStore.setState({ sessions: {} });
    ocrStatusState.enabled = false;
    ocrStatusState.installed = false;
    ocrStatusState.status = "unavailable";
    ocrStatusState.version = null;
    ocrStatusState.engine = null;
    ocrStatusState.api_version = null;
    ocrStatusState.root_dir = null;
  });

  it("hides itself when OCR is disabled in config", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        ocr: {
          enabled: false,
        },
      },
    });

    render(<OCRStatusIndicator />);

    expect(screen.queryByText("OCR: unavailable")).toBeNull();
  });

  it("shows unavailable when OCR is enabled but not installed", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        ocr: {
          enabled: true,
        },
      },
    });
    ocrStatusState.enabled = true;

    render(<OCRStatusIndicator />);

    expect(screen.getByText("OCR: unavailable")).toBeTruthy();
  });

  it("shows starting while the OCR tool is running", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        ocr: {
          enabled: true,
        },
      },
    });
    ocrStatusState.enabled = true;
    ocrStatusState.installed = true;
    ocrStatusState.status = "available";
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: false,
          assistantStatus: "tool_calling",
          currentToolName: "ocr_extract",
          pendingToolConfirm: undefined,
          pendingQuestion: undefined,
        },
      },
    });

    render(<OCRStatusIndicator />);

    expect(screen.getByText("OCR: starting")).toBeTruthy();
  });
});
