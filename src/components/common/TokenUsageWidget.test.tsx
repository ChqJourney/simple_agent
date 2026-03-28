import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
