import { describe, expect, it } from "vitest";
import type { ProviderType } from "../types";
import {
  getDefaultReasoningEnabled,
  getImageSupportStatus,
  getSupportedInputTypes,
  supportsImageInput,
  supportsReasoning,
} from "./modelCapabilities";

const conservativeFallbackCases = [
  { provider: "openai", model: "gpt-4-turbo" },
  { provider: "openai", model: "gpt-4o" },
  { provider: "qwen", model: "qwen-plus" },
  { provider: "deepseek", model: "deepseek-chat" },
] satisfies ReadonlyArray<{
  provider: ProviderType;
  model: string;
}>;

describe("model image capabilities", () => {
  it("treats image support as unknown without provider metadata", () => {
    conservativeFallbackCases.forEach(({ provider, model }) => {
      expect(getImageSupportStatus(provider, model)).toBe("unknown");
      expect(getSupportedInputTypes(provider, model)).toEqual(["text"]);
      expect(supportsImageInput(provider, model)).toBe(false);
    });
  });
});

describe("model reasoning capabilities", () => {
  it("marks known reasoning models as reasoning-capable", () => {
    expect(supportsReasoning("kimi", "kimi-k2-thinking")).toBe(true);
    expect(getDefaultReasoningEnabled("kimi", "kimi-k2-thinking")).toBe(true);
    expect(supportsReasoning("kimi", "kimi-k2.5")).toBe(true);
    expect(supportsReasoning("deepseek", "deepseek-v4-pro")).toBe(true);
  });

  it("treats unknown models conservatively as not reasoning-capable", () => {
    expect(supportsReasoning("kimi", "kimi-chat")).toBe(false);
    expect(getDefaultReasoningEnabled("kimi", "kimi-chat")).toBe(false);
  });
});
