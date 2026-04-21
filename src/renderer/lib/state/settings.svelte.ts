import { decryptSettings, encryptSettings } from '../api/settings.js';
import {
  defaultSettings,
  getApiKey as getSettingsApiKey,
  getConfiguredProviders as getConfiguredProvidersFromSettings,
  getConfiguredVideoProviders as getConfiguredVideoProvidersFromSettings,
  getProviderLabel as getSettingsProviderLabel,
  isProviderConfigured as isProviderConfiguredInSettings,
  supportsVideo as providerSupportsVideo,
  validateApiKey,
} from './settings-helpers.js';

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
  proxyEncodingMode: 'cpu' | 'gpu' | 'auto'; // CPU quality, GPU speed, or auto-detect
  proxyQuality: 'high' | 'balanced' | 'fast'; // Quality vs speed tradeoff

  // Chapter auto-naming preferences
  autoChapterNamingEnabled: boolean;
  autoChapterNamingModel: string;

  // Clip auto-naming preferences
  autoClipNamingEnabled: boolean;
  autoClipNamingModel: string;

  autoTranscribeOnImport: boolean;
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
  settings: { ...defaultSettings },
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
    if (parsed.proxyEncodingMode !== undefined) {
      settingsState.settings.proxyEncodingMode = parsed.proxyEncodingMode;
    }
    if (parsed.proxyQuality !== undefined) {
      settingsState.settings.proxyQuality = parsed.proxyQuality;
    }
    if (parsed.autoChapterNamingEnabled !== undefined) {
      settingsState.settings.autoChapterNamingEnabled = parsed.autoChapterNamingEnabled;
    }
    if (parsed.autoChapterNamingModel) {
      settingsState.settings.autoChapterNamingModel = parsed.autoChapterNamingModel;
    }
    if (parsed.autoClipNamingEnabled !== undefined) {
      settingsState.settings.autoClipNamingEnabled = parsed.autoClipNamingEnabled;
    }
    if (parsed.autoClipNamingModel) {
      settingsState.settings.autoClipNamingModel = parsed.autoClipNamingModel;
    }
    if (parsed.autoTranscribeOnImport !== undefined) {
      settingsState.settings.autoTranscribeOnImport = parsed.autoTranscribeOnImport;
    }

    // Decrypt API keys if present
    if (parsed._encryptedKeys) {
      const response = await decryptSettings(parsed._encryptedKeys);
      if (!response.success) {
        throw new Error(response.error || "Failed to decrypt API keys");
      }
      if (!response.data) {
        throw new Error("Decryption succeeded but no data returned");
      }
      const keys = JSON.parse(response.data);
      settingsState.settings.geminiApiKey = keys.geminiApiKey || "";
      settingsState.settings.openaiApiKey = keys.openaiApiKey || "";
      settingsState.settings.anthropicApiKey = keys.anthropicApiKey || "";
      settingsState.settings.kimiApiKey = keys.kimiApiKey || "";
      settingsState.settings.openrouterApiKey = keys.openrouterApiKey || "";
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

    const response = await encryptSettings(JSON.stringify(keysToEncrypt));
    if (!response.success) {
      throw new Error(response.error || "Failed to encrypt API keys");
    }

    const dataToStore = {
      defaultVideoProvider: settingsState.settings.defaultVideoProvider,
      defaultTextProvider: settingsState.settings.defaultTextProvider,
      autoGenerateProxies: settingsState.settings.autoGenerateProxies,
      proxyGenerationOnImport: settingsState.settings.proxyGenerationOnImport,
      proxyEncodingMode: settingsState.settings.proxyEncodingMode,
      proxyQuality: settingsState.settings.proxyQuality,
      autoChapterNamingEnabled: settingsState.settings.autoChapterNamingEnabled,
      autoChapterNamingModel: settingsState.settings.autoChapterNamingModel,
      autoClipNamingEnabled: settingsState.settings.autoClipNamingEnabled,
      autoClipNamingModel: settingsState.settings.autoClipNamingModel,
      autoTranscribeOnImport: settingsState.settings.autoTranscribeOnImport,
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
  return getSettingsApiKey(settingsState.settings, provider);
}

/**
 * Check if a provider has a configured API key
 */
export function isProviderConfigured(provider: LLMProviderType): boolean {
  return isProviderConfiguredInSettings(settingsState.settings, provider);
}

/**
 * Get list of configured providers
 */
export function getConfiguredProviders(): LLMProviderType[] {
  return getConfiguredProvidersFromSettings(settingsState.settings);
}

/**
 * Get video-capable providers that are configured
 */
export function getConfiguredVideoProviders(): LLMProviderType[] {
  return getConfiguredVideoProvidersFromSettings(settingsState.settings);
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
  const isValidFormat = validateApiKey(provider, apiKey);

  if (!isValidFormat) {
    const prefixes = {
      gemini: ["AIza"],
      openai: ["sk-"],
      anthropic: ["sk-ant-"],
      kimi: ["sk-"],
      openrouter: ["sk-or-"],
    }[provider];
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
  return getSettingsProviderLabel(provider);
}

/**
 * Check if provider supports video
 */
export function supportsVideo(provider: LLMProviderType): boolean {
  return providerSupportsVideo(provider);
}

/**
 * Reset all settings to defaults
 */
export async function resetSettings(): Promise<void> {
  settingsState.settings = { ...defaultSettings };
  settingsState.providerStatuses.clear();
  await saveSettings();
}
