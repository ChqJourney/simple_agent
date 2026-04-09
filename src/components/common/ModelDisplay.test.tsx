import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useConfigStore } from "../../stores/configStore";
import { useSessionStore } from "../../stores/sessionStore";
import { ModelDisplay } from "./ModelDisplay";

describe("ModelDisplay", () => {
  beforeEach(() => {
    useConfigStore.setState({
      config: null,
    });
    useSessionStore.setState((state) => ({
      ...state,
      currentSessionId: null,
      sessions: [],
    }));
  });

  it("shows friendly provider labels for supported providers", () => {
    useConfigStore.setState({
      config: {
        provider: "minimax",
        model: "MiniMax-M2.5",
        api_key: "test-key",
        base_url: "https://api.minimax.chat/v1",
        enable_reasoning: false,
        input_type: "text",
      },
    });

    render(<ModelDisplay />);

    expect(screen.getByText("MiniMax-M2.5")).toBeTruthy();
    expect(screen.getByText("MiniMax")).toBeTruthy();
  });

  it("prefers the locked model for the current session", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o-mini",
        api_key: "test-key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        input_type: "text",
      },
    });
    useSessionStore.setState((state) => ({
      ...state,
      currentSessionId: "session-a",
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "/workspace",
          created_at: "2026-04-09T00:00:00.000Z",
          updated_at: "2026-04-09T00:00:00.000Z",
          locked_model: {
            profile_name: "primary",
            provider: "deepseek",
            model: "deepseek-chat",
          },
        },
      ],
    }));

    render(<ModelDisplay />);

    expect(screen.getByText("deepseek-chat")).toBeTruthy();
    expect(screen.getByText("DeepSeek")).toBeTruthy();
    expect(screen.getByText("Session")).toBeTruthy();
  });
});
