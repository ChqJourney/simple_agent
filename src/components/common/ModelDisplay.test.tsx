import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useConfigStore } from "../../stores/configStore";
import { ModelDisplay } from "./ModelDisplay";

describe("ModelDisplay", () => {
  beforeEach(() => {
    useConfigStore.setState({
      config: null,
    });
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
});
