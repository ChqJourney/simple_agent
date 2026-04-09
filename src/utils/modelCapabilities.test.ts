import { describe, expect, it } from "vitest";
import type { InputType, ProviderType } from "../types";
import { getImageSupportStatus, getSupportedInputTypes, supportsImageInput } from "./modelCapabilities";

const imageCapableCases = [
  { provider: "openai", model: "gpt-4o", supportedInputTypes: ["text", "image"] },
  { provider: "openai", model: "gpt-4o-mini", supportedInputTypes: ["text", "image"] },
  { provider: "kimi", model: "kimi-k2.5", supportedInputTypes: ["text", "image"] },
  { provider: "glm", model: "glm-4.6v", supportedInputTypes: ["text", "image"] },
] satisfies ReadonlyArray<{
  provider: ProviderType;
  model: string;
  supportedInputTypes: InputType[];
}>;

const textOnlyCases = [
  { provider: "deepseek", model: "deepseek-chat" },
  { provider: "openai", model: "o1-preview" },
  { provider: "minimax", model: "MiniMax-M2.7" },
] satisfies ReadonlyArray<{
  provider: ProviderType;
  model: string;
}>;

const conservativeFallbackCases = [
  { provider: "openai", model: "gpt-4-turbo" },
  { provider: "qwen", model: "qwen-plus" },
] satisfies ReadonlyArray<{
  provider: ProviderType;
  model: string;
}>;

describe("model image capabilities", () => {
  it("marks known vision models as image-capable", () => {
    imageCapableCases.forEach(({ provider, model, supportedInputTypes }) => {
      expect(getImageSupportStatus(provider, model)).toBe("supported");
      expect(supportsImageInput(provider, model)).toBe(true);
      expect(getSupportedInputTypes(provider, model)).toEqual(supportedInputTypes);
    });
  });

  it("marks known text-only models as unsupported for image input", () => {
    textOnlyCases.forEach(({ provider, model }) => {
      expect(getImageSupportStatus(provider, model)).toBe("unsupported");
      expect(getSupportedInputTypes(provider, model)).toEqual(["text"]);
      expect(supportsImageInput(provider, model)).toBe(false);
    });
  });

  it("treats unknown models conservatively as text-only", () => {
    conservativeFallbackCases.forEach(({ provider, model }) => {
      expect(getImageSupportStatus(provider, model)).toBe("unsupported");
      expect(getSupportedInputTypes(provider, model)).toEqual(["text"]);
      expect(supportsImageInput(provider, model)).toBe(false);
    });
  });
});
