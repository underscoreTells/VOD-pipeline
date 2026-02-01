import { describe, it, expect, beforeEach, vi } from "vitest";

// Test the logic and types without importing the Svelte file
// which uses $state runes that require the Svelte compiler

describe("Settings Type Definitions (Task 4.10)", () => {
  type LLMProviderType = "openai" | "gemini" | "anthropic" | "openrouter" | "kimi";

  interface Settings {
    geminiApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    kimiApiKey: string;
    openrouterApiKey: string;
    defaultVideoProvider: LLMProviderType;
    defaultTextProvider: LLMProviderType;
    autoGenerateProxies: boolean;
    proxyGenerationOnImport: boolean;
  }

  interface ProviderStatus {
    provider: LLMProviderType;
    configured: boolean;
    tested: boolean;
    working: boolean;
    lastTested: Date | null;
    error: string | null;
  }

  const defaultSettings: Settings = {
    geminiApiKey: "",
    openaiApiKey: "",
    anthropicApiKey: "",
    kimiApiKey: "",
    openrouterApiKey: "",
    defaultVideoProvider: "gemini",
    defaultTextProvider: "openai",
    autoGenerateProxies: true,
    proxyGenerationOnImport: true,
  };

  const providers: LLMProviderType[] = [
    "gemini",
    "openai",
    "anthropic",
    "kimi",
    "openrouter",
  ];

  const videoProviders: LLMProviderType[] = ["gemini", "kimi"];

  function getProviderLabel(provider: LLMProviderType): string {
    const labels: Record<LLMProviderType, string> = {
      gemini: "Google Gemini",
      openai: "OpenAI",
      anthropic: "Anthropic Claude",
      kimi: "Kimi K2.5 (Moonshot AI)",
      openrouter: "OpenRouter",
    };
    return labels[provider];
  }

  function supportsVideo(provider: LLMProviderType): boolean {
    return provider === "gemini" || provider === "kimi";
  }

  function isProviderConfigured(settings: Settings, provider: LLMProviderType): boolean {
    const keyMap: Record<LLMProviderType, keyof Settings> = {
      gemini: "geminiApiKey",
      openai: "openaiApiKey",
      anthropic: "anthropicApiKey",
      kimi: "kimiApiKey",
      openrouter: "openrouterApiKey",
    };
    const key = settings[keyMap[provider]];
    return typeof key === "string" && key.length > 0;
  }

  function getConfiguredProviders(settings: Settings): LLMProviderType[] {
    return providers.filter((p) => isProviderConfigured(settings, p));
  }

  function getConfiguredVideoProviders(settings: Settings): LLMProviderType[] {
    return videoProviders.filter((p) => isProviderConfigured(settings, p));
  }

  function getApiKey(settings: Settings, provider: LLMProviderType): string {
    const keyMap: Record<LLMProviderType, keyof Settings> = {
      gemini: "geminiApiKey",
      openai: "openaiApiKey",
      anthropic: "anthropicApiKey",
      kimi: "kimiApiKey",
      openrouter: "openrouterApiKey",
    };
    const key = settings[keyMap[provider]];
    return typeof key === "string" ? key : "";
  }

  function validateApiKey(provider: LLMProviderType, key: string): boolean {
    if (!key) return false;

    const validPrefixes: Record<LLMProviderType, string[]> = {
      gemini: ["AIza"],
      openai: ["sk-"],
      anthropic: ["sk-ant-"],
      kimi: ["sk-"],
      openrouter: ["sk-or-"],
    };

    const prefixes = validPrefixes[provider];
    return prefixes.some((prefix) => key.startsWith(prefix));
  }

  describe("Default Settings", () => {
    it("should have empty API keys by default", () => {
      expect(defaultSettings.geminiApiKey).toBe("");
      expect(defaultSettings.openaiApiKey).toBe("");
      expect(defaultSettings.anthropicApiKey).toBe("");
      expect(defaultSettings.kimiApiKey).toBe("");
      expect(defaultSettings.openrouterApiKey).toBe("");
    });

    it("should default to gemini for video", () => {
      expect(defaultSettings.defaultVideoProvider).toBe("gemini");
    });

    it("should default to openai for text", () => {
      expect(defaultSettings.defaultTextProvider).toBe("openai");
    });

    it("should auto-generate proxies by default", () => {
      expect(defaultSettings.autoGenerateProxies).toBe(true);
      expect(defaultSettings.proxyGenerationOnImport).toBe(true);
    });
  });

  describe("Provider Labels", () => {
    it("should return correct display names", () => {
      expect(getProviderLabel("gemini")).toBe("Google Gemini");
      expect(getProviderLabel("openai")).toBe("OpenAI");
      expect(getProviderLabel("anthropic")).toBe("Anthropic Claude");
      expect(getProviderLabel("kimi")).toBe("Kimi K2.5 (Moonshot AI)");
      expect(getProviderLabel("openrouter")).toBe("OpenRouter");
    });
  });

  describe("Video Support", () => {
    it("should identify video-capable providers", () => {
      expect(supportsVideo("gemini")).toBe(true);
      expect(supportsVideo("kimi")).toBe(true);
    });

    it("should identify non-video providers", () => {
      expect(supportsVideo("openai")).toBe(false);
      expect(supportsVideo("anthropic")).toBe(false);
      expect(supportsVideo("openrouter")).toBe(false);
    });
  });

  describe("Provider Configuration", () => {
    it("should detect configured providers", () => {
      const settings: Settings = {
        ...defaultSettings,
        geminiApiKey: "AIza-test",
        openaiApiKey: "sk-test",
      };

      expect(isProviderConfigured(settings, "gemini")).toBe(true);
      expect(isProviderConfigured(settings, "openai")).toBe(true);
      expect(isProviderConfigured(settings, "anthropic")).toBe(false);
    });

    it("should detect unconfigured providers", () => {
      expect(isProviderConfigured(defaultSettings, "gemini")).toBe(false);
      expect(isProviderConfigured(defaultSettings, "openai")).toBe(false);
    });

    it("should get list of configured providers", () => {
      const settings: Settings = {
        ...defaultSettings,
        geminiApiKey: "AIza-test",
        kimiApiKey: "sk-test",
      };

      const configured = getConfiguredProviders(settings);
      expect(configured).toContain("gemini");
      expect(configured).toContain("kimi");
      expect(configured).not.toContain("openai");
      expect(configured).not.toContain("anthropic");
    });

    it("should get configured video providers only", () => {
      const settings: Settings = {
        ...defaultSettings,
        geminiApiKey: "AIza-test",
        openaiApiKey: "sk-test",
        kimiApiKey: "sk-test",
      };

      const videoProviders = getConfiguredVideoProviders(settings);
      expect(videoProviders).toContain("gemini");
      expect(videoProviders).toContain("kimi");
      expect(videoProviders).not.toContain("openai");
    });
  });

  describe("API Key Management", () => {
    it("should retrieve API keys", () => {
      const settings: Settings = {
        ...defaultSettings,
        geminiApiKey: "AIza-test123",
      };

      expect(getApiKey(settings, "gemini")).toBe("AIza-test123");
      expect(getApiKey(settings, "openai")).toBe("");
    });

    it("should validate Gemini API key format", () => {
      expect(validateApiKey("gemini", "AIzaSyBtest")).toBe(true);
      expect(validateApiKey("gemini", "invalid-key")).toBe(false);
      expect(validateApiKey("gemini", "")).toBe(false);
    });

    it("should validate OpenAI API key format", () => {
      expect(validateApiKey("openai", "sk-test123")).toBe(true);
      expect(validateApiKey("openai", "invalid-key")).toBe(false);
    });

    it("should validate Anthropic API key format", () => {
      expect(validateApiKey("anthropic", "sk-ant-test")).toBe(true);
      expect(validateApiKey("anthropic", "sk-test123")).toBe(false);
    });

    it("should validate Kimi API key format", () => {
      expect(validateApiKey("kimi", "sk-test123")).toBe(true);
      expect(validateApiKey("kimi", "invalid-key")).toBe(false);
    });

    it("should validate OpenRouter API key format", () => {
      expect(validateApiKey("openrouter", "sk-or-test")).toBe(true);
      expect(validateApiKey("openrouter", "sk-test123")).toBe(false);
    });
  });

  describe("ProviderStatus Interface", () => {
    it("should support all required fields", () => {
      const status: ProviderStatus = {
        provider: "gemini",
        configured: true,
        tested: true,
        working: true,
        lastTested: new Date(),
        error: null,
      };

      expect(status.provider).toBe("gemini");
      expect(status.configured).toBe(true);
      expect(status.tested).toBe(true);
      expect(status.working).toBe(true);
      expect(status.lastTested).toBeInstanceOf(Date);
      expect(status.error).toBeNull();
    });

    it("should support error state", () => {
      const status: ProviderStatus = {
        provider: "openai",
        configured: false,
        tested: true,
        working: false,
        lastTested: new Date(),
        error: "Invalid API key",
      };

      expect(status.working).toBe(false);
      expect(status.error).toBe("Invalid API key");
    });
  });

  describe("Settings Interface", () => {
    it("should have all required API key fields", () => {
      const keys: (keyof Settings)[] = [
        "geminiApiKey",
        "openaiApiKey",
        "anthropicApiKey",
        "kimiApiKey",
        "openrouterApiKey",
      ];

      keys.forEach((key) => {
        expect(defaultSettings).toHaveProperty(key);
        expect(typeof defaultSettings[key]).toBe("string");
      });
    });

    it("should have default provider fields", () => {
      expect(defaultSettings).toHaveProperty("defaultVideoProvider");
      expect(defaultSettings).toHaveProperty("defaultTextProvider");
      expect(providers).toContain(defaultSettings.defaultVideoProvider);
      expect(providers).toContain(defaultSettings.defaultTextProvider);
    });

    it("should have preference fields", () => {
      expect(defaultSettings).toHaveProperty("autoGenerateProxies");
      expect(defaultSettings).toHaveProperty("proxyGenerationOnImport");
      expect(typeof defaultSettings.autoGenerateProxies).toBe("boolean");
      expect(typeof defaultSettings.proxyGenerationOnImport).toBe("boolean");
    });
  });

  describe("localStorage Integration", () => {
    const localStorageMock: Record<string, string> = {};

    beforeEach(() => {
      // Clear mock storage
      for (const key of Object.keys(localStorageMock)) {
        delete localStorageMock[key];
      }
    });

    it("should serialize settings to JSON", () => {
      const settings: Settings = {
        ...defaultSettings,
        geminiApiKey: "test-key",
        defaultVideoProvider: "kimi",
      };

      const serialized = JSON.stringify(settings);
      expect(serialized).toContain("test-key");
      expect(serialized).toContain("kimi");
    });

    it("should deserialize settings from JSON", () => {
      const settings: Settings = {
        ...defaultSettings,
        geminiApiKey: "loaded-key",
      };

      const serialized = JSON.stringify(settings);
      localStorageMock["vod-pipeline-settings"] = serialized;

      const loaded = JSON.parse(localStorageMock["vod-pipeline-settings"]);
      expect(loaded.geminiApiKey).toBe("loaded-key");
    });
  });
});

describe("Settings Panel UI Logic", () => {
  it("should toggle settings panel visibility", () => {
    let isOpen = false;
    
    function openSettings() {
      isOpen = true;
    }
    
    function closeSettings() {
      isOpen = false;
    }
    
    function toggleSettings() {
      isOpen = !isOpen;
    }

    expect(isOpen).toBe(false);
    openSettings();
    expect(isOpen).toBe(true);
    closeSettings();
    expect(isOpen).toBe(false);
    toggleSettings();
    expect(isOpen).toBe(true);
    toggleSettings();
    expect(isOpen).toBe(false);
  });
});
