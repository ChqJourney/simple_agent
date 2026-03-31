import { describe, expect, it } from "vitest";
import {
  hasRunnableConversationProfile,
  normalizeProviderConfig,
  resolveCapabilitySummaryForRole,
  resolveProfileForRole,
  supportsImageAttachmentsForRole,
} from "./config";

describe("normalizeProviderConfig", () => {
  it("promotes flat config into a primary profile while preserving runtime metadata", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "   ",
      enable_reasoning: false,
      runtime: {
        shared: {
          context_length: 64000,
        },
      },
    });

    expect(normalized.profiles?.primary.model).toBe("gpt-4o-mini");
    expect(normalized.profiles?.primary.profile_name).toBe("primary");
    expect(normalized.profiles?.primary.base_url).toBe("https://api.openai.com/v1");
    expect(normalized.runtime?.shared?.context_length).toBe(64000);
    expect(normalized.context_providers?.skills?.local?.enabled).toBe(true);
    expect(normalized.ocr?.enabled).toBe(false);
  });

  it("preserves explicit OCR enablement", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      ocr: {
        enabled: true,
      },
    });

    expect(normalized.ocr).toEqual({
      enabled: true,
    });
  });

  it("normalizes disabled tool and system skill lists", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      context_providers: {
        skills: {
          local: {
            enabled: true,
          },
          system: {
            disabled: ["deploy-checks", "deploy-checks", " docs-helper "],
          },
        },
        tools: {
          disabled: ["file_read", "file_read", " shell_execute "],
        },
      },
    });

    expect(normalized.context_providers).toEqual({
      skills: {
        local: {
          enabled: true,
        },
        system: {
          disabled: ["deploy-checks", "docs-helper"],
        },
      },
      tools: {
        disabled: ["file_read", "shell_execute"],
      },
    });
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
      shared: {
        context_length: 64000,
        max_output_tokens: 4000,
        max_tool_rounds: 20,
        max_retries: 3,
        timeout_seconds: 120,
      },
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

  it("resolves background-family roles to the background profile when configured", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      profiles: {
        primary: {
          provider: "openai",
          model: "gpt-4o",
          api_key: "test-key",
          base_url: "https://api.openai.com/v1",
          enable_reasoning: false,
          profile_name: "primary",
        },
        background: {
          provider: "deepseek",
          model: "deepseek-chat",
          api_key: "test-key",
          base_url: "https://api.deepseek.com",
          enable_reasoning: false,
          profile_name: "background",
        },
      },
    });

    expect(resolveProfileForRole(normalized, "background")?.profile_name).toBe("background");
    expect(resolveProfileForRole(normalized, "compaction")?.model).toBe("deepseek-chat");
    expect(resolveProfileForRole(normalized, "delegated_task")?.provider).toBe("deepseek");
  });

  it("computes conversation image capability from the conversation role profile", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      profiles: {
        primary: {
          provider: "openai",
          model: "gpt-4o",
          api_key: "test-key",
          base_url: "https://api.openai.com/v1",
          enable_reasoning: false,
          profile_name: "primary",
        },
        background: {
          provider: "deepseek",
          model: "deepseek-chat",
          api_key: "test-key",
          base_url: "https://api.deepseek.com",
          enable_reasoning: false,
          profile_name: "background",
        },
      },
    });

    expect(resolveCapabilitySummaryForRole(normalized, "conversation").supportedInputTypes).toEqual(["text", "image"]);
    expect(resolveCapabilitySummaryForRole(normalized, "background").supportedInputTypes).toEqual(["text"]);
    expect(supportsImageAttachmentsForRole(normalized, "conversation")).toBe(true);
    expect(supportsImageAttachmentsForRole(normalized, "background")).toBe(false);
  });
});
