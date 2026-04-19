import { describe, expect, it } from "vitest";
import type { ProviderType } from "../types";
import {
  hasRunnableConversationProfile,
  normalizeProviderConfig,
  resolveCapabilitySummaryForRole,
  resolveProfileForRole,
  supportsImageAttachmentsForRole,
} from "./config";

const providerBaseUrlCases = [
  {
    provider: "deepseek",
    model: "deepseek-chat",
    api_key: "deepseek-key",
    enable_reasoning: false,
    expectedBaseUrl: "https://api.deepseek.com",
  },
  {
    provider: "kimi",
    model: "kimi-k2.5",
    api_key: "kimi-key",
    enable_reasoning: true,
    expectedBaseUrl: "https://api.moonshot.cn/v1",
  },
] satisfies ReadonlyArray<{
  provider: ProviderType;
  model: string;
  api_key: string;
  enable_reasoning: boolean;
  expectedBaseUrl: string;
}>;

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

  it("drops legacy provider memory entries for unsupported providers", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      provider_memory: {
        openai: {
          model: "gpt-4o-mini",
          api_key: "test-key",
          base_url: "https://api.openai.com/v1",
        },
        ollama: {
          model: "llama3.2",
          api_key: "",
          base_url: "http://127.0.0.1:11434",
        },
      } as unknown as NonNullable<ReturnType<typeof normalizeProviderConfig>["provider_memory"]>,
    });

    expect(normalized.provider_memory).toEqual({
      openai: {
        model: "gpt-4o-mini",
        api_key: "test-key",
        base_url: "https://api.openai.com/v1",
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

  it("normalizes reference library roots and kinds", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      reference_library: {
        roots: [
          {
            id: "  ",
            label: " ",
            path: " /standards ",
            enabled: false,
            kinds: ["standard", " checklist ", "unknown"],
          },
          {
            id: "ignored",
            label: "Ignored",
            path: "   ",
            enabled: true,
          },
        ],
      },
    } as never);

    expect(normalized.reference_library).toEqual({
      roots: [
        {
          id: "/standards",
          label: "standards",
          path: "/standards",
          enabled: false,
          kinds: ["standard", "checklist"],
        },
      ],
    });
  });

  providerBaseUrlCases.forEach(({ provider, model, api_key, enable_reasoning, expectedBaseUrl }) => {
    it(`normalizes ${provider} config with the provider default base url`, () => {
      const normalized = normalizeProviderConfig({
        provider,
        model,
        api_key,
        base_url: " ",
        enable_reasoning,
      });

      expect(normalized.provider).toBe(provider);
      expect(normalized.base_url).toBe(expectedBaseUrl);
      expect(normalized.profiles?.primary.provider).toBe(provider);
      expect(normalized.profiles?.primary.base_url).toBe(expectedBaseUrl);
    });
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

  it("prefers live provider catalog metadata for supported input types", () => {
    const normalized = normalizeProviderConfig({
      provider: "openai",
      model: "gpt-4.1-nano",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      enable_reasoning: false,
      provider_catalog: {
        openai: [
          {
            id: "gpt-4.1-nano",
            supports_image_in: true,
            context_length: 128000,
          },
        ],
      },
    });

    expect(resolveCapabilitySummaryForRole(normalized, "conversation").supportedInputTypes).toEqual(["text", "image"]);
    expect(supportsImageAttachmentsForRole(normalized, "conversation")).toBe(true);
    expect(normalized.provider_catalog?.openai?.[0]?.context_length).toBe(128000);
  });
});
