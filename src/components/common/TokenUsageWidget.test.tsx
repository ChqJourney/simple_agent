import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConfigStore } from "../../stores/configStore";
import { TokenUsageWidget } from "./TokenUsageWidget";

describe("TokenUsageWidget", () => {
  it("renders the latest request prompt/context percentage and usage details", () => {
    render(
      <TokenUsageWidget
        usage={{
          prompt_tokens: 32000,
          completion_tokens: 1024,
          total_tokens: 33024,
          context_length: 128000,
        }}
      />
    );

    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByTitle(/Last request/)).toBeTruthy();
    expect(screen.getByTitle(/prompt: 32000 \/ context: 128000/)).toBeTruthy();
  });

  it("renders compaction-based context estimates with an estimate-specific title", () => {
    render(
      <TokenUsageWidget
        usage={{
          prompt_tokens: 24000,
          completion_tokens: 0,
          total_tokens: 24000,
          context_length: 128000,
        }}
        mode="context_estimate"
      />
    );

    expect(screen.getByText("19%")).toBeTruthy();
    expect(screen.getByTitle(/Current context estimate/)).toBeTruthy();
    expect(screen.getByTitle(/derived from latest session compaction/)).toBeTruthy();
  });

  it("renders an empty state when usage is unavailable", () => {
    render(<TokenUsageWidget />);

    expect(screen.getByText("--")).toBeTruthy();
  });

  it("falls back to configStore context_length when usage lacks it", () => {
    useConfigStore.setState({
      config: {
        provider: 'openai',
        model: 'gpt-4o',
        api_key: 'test-key',
        base_url: 'https://api.openai.com/v1',
        enable_reasoning: false,
        runtime: { shared: { context_length: 64000 } },
      } as any,
    });

    render(
      <TokenUsageWidget
        usage={{
          prompt_tokens: 16000,
          completion_tokens: 512,
          total_tokens: 16512,
          // context_length intentionally omitted
        }}
      />
    );

    // 16000 / 64000 = 25%
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByTitle(/prompt: 16000 \/ context: 64000/)).toBeTruthy();

    useConfigStore.setState({ config: null });
  });
});
