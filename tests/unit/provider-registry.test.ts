import { describe, it, expect } from "vitest";
import {
  PROVIDER_IDS,
  PROVIDER_METADATA,
  VIDEO_CAPABLE_PROVIDERS,
  getProviderContextTokenLimit,
  getProviderMetadata,
  isLLMProvider,
  normalizeProvider,
  providerSupportsVideo,
  resolveProviderModel,
  validateProviderApiKey,
} from "../../src/shared/llm/provider-registry.js";

describe("provider-registry: isLLMProvider / normalizeProvider", () => {
  it("accepts every registered provider id", () => {
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
    for (const id of PROVIDER_IDS) {
      expect(isLLMProvider(id)).toBe(true);
      expect(normalizeProvider(id)).toBe(id);
    }
  });

  it("rejects junk and non-string values", () => {
    const junk: unknown[] = [
      "not-a-provider",
      "",
      "GEMINI",
      "Gemini",
      "openai-2",
      null,
      undefined,
      0,
      1,
      true,
      {},
      [],
    ];
    for (const value of junk) {
      expect(isLLMProvider(value)).toBe(false);
      expect(normalizeProvider(value)).toBeNull();
    }
  });

  it("PROVIDER_IDS is the canonical, de-duplicated display order", () => {
    expect(PROVIDER_IDS).toEqual(
      expect.arrayContaining(Object.keys(PROVIDER_METADATA))
    );
    expect(new Set(PROVIDER_IDS).size).toBe(PROVIDER_IDS.length);
  });
});

describe("provider-registry: VIDEO_CAPABLE_PROVIDERS", () => {
  it("contains exactly the providers flagged supportsVideo: true", () => {
    const expected = PROVIDER_IDS.filter((id) => PROVIDER_METADATA[id].supportsVideo);
    expect(VIDEO_CAPABLE_PROVIDERS).toEqual(expected);
  });

  it("providerSupportsVideo agrees with the metadata flag for every provider", () => {
    for (const id of PROVIDER_IDS) {
      expect(providerSupportsVideo(id)).toBe(PROVIDER_METADATA[id].supportsVideo);
    }
  });

  it("includes gemini and kimi (the video-capable providers) and excludes text-only providers", () => {
    expect(VIDEO_CAPABLE_PROVIDERS).toContain("gemini");
    expect(VIDEO_CAPABLE_PROVIDERS).toContain("kimi");
    expect(VIDEO_CAPABLE_PROVIDERS).not.toContain("openai");
    expect(VIDEO_CAPABLE_PROVIDERS).not.toContain("anthropic");
    expect(VIDEO_CAPABLE_PROVIDERS).not.toContain("openrouter");
  });
});

describe("provider-registry: resolveProviderModel", () => {
  it("resolves gemini aliases to the current canonical model", () => {
    expect(resolveProviderModel("gemini", "gemini-3.0-flash")).toBe(
      "gemini-3.6-flash"
    );
    expect(resolveProviderModel("gemini", "gemini-3-flash")).toBe(
      "gemini-3.6-flash"
    );
  });

  it("resolves aliases case-insensitively", () => {
    expect(resolveProviderModel("gemini", "GEMINI-3-FLASH")).toBe(
      "gemini-3.6-flash"
    );
    expect(resolveProviderModel("gemini", "Gemini-3.0-Flash")).toBe(
      "gemini-3.6-flash"
    );
  });

  it("falls back to the provider defaultModel when model is missing, empty, or whitespace", () => {
    const geminiDefault = PROVIDER_METADATA.gemini.defaultModel;
    expect(resolveProviderModel("gemini", undefined)).toBe(geminiDefault);
    expect(resolveProviderModel("gemini", null)).toBe(geminiDefault);
    expect(resolveProviderModel("gemini", "")).toBe(geminiDefault);
    expect(resolveProviderModel("gemini", "   ")).toBe(geminiDefault);

    const openaiDefault = PROVIDER_METADATA.openai.defaultModel;
    expect(resolveProviderModel("openai", undefined)).toBe(openaiDefault);
    expect(resolveProviderModel("openai", "")).toBe(openaiDefault);
  });

  it("passes through non-alias model ids unchanged", () => {
    expect(resolveProviderModel("openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(resolveProviderModel("anthropic", "claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-4-20250514"
    );
    expect(resolveProviderModel("gemini", "gemini-3.1-pro-preview")).toBe(
      "gemini-3.1-pro-preview"
    );
  });

  it('uses the current balanced OpenAI model as the default', () => {
    expect(PROVIDER_METADATA.openai.defaultModel).toBe('gpt-5.6-terra');
    expect(PROVIDER_METADATA.openai.models.slice(0, 3).map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
  });

  it("returns the canonical model when the alias maps to the default", () => {
    expect(resolveProviderModel("gemini", "gemini-3-flash")).toBe(
      PROVIDER_METADATA.gemini.defaultModel
    );
  });
});

describe("provider-registry: validateProviderApiKey", () => {
  it("rejects empty keys for every provider", () => {
    for (const id of PROVIDER_IDS) {
      expect(validateProviderApiKey(id, "")).toBe(false);
    }
  });

  it("accepts keys with the provider's documented prefix", () => {
    expect(validateProviderApiKey("gemini", "AIzaSyabcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
    expect(validateProviderApiKey("openai", "sk-abcdef0123456789")).toBe(true);
    expect(validateProviderApiKey("anthropic", "sk-ant-abcdef0123456789")).toBe(true);
    expect(validateProviderApiKey("openrouter", "sk-or-abcdef0123456789")).toBe(true);
    expect(validateProviderApiKey("kimi", "sk-abcdef0123456789")).toBe(true);
  });

  it("rejects keys with the wrong prefix", () => {
    expect(validateProviderApiKey("gemini", "sk-abcdef")).toBe(false);
    expect(validateProviderApiKey("gemini", "sk-ant-abcdef")).toBe(false);
    expect(validateProviderApiKey("openai", "AIzaSyabcdef")).toBe(false);
    expect(validateProviderApiKey("anthropic", "sk-abcdef")).toBe(false);
    expect(validateProviderApiKey("openrouter", "sk-abcdef")).toBe(false);
    expect(validateProviderApiKey("kimi", "AIzaSyabcdef")).toBe(false);
  });

  it("uses exactly the prefixes declared in metadata", () => {
    for (const id of PROVIDER_IDS) {
      const meta = getProviderMetadata(id);
      for (const prefix of meta.apiKeyPrefixes) {
        expect(validateProviderApiKey(id, `${prefix}rest-of-the-key`)).toBe(true);
      }
    }
  });
});

describe("provider-registry: context token limits", () => {
  it("exposes per-provider contextTokenLimit from metadata", () => {
    for (const id of PROVIDER_IDS) {
      expect(getProviderContextTokenLimit(id)).toBe(
        PROVIDER_METADATA[id].contextTokenLimit
      );
    }
    expect(getProviderContextTokenLimit("openai")).toBe(1_048_576);
    expect(getProviderContextTokenLimit("gemini")).toBe(1_000_000);
  });
});
