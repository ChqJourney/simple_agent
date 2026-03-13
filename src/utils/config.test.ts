import { describe, expect, it } from "vitest";
import { normalizeProviderConfig } from "./config";

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
    expect(normalized.context_providers?.retrieval?.workspace?.enabled).toBe(true);
    expect(normalized.context_providers?.retrieval?.workspace?.max_hits).toBe(3);
    expect(normalized.context_providers?.retrieval?.workspace?.extensions).toEqual([".md", ".txt", ".json"]);
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
});
