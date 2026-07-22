import type {
  ProxyOptions,
  ProviderConfigPayload,
  ProviderConfigProvider,
} from '../../../shared/contracts/electron-api.js';
import {
  DEFAULT_NAMING_MODEL,
  getNamingModelProvider,
  normalizeNamingModel,
  type NamingModelId,
} from '../../../shared/llm/naming-models.js';
import {
  PROVIDER_IDS,
  VIDEO_CAPABLE_PROVIDERS,
  getProviderModelContextTokenLimit,
  getProviderLabel as getRegistryProviderLabel,
  providerSupportsVideo,
  validateProviderApiKey,
} from '../../../shared/llm/provider-registry.js';
import type {
  LLMProviderType,
  Settings,
} from './settings.svelte.js';

export const PROVIDER_KEY_MAP: Partial<Record<LLMProviderType, keyof Settings>> = {
  gemini: 'geminiApiKey',
  openai: 'openaiApiKey',
  anthropic: 'anthropicApiKey',
  kimi: 'kimiApiKey',
  openrouter: 'openrouterApiKey',
  kimiCode: 'kimiCodeApiKey',
};

export const providerOrder: LLMProviderType[] = PROVIDER_IDS;

export const videoProviderOrder: LLMProviderType[] = VIDEO_CAPABLE_PROVIDERS;

export const defaultSettings: Settings = {
  geminiApiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  kimiApiKey: '',
  openrouterApiKey: '',
  kimiCodeApiKey: '',
  providerModels: {},
  kimiBaseURL: 'https://api.moonshot.ai/v1',
  openAICompatibleProfiles: [],
  activeOpenAICompatibleProfileId: null,
  defaultVideoProvider: 'gemini',
  defaultTextProvider: 'openai',
  autoGenerateProxies: true,
  proxyGenerationOnImport: true,
  proxyEncodingMode: 'auto',
  proxyQuality: 'balanced',
  autoChapterNamingEnabled: true,
  autoChapterNamingModel: DEFAULT_NAMING_MODEL,
  autoClipNamingEnabled: true,
  autoClipNamingModel: DEFAULT_NAMING_MODEL,
  autoThreadNamingModel: DEFAULT_NAMING_MODEL,
  autoTranscribeOnImport: true,
};

export function buildProxyOptions(
  settings: Pick<Settings, 'proxyEncodingMode' | 'proxyQuality'>
): Required<ProxyOptions> {
  return {
    encodingMode: settings.proxyEncodingMode,
    quality: settings.proxyQuality,
  };
}

export function getProviderLabel(provider: LLMProviderType): string {
  return getRegistryProviderLabel(provider);
}

export function supportsVideo(provider: LLMProviderType): boolean {
  return providerSupportsVideo(provider);
}

export function getApiKey(settings: Settings, provider: LLMProviderType): string {
  if (provider === 'openaiCompatible') {
    return (settings.openAICompatibleProfiles ?? []).find(
      (profile) => profile.id === settings.activeOpenAICompatibleProfileId
    )?.apiKey ?? '';
  }
  const settingKey = PROVIDER_KEY_MAP[provider];
  if (!settingKey) return '';
  const key = settings[settingKey];
  return typeof key === 'string' ? key : '';
}

export function isProviderConfigured(settings: Settings, provider: LLMProviderType): boolean {
  if (provider === 'openaiCompatible') {
    const profile = (settings.openAICompatibleProfiles ?? []).find(
      (candidate) => candidate.id === settings.activeOpenAICompatibleProfileId
    );
    return Boolean(profile?.baseURL.trim() && profile.model.trim());
  }
  return getApiKey(settings, provider).length > 0;
}

export function getConfiguredProviders(settings: Settings): LLMProviderType[] {
  return providerOrder.filter((provider) => isProviderConfigured(settings, provider));
}

export function getConfiguredVideoProviders(settings: Settings): LLMProviderType[] {
  return videoProviderOrder.filter((provider) => isProviderConfigured(settings, provider));
}

export function buildProviderConfig(
  settings: Settings,
  defaultProvider?: LLMProviderType
): ProviderConfigPayload {
  const providers: ProviderConfigPayload['providers'] = {};

  for (const provider of providerOrder) {
    const apiKey = getApiKey(settings, provider);
    if (apiKey || (provider === 'openaiCompatible' && isProviderConfigured(settings, provider))) {
      providers[provider] = apiKey || 'not-required';
    }
  }

  const profiles = settings.openAICompatibleProfiles ?? [];
  const activeProfile = profiles.find(
    (profile) => profile.id === settings.activeOpenAICompatibleProfileId
  );
  const models = {
    ...(settings.providerModels ?? {}),
    ...(activeProfile ? { openaiCompatible: activeProfile.model } : {}),
  };
  const baseURLs = {
    ...(settings.kimiBaseURL && settings.kimiBaseURL !== defaultSettings.kimiBaseURL
      ? { kimi: settings.kimiBaseURL }
      : {}),
    ...(activeProfile ? { openaiCompatible: activeProfile.baseURL } : {}),
  };
  const contextTokenLimits: NonNullable<ProviderConfigPayload['contextTokenLimits']> = {};
  for (const provider of providerOrder) {
    const model = models[provider];
    if (model) {
      contextTokenLimits[provider] = getProviderModelContextTokenLimit(provider, model);
    }
  }
  if (activeProfile) {
    contextTokenLimits.openaiCompatible = activeProfile.contextTokenLimit;
  }

  return {
    defaultProvider,
    providers,
    ...(Object.keys(models).length > 0 ? { models } : {}),
    ...(Object.keys(baseURLs).length > 0 ? { baseURLs } : {}),
    ...(Object.keys(contextTokenLimits).length > 0 ? { contextTokenLimits } : {}),
  };
}

export function getProviderConfigApiKey(
  providerConfig: ProviderConfigPayload | null | undefined,
  provider: ProviderConfigProvider
): string {
  const apiKey = providerConfig?.providers?.[provider];
  return typeof apiKey === 'string' ? apiKey.trim() : '';
}

export function getNamingModelApiKey(
  settings: Settings,
  model: NamingModelId
): string {
  return getProviderConfigApiKey(
    buildProviderConfig(settings),
    getNamingModelProvider(normalizeNamingModel(model))
  );
}

export function validateApiKey(provider: LLMProviderType, key: string): boolean {
  return validateProviderApiKey(provider, key);
}
