import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  getApiKey,
  getConfiguredProviders,
  getConfiguredVideoProviders,
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
    expect(defaultSettings.autoTranscribeOnImport).toBe(true);
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

  it("validates provider-specific api key prefixes", () => {
    expect(validateApiKey("gemini", "AIzaSyTest")).toBe(true);
    expect(validateApiKey("openai", "sk-test")).toBe(true);
    expect(validateApiKey("anthropic", "sk-ant-test")).toBe(true);
    expect(validateApiKey("openrouter", "sk-or-test")).toBe(true);
    expect(validateApiKey("gemini", "not-valid")).toBe(false);
    expect(validateApiKey("openai", "")).toBe(false);
  });
});
