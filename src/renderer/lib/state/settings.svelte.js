/**
 * Settings State Management
 * Handles AI provider API keys and application preferences
 */
// Create settings state
export const settingsState = $state({
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
        proxyEncodingMode: 'auto', // Auto-detect GPU, fallback to CPU
        proxyQuality: 'balanced', // Balanced quality/speed
        autoChapterNamingEnabled: true,
        autoChapterNamingModel: "gpt-4o-mini",
        autoTranscribeOnImport: true,
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
export async function loadSettings() {
    try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!stored)
            return;
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
        if (parsed.autoTranscribeOnImport !== undefined) {
            settingsState.settings.autoTranscribeOnImport = parsed.autoTranscribeOnImport;
        }
        // Decrypt API keys if present
        if (parsed._encryptedKeys) {
            const response = await window.electronAPI.settings.decrypt(parsed._encryptedKeys);
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
    }
    catch (error) {
        console.error("[Settings] Failed to load settings:", error);
        settingsState.error = "Failed to load settings";
    }
}
/**
 * Save settings to localStorage (with encrypted API keys)
 */
export async function saveSettings() {
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
            proxyEncodingMode: settingsState.settings.proxyEncodingMode,
            proxyQuality: settingsState.settings.proxyQuality,
            autoChapterNamingEnabled: settingsState.settings.autoChapterNamingEnabled,
            autoChapterNamingModel: settingsState.settings.autoChapterNamingModel,
            autoTranscribeOnImport: settingsState.settings.autoTranscribeOnImport,
            _encryptedKeys: response.data,
        };
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(dataToStore));
        settingsState.error = null;
    }
    catch (error) {
        console.error("[Settings] Failed to save settings:", error);
        settingsState.error = "Failed to save settings";
        throw error; // Re-throw to allow caller to handle
    }
}
/**
 * Update a specific setting value
 */
export async function updateSetting(key, value) {
    settingsState.settings[key] = value;
    await saveSettings();
}
/**
 * Update API key for a provider
 */
export async function updateApiKey(provider, apiKey) {
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
export function getApiKey(provider) {
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
export function isProviderConfigured(provider) {
    return getApiKey(provider).length > 0;
}
/**
 * Get list of configured providers
 */
export function getConfiguredProviders() {
    const providers = [
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
export function getConfiguredVideoProviders() {
    const videoProviders = ["gemini", "kimi"];
    return videoProviders.filter(isProviderConfigured);
}
/**
 * Test a provider's API key (mock implementation)
 * In production, this would make an actual API call to validate the key
 */
export async function testProvider(provider) {
    const apiKey = getApiKey(provider);
    const status = {
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
    const validPrefixes = {
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
export async function openSettings() {
    settingsState.isSettingsOpen = true;
    await loadSettings();
}
/**
 * Close settings panel
 */
export function closeSettings() {
    settingsState.isSettingsOpen = false;
}
/**
 * Toggle settings panel
 */
export async function toggleSettings() {
    settingsState.isSettingsOpen = !settingsState.isSettingsOpen;
    if (settingsState.isSettingsOpen) {
        await loadSettings();
    }
}
/**
 * Get provider display name
 */
export function getProviderLabel(provider) {
    const labels = {
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
export function supportsVideo(provider) {
    return provider === "gemini" || provider === "kimi";
}
/**
 * Reset all settings to defaults
 */
export async function resetSettings() {
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
        proxyEncodingMode: 'auto',
        proxyQuality: 'balanced',
        autoChapterNamingEnabled: true,
        autoChapterNamingModel: "gpt-4o-mini",
        autoTranscribeOnImport: true,
    };
    settingsState.providerStatuses.clear();
    await saveSettings();
}
