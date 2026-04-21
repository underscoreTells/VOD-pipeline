import type {
  LLMProviderType,
  Settings,
} from './settings.svelte.js';

const PROVIDER_KEY_MAP: Record<LLMProviderType, keyof Settings> = {
  gemini: 'geminiApiKey',
  openai: 'openaiApiKey',
  anthropic: 'anthropicApiKey',
  kimi: 'kimiApiKey',
  openrouter: 'openrouterApiKey',
};

const VALID_PREFIXES: Record<LLMProviderType, string[]> = {
  gemini: ['AIza'],
  openai: ['sk-'],
  anthropic: ['sk-ant-'],
  kimi: ['sk-'],
  openrouter: ['sk-or-'],
};

export const providerOrder: LLMProviderType[] = [
  'gemini',
  'openai',
  'anthropic',
  'kimi',
  'openrouter',
];

export const videoProviderOrder: LLMProviderType[] = ['gemini', 'kimi'];

export const defaultSettings: Settings = {
  geminiApiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  kimiApiKey: '',
  openrouterApiKey: '',
  defaultVideoProvider: 'gemini',
  defaultTextProvider: 'openai',
  autoGenerateProxies: true,
  proxyGenerationOnImport: true,
  proxyEncodingMode: 'auto',
  proxyQuality: 'balanced',
  autoChapterNamingEnabled: true,
  autoChapterNamingModel: 'gpt-4o-mini',
  autoClipNamingEnabled: true,
  autoClipNamingModel: 'gpt-5-nano',
  autoTranscribeOnImport: true,
};

export function getProviderLabel(provider: LLMProviderType): string {
  const labels: Record<LLMProviderType, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic Claude',
    kimi: 'Kimi K2.5 (Moonshot AI)',
    openrouter: 'OpenRouter',
  };

  return labels[provider];
}

export function supportsVideo(provider: LLMProviderType): boolean {
  return provider === 'gemini' || provider === 'kimi';
}

export function getApiKey(settings: Settings, provider: LLMProviderType): string {
  const key = settings[PROVIDER_KEY_MAP[provider]];
  return typeof key === 'string' ? key : '';
}

export function isProviderConfigured(settings: Settings, provider: LLMProviderType): boolean {
  return getApiKey(settings, provider).length > 0;
}

export function getConfiguredProviders(settings: Settings): LLMProviderType[] {
  return providerOrder.filter((provider) => isProviderConfigured(settings, provider));
}

export function getConfiguredVideoProviders(settings: Settings): LLMProviderType[] {
  return videoProviderOrder.filter((provider) => isProviderConfigured(settings, provider));
}

export function validateApiKey(provider: LLMProviderType, key: string): boolean {
  if (!key) {
    return false;
  }

  return VALID_PREFIXES[provider].some((prefix) => key.startsWith(prefix));
}
