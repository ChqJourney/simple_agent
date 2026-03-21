import { describe, expect, it } from "vitest";
import { getImageSupportStatus, getSupportedInputTypes, supportsImageInput } from "./modelCapabilities";

describe("model image capabilities", () => {
  it("marks known vision models as image-capable", () => {
    expect(getImageSupportStatus("openai", "gpt-4o")).toBe("supported");
    expect(supportsImageInput("openai", "gpt-4o-mini")).toBe(true);
    expect(getSupportedInputTypes("openai", "gpt-4o")).toEqual(["text", "image"]);
    expect(getImageSupportStatus("kimi", "kimi-k2.5")).toBe("supported");
    expect(getSupportedInputTypes("glm", "glm-4.6v")).toEqual(["text", "image"]);
  });

  it("marks known text-only models as unsupported for image input", () => {
    expect(getImageSupportStatus("deepseek", "deepseek-chat")).toBe("unsupported");
    expect(getImageSupportStatus("openai", "o1-preview")).toBe("unsupported");
    expect(getSupportedInputTypes("deepseek", "deepseek-chat")).toEqual(["text"]);
    expect(getImageSupportStatus("minimax", "MiniMax-M2.7")).toBe("unsupported");
  });

  it("treats unknown models conservatively as text-only", () => {
    expect(getImageSupportStatus("openai", "gpt-4-turbo")).toBe("unknown");
    expect(getImageSupportStatus("ollama", "llama3.1")).toBe("unknown");
    expect(supportsImageInput("ollama", "llama3.1")).toBe(false);
  });
});
