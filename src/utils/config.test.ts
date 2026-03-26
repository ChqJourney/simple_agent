import { describe, expect, it } from "vitest";
import { hasRunnableConversationProfile, normalizeProviderConfig } from "./config";

describe("normalizeProviderConfig", () => {
  it("promotes flat config into a primary profile while preserving runtime metadata", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "   ",
      enable_reasoning: false,
      runtime: {
        context_length: 64000,
      },
    });

    expect(normalized.profiles?.primary.model).toBe("gpt-4o-mini");
    expect(normalized.profiles?.primary.profile_name).toBe("primary");
    expect(normalized.profiles?.primary.base_url).toBe("https://api.openai.com/v1");
    expect(normalized.runtime?.context_length).toBe(64000);
    expect(normalized.context_providers?.skills?.local?.enabled).toBe(true);
  });

  it("fills runtime defaults when runtime values are omitted", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
    });

    expect(normalized.runtime).toEqual({
      context_length: 64000,
      max_output_tokens: 4000,
      max_tool_rounds: 20,
      max_retries: 3,
    });
  });

  it("trims and preserves a custom system prompt", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      system_prompt: "  Prefer concise answers.  ",
    });

    expect(normalized.system_prompt).toBe("Prefer concise answers.");
  });

  it("fills appearance defaults when appearance values are omitted", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
    });

    expect(normalized.appearance).toEqual({
      base_font_size: 16,
    });
  });

  it("normalizes deepseek config with the provider default base url", () => {
    const normalized = normalizeProviderConfig({
      provider: "deepseek",
      model: "deepseek-chat",
      api_key: "deepseek-key",
      base_url: " ",
      enable_reasoning: false,
    });

    expect(normalized.provider).toBe("deepseek");
    expect(normalized.base_url).toBe("https://api.deepseek.com");
    expect(normalized.profiles?.primary.provider).toBe("deepseek");
    expect(normalized.profiles?.primary.base_url).toBe("https://api.deepseek.com");
  });

  it("normalizes kimi config with the provider default base url", () => {
    const normalized = normalizeProviderConfig({
      provider: "kimi",
      model: "kimi-k2.5",
      api_key: "kimi-key",
      base_url: " ",
      enable_reasoning: true,
    });

    expect(normalized.provider).toBe("kimi");
    expect(normalized.base_url).toBe("https://api.moonshot.cn/v1");
    expect(normalized.profiles?.primary.provider).toBe("kimi");
    expect(normalized.profiles?.primary.base_url).toBe("https://api.moonshot.cn/v1");
  });

  it("treats hosted providers without an API key as not runnable", () => {
    expect(hasRunnableConversationProfile({
      provider: "openai",
      model: "gpt-4o",
      api_key: "",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
    })).toBe(false);
  });

  it("treats ollama models as runnable without an API key", () => {
    expect(hasRunnableConversationProfile({
      provider: "ollama",
      model: "llama3.2",
      api_key: "",
      base_url: "http://127.0.0.1:11434",
      enable_reasoning: false,
    })).toBe(true);
  });
});
