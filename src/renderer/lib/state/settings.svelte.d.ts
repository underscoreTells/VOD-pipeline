/**
 * Settings State Management
 * Handles AI provider API keys and application preferences
 */
export type LLMProviderType = "openai" | "gemini" | "anthropic" | "openrouter" | "kimi";
export interface Settings {
    geminiApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    kimiApiKey: string;
    openrouterApiKey: string;
    defaultVideoProvider: LLMProviderType;
    defaultTextProvider: LLMProviderType;
    autoGenerateProxies: boolean;
    proxyGenerationOnImport: boolean;
    proxyEncodingMode: 'cpu' | 'gpu' | 'auto';
    proxyQuality: 'high' | 'balanced' | 'fast';
    autoChapterNamingEnabled: boolean;
    autoChapterNamingModel: string;
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
export declare const settingsState: {
    settings: Settings;
    providerStatuses: Map<LLMProviderType, ProviderStatus>;
    isLoading: boolean;
    error: string | null;
    isSettingsOpen: boolean;
};
/**
 * Load settings from localStorage (with encrypted API keys)
 */
export declare function loadSettings(): Promise<void>;
/**
 * Save settings to localStorage (with encrypted API keys)
 */
export declare function saveSettings(): Promise<void>;
/**
 * Update a specific setting value
 */
export declare function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
/**
 * Update API key for a provider
 */
export declare function updateApiKey(provider: LLMProviderType, apiKey: string): Promise<void>;
/**
 * Get API key for a provider
 */
export declare function getApiKey(provider: LLMProviderType): string;
/**
 * Check if a provider has a configured API key
 */
export declare function isProviderConfigured(provider: LLMProviderType): boolean;
/**
 * Get list of configured providers
 */
export declare function getConfiguredProviders(): LLMProviderType[];
/**
 * Get video-capable providers that are configured
 */
export declare function getConfiguredVideoProviders(): LLMProviderType[];
/**
 * Test a provider's API key (mock implementation)
 * In production, this would make an actual API call to validate the key
 */
export declare function testProvider(provider: LLMProviderType): Promise<boolean>;
/**
 * Open settings panel
 */
export declare function openSettings(): Promise<void>;
/**
 * Close settings panel
 */
export declare function closeSettings(): void;
/**
 * Toggle settings panel
 */
export declare function toggleSettings(): Promise<void>;
/**
 * Get provider display name
 */
export declare function getProviderLabel(provider: LLMProviderType): string;
/**
 * Check if provider supports video
 */
export declare function supportsVideo(provider: LLMProviderType): boolean;
/**
 * Reset all settings to defaults
 */
export declare function resetSettings(): Promise<void>;
