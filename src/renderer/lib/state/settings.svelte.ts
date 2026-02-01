/**
 * Settings State Management
 * Handles AI provider API keys and application preferences
 */

export type LLMProviderType = "openai" | "gemini" | "anthropic" | "openrouter" | "kimi";

export interface Settings {
  // API Keys (encrypted before storage)
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  kimiApiKey: string;
  openrouterApiKey: string;

  // Default provider selection
  defaultVideoProvider: LLMProviderType;
  defaultTextProvider: LLMProviderType;

  // Application preferences
  autoGenerateProxies: boolean;
  proxyGenerationOnImport: boolean;
}

export interface ProviderStatus {
  provider: LLMProviderType;
  configured: boolean;
  tested: boolean;
  working: boolean;
  lastTested: Date | null;
  error: string | null;
}

// Create settings state
export const settingsState = $state<{
  settings: Settings;
  providerStatuses: Map<LLMProviderType, ProviderStatus>;
  isLoading: boolean;
  error: string | null;
  isSettingsOpen: boolean;
}>({
  settings: {
    geminiApiKey: "",
    openaiApiKey: "",
    anthropicApiKey: "",
    kimiApiKey: "",
    openrouterApiKey: "",
    defaultVideoProvider: "gemini",
    defaultTextProvider: "openai",
    autoGenerateProxies: true,
    proxyGenerationOnImport: true,
  },
  providerStatuses: new Map(),
  isLoading: false,
  error: null,
  isSettingsOpen: false,
});

const SETTINGS_STORAGE_KEY = "vod-pipeline-settings";

/**
 * Load settings from localStorage (with encrypted API keys)
 */
export async function loadSettings(): Promise<void> {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return;

    const parsed = JSON.parse(stored);

    // Load non-encrypted settings
    if (parsed.defaultVideoProvider) {
      settingsState.settings.defaultVideoProvider = parsed.defaultVideoProvider;
    }
    if (parsed.defaultTextProvider) {
      settingsState.settings.defaultTextProvider = parsed.defaultTextProvider;
    }
    if (parsed.autoGenerateProxies !== undefined) {
      settingsState.settings.autoGenerateProxies = parsed.autoGenerateProxies;
    }
    if (parsed.proxyGenerationOnImport !== undefined) {
      settingsState.settings.proxyGenerationOnImport = parsed.proxyGenerationOnImport;
    }

    // Decrypt API keys if present
    if (parsed._encryptedKeys) {
      const response = await window.electronAPI.settings.decrypt(parsed._encryptedKeys);
      if (response.success && response.data) {
        const keys = JSON.parse(response.data);
        settingsState.settings.geminiApiKey = keys.geminiApiKey || "";
        settingsState.settings.openaiApiKey = keys.openaiApiKey || "";
        settingsState.settings.anthropicApiKey = keys.anthropicApiKey || "";
        settingsState.settings.kimiApiKey = keys.kimiApiKey || "";
        settingsState.settings.openrouterApiKey = keys.openrouterApiKey || "";
      } else {
        throw new Error(response.error || "Failed to decrypt API keys");
      }
    }
    // Backwards compatibility: if no encrypted keys but plaintext keys exist, migrate them
    else if (parsed.geminiApiKey !== undefined) {
      settingsState.settings.geminiApiKey = parsed.geminiApiKey || "";
      settingsState.settings.openaiApiKey = parsed.openaiApiKey || "";
      settingsState.settings.anthropicApiKey = parsed.anthropicApiKey || "";
      settingsState.settings.kimiApiKey = parsed.kimiApiKey || "";
      settingsState.settings.openrouterApiKey = parsed.openrouterApiKey || "";
      // Migrate to encrypted storage on next save
      await saveSettings();
    }

    settingsState.error = null;
  } catch (error) {
    console.error("[Settings] Failed to load settings:", error);
    settingsState.error = "Failed to load settings";
  }
}

/**
 * Save settings to localStorage (with encrypted API keys)
 */
export async function saveSettings(): Promise<void> {
  try {
    // Encrypt API keys
    const keysToEncrypt = {
      geminiApiKey: settingsState.settings.geminiApiKey,
      openaiApiKey: settingsState.settings.openaiApiKey,
      anthropicApiKey: settingsState.settings.anthropicApiKey,
      kimiApiKey: settingsState.settings.kimiApiKey,
      openrouterApiKey: settingsState.settings.openrouterApiKey,
    };

    const response = await window.electronAPI.settings.encrypt(JSON.stringify(keysToEncrypt));
    if (!response.success) {
      throw new Error(response.error || "Failed to encrypt API keys");
    }

    const dataToStore = {
      defaultVideoProvider: settingsState.settings.defaultVideoProvider,
      defaultTextProvider: settingsState.settings.defaultTextProvider,
      autoGenerateProxies: settingsState.settings.autoGenerateProxies,
      proxyGenerationOnImport: settingsState.settings.proxyGenerationOnImport,
      _encryptedKeys: response.data,
    };

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(dataToStore));
    settingsState.error = null;
  } catch (error) {
    console.error("[Settings] Failed to save settings:", error);
    settingsState.error = "Failed to save settings";
    throw error; // Re-throw to allow caller to handle
  }
}

/**
 * Update a specific setting value
 */
export async function updateSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K]
): Promise<void> {
  settingsState.settings[key] = value;
  await saveSettings();
}

/**
 * Update API key for a provider
 */
export async function updateApiKey(provider: LLMProviderType, apiKey: string): Promise<void> {
  // Use switch statement for type-safe assignment
  switch (provider) {
    case "gemini":
      settingsState.settings.geminiApiKey = apiKey;
      break;
    case "openai":
      settingsState.settings.openaiApiKey = apiKey;
      break;
    case "anthropic":
      settingsState.settings.anthropicApiKey = apiKey;
      break;
    case "kimi":
      settingsState.settings.kimiApiKey = apiKey;
      break;
    case "openrouter":
      settingsState.settings.openrouterApiKey = apiKey;
      break;
  }
  
  // Update provider status
  const status = settingsState.providerStatuses.get(provider) || {
    provider,
    configured: false,
    tested: false,
    working: false,
    lastTested: null,
    error: null,
  };
  status.configured = apiKey.length > 0;
  settingsState.providerStatuses.set(provider, status);
  
  await saveSettings();
}

/**
 * Get API key for a provider
 */
export function getApiKey(provider: LLMProviderType): string {
  switch (provider) {
    case "gemini":
      return settingsState.settings.geminiApiKey || "";
    case "openai":
      return settingsState.settings.openaiApiKey || "";
    case "anthropic":
      return settingsState.settings.anthropicApiKey || "";
    case "kimi":
      return settingsState.settings.kimiApiKey || "";
    case "openrouter":
      return settingsState.settings.openrouterApiKey || "";
    default:
      return "";
  }
}

/**
 * Check if a provider has a configured API key
 */
export function isProviderConfigured(provider: LLMProviderType): boolean {
  return getApiKey(provider).length > 0;
}

/**
 * Get list of configured providers
 */
export function getConfiguredProviders(): LLMProviderType[] {
  const providers: LLMProviderType[] = [
    "gemini",
    "openai",
    "anthropic",
    "kimi",
    "openrouter",
  ];
  return providers.filter(isProviderConfigured);
}

/**
 * Get video-capable providers that are configured
 */
export function getConfiguredVideoProviders(): LLMProviderType[] {
  const videoProviders: LLMProviderType[] = ["gemini", "kimi"];
  return videoProviders.filter(isProviderConfigured);
}

/**
 * Test a provider's API key (mock implementation)
 * In production, this would make an actual API call to validate the key
 */
export async function testProvider(provider: LLMProviderType): Promise<boolean> {
  const apiKey = getApiKey(provider);
  
  const status: ProviderStatus = {
    provider,
    configured: apiKey.length > 0,
    tested: true,
    working: false,
    lastTested: new Date(),
    error: null,
  };

  if (!apiKey) {
    status.error = "No API key configured";
    settingsState.providerStatuses.set(provider, status);
    return false;
  }

  // Mock validation - in production, make actual API call
  // For now, just check if key looks valid (starts with expected prefix)
  const validPrefixes: Record<LLMProviderType, string[]> = {
    gemini: ["AIza"],
    openai: ["sk-"],
    anthropic: ["sk-ant-"],
    kimi: ["sk-"],
    openrouter: ["sk-or-"],
  };

  const prefixes = validPrefixes[provider];
  const isValidFormat = prefixes.some((prefix) => apiKey.startsWith(prefix));

  if (!isValidFormat) {
    status.error = `Invalid API key format. Should start with: ${prefixes.join(" or ")}`;
    settingsState.providerStatuses.set(provider, status);
    return false;
  }

  // Simulate API test delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  status.working = true;
  settingsState.providerStatuses.set(provider, status);
  return true;
}

/**
 * Open settings panel
 */
export async function openSettings(): Promise<void> {
  settingsState.isSettingsOpen = true;
  await loadSettings();
}

/**
 * Close settings panel
 */
export function closeSettings(): void {
  settingsState.isSettingsOpen = false;
}

/**
 * Toggle settings panel
 */
export async function toggleSettings(): Promise<void> {
  settingsState.isSettingsOpen = !settingsState.isSettingsOpen;
  if (settingsState.isSettingsOpen) {
    await loadSettings();
  }
}

/**
 * Get provider display name
 */
export function getProviderLabel(provider: LLMProviderType): string {
  const labels: Record<LLMProviderType, string> = {
    gemini: "Google Gemini",
    openai: "OpenAI",
    anthropic: "Anthropic Claude",
    kimi: "Kimi K2.5 (Moonshot AI)",
    openrouter: "OpenRouter",
  };
  return labels[provider];
}

/**
 * Check if provider supports video
 */
export function supportsVideo(provider: LLMProviderType): boolean {
  return provider === "gemini" || provider === "kimi";
}

/**
 * Reset all settings to defaults
 */
export async function resetSettings(): Promise<void> {
  settingsState.settings = {
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
  settingsState.providerStatuses.clear();
  await saveSettings();
}
