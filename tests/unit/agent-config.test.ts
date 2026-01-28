import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, setIpcConfig, getProviderLLMConfig } from "../../src/agent/config.js";

describe("Agent Config", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = {};
    setIpcConfig(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load config from .env when IPC config is not set", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEFAULT_PROVIDER = "openai";

    const config = await loadConfig();

    expect(config).toBeDefined();
    expect(config.defaultProvider).toBe("openai");
    expect(config.providers.openai).toBe("test-openai-key");
    expect(config.providers.gemini).toBe("test-gemini-key");
  });

  it("should use default provider when not specified", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.DEFAULT_PROVIDER;

    const config = await loadConfig();

    expect(config.defaultProvider).toBe("gemini");
  });

  it("should throw error when no API keys are found", async () => {
    await expect(loadConfig()).rejects.toThrow("No API keys found");
  });

  it("should load at least one provider", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    const config = await loadConfig();

    expect(config.providers.anthropic).toBe("test-anthropic-key");
    expect(Object.keys(config.providers)).toContain("anthropic");
  });

  it("should validate that at least one API key is present", async () => {
    await expect(loadConfig()).rejects.toThrow(/No API keys/);
  });

  it("should use IPC config when available", async () => {
    setIpcConfig({
      defaultProvider: "gemini",
      providers: {
        gemini: "ipc-gemini-key",
        openai: "ipc-openai-key",
      },
      temperature: 0.8,
      maxTokens: 2000,
    });

    process.env.GEMINI_API_KEY = "env-key";

    const config = await loadConfig();

    expect(config.defaultProvider).toBe("gemini");
    expect(config.providers.gemini).toBe("ipc-gemini-key");
    expect(config.providers.gemini).toBe("ipc-gemini-key");
  });

  it("should validate IPC config has at least one provider", async () => {
    setIpcConfig({
      defaultProvider: "gemini",
      providers: {},
    });

    await expect(loadConfig()).rejects.toThrow("No API key found for provider: gemini");
  });
});

describe("getProviderLLMConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = {};
    setIpcConfig(undefined as any);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return LLM config for specified provider", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.DEFAULT_PROVIDER = "gemini";

    const config = await loadConfig();
    const llmConfig = getProviderLLMConfig(config, "gemini");

    expect(llmConfig.provider).toBe("gemini");
    expect(llmConfig.apiKey).toBe("test-gemini-key");
    expect(llmConfig.temperature).toBe(0.7);
  });

  it("should use default provider when not specified", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEFAULT_PROVIDER = "openai";

    const config = await loadConfig();
    const llmConfig = getProviderLLMConfig(config);

    expect(llmConfig.provider).toBe("openai");
    expect(llmConfig.apiKey).toBe("test-openai-key");
  });

  it("should throw error when provider API key is missing", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";

    const config = await loadConfig();

    expect(() => getProviderLLMConfig(config, "gemini")).toThrow(
      "No API key found for provider: gemini"
    );
  });

  it("should preserve temperature and maxTokens from agent config", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const config = await loadConfig();
    config.temperature = 0.5;
    config.maxTokens = 1000;

    const llmConfig = getProviderLLMConfig(config);

    expect(llmConfig.temperature).toBe(0.5);
    expect(llmConfig.maxTokens).toBe(1000);
  });
});
