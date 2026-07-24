import { describe, expect, it } from "vitest";
import {
  buildProxyOptions,
  buildProviderConfig,
  defaultSettings,
  getApiKey,
  getConfiguredProviders,
  getConfiguredVideoProviders,
  getNamingModelApiKey,
  getProviderLabel,
  isProviderConfigured,
  supportsVideo,
  validateApiKey,
} from "../../src/renderer/lib/state/settings-helpers.js";

describe("settings helpers", () => {
  it("exposes the expected defaults", () => {
    expect(defaultSettings.defaultVideoProvider).toBe("gemini");
    expect(defaultSettings.defaultTextProvider).toBe("openai");
    expect(defaultSettings.autoGenerateProxies).toBe(true);
    expect(defaultSettings.proxyGenerationOnImport).toBe(true);
    expect(defaultSettings.autoChapterNamingEnabled).toBe(true);
    expect(defaultSettings.autoChapterNamingModel).toBe("gpt-5-nano");
    expect(defaultSettings.autoClipNamingModel).toBe("gpt-5-nano");
    expect(defaultSettings.autoThreadNamingModel).toBe("gpt-5-nano");
    expect(defaultSettings.autoTranscribeOnImport).toBe(true);
    expect(defaultSettings.coarseJumpSeconds).toBe(10);
  });

  it("returns provider labels and video support flags", () => {
    expect(getProviderLabel("gemini")).toBe("Google Gemini");
    expect(getProviderLabel("openrouter")).toBe("OpenRouter");
    expect(supportsVideo("gemini")).toBe(true);
    expect(supportsVideo("kimi")).toBe(true);
    expect(supportsVideo("openai")).toBe(false);
  });

  it("reads configured keys from settings", () => {
    const settings = {
      ...defaultSettings,
      geminiApiKey: "AIza-test",
      kimiApiKey: "sk-test",
    };

    expect(getApiKey(settings, "gemini")).toBe("AIza-test");
    expect(isProviderConfigured(settings, "gemini")).toBe(true);
    expect(isProviderConfigured(settings, "openai")).toBe(false);
    expect(getConfiguredProviders(settings)).toEqual(["gemini", "kimi"]);
    expect(getConfiguredVideoProviders(settings)).toEqual(["gemini", "kimi"]);
  });

  it("requires a URL and model for an OpenAI-compatible profile", () => {
    const profile = {
      id: "local",
      name: "Local model",
      baseURL: "http://localhost:11434/v1",
      model: "",
      apiKey: "",
      contextTokenLimit: 128_000,
    };
    const settings = {
      ...defaultSettings,
      activeOpenAICompatibleProfileId: profile.id,
      openAICompatibleProfiles: [profile],
    };

    expect(isProviderConfigured(settings, "openaiCompatible")).toBe(false);
    profile.model = "llama3.2";
    expect(isProviderConfigured(settings, "openaiCompatible")).toBe(true);
  });

  it("validates provider-specific api key prefixes", () => {
    expect(validateApiKey("gemini", "AIzaSyTest")).toBe(true);
    expect(validateApiKey("openai", "sk-test")).toBe(true);
    expect(validateApiKey("anthropic", "sk-ant-test")).toBe(true);
    expect(validateApiKey("openrouter", "sk-or-test")).toBe(true);
    expect(validateApiKey("gemini", "not-valid")).toBe(false);
    expect(validateApiKey("openai", "")).toBe(false);
  });

  it("builds provider config payloads and resolves naming model keys", () => {
    const settings = {
      ...defaultSettings,
      geminiApiKey: "AIza-test",
      kimiApiKey: "sk-kimi",
    };

    expect(buildProviderConfig(settings, "gemini")).toEqual({
      defaultProvider: "gemini",
      providers: {
        gemini: "AIza-test",
        kimi: "sk-kimi",
      },
    });
    expect(getNamingModelApiKey(settings, "gemini-3-flash-preview")).toBe("AIza-test");
    expect(getNamingModelApiKey(settings, "kimi-k2.5")).toBe("sk-kimi");
  });

  it("includes the selected model context limit in provider config", () => {
    const settings = {
      ...defaultSettings,
      kimiApiKey: "sk-kimi",
      providerModels: { kimi: "kimi-k2.7-code" } as const,
    };

    expect(buildProviderConfig(settings, "kimi")).toMatchObject({
      models: { kimi: "kimi-k2.7-code" },
      contextTokenLimits: { kimi: 262_144 },
    });
  });

  it("builds proxy options directly from settings", () => {
    expect(buildProxyOptions(defaultSettings)).toEqual({
      encodingMode: "auto",
      quality: "balanced",
    });

    expect(buildProxyOptions({
      ...defaultSettings,
      proxyEncodingMode: "gpu",
      proxyQuality: "fast",
    })).toEqual({
      encodingMode: "gpu",
      quality: "fast",
    });
  });
});
