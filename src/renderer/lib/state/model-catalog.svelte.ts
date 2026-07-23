import type { ProviderModelInfo } from '../../../shared/contracts/electron-api.js';
import {
  getProviderModels,
  type LLMProviderType,
} from '../../../shared/llm/provider-registry.js';
import { listProviderModels } from '../api/settings.js';
import { buildProviderConfig } from './settings-helpers.js';
import { settingsState } from './settings.svelte.js';

export const modelCatalogState = $state<{
  models: Partial<Record<LLMProviderType, ProviderModelInfo[]>>;
  loadingProvider: LLMProviderType | null;
  errors: Partial<Record<LLMProviderType, string>>;
}>({
  models: {},
  loadingProvider: null,
  errors: {},
});

export function getFallbackModels(provider: LLMProviderType): ProviderModelInfo[] {
  return getProviderModels(provider).map((model) => ({
    id: model.id,
    label: model.label,
    contextTokenLimit: model.contextTokenLimit,
    supportsVideo: model.supportsVideo,
    reasoningEfforts: [...(model.reasoningEfforts ?? [])],
    source: 'fallback',
    compatibility: 'supported',
  }));
}

export function getModelsForProvider(provider: LLMProviderType): ProviderModelInfo[] {
  return modelCatalogState.models[provider] ?? getFallbackModels(provider);
}

export function getVideoModelsForProvider(provider: LLMProviderType): ProviderModelInfo[] {
  return getModelsForProvider(provider).filter(
    (model) => model.compatibility === 'supported' && model.supportsVideo
  );
}

export async function loadProviderModels(provider: LLMProviderType, refresh = false): Promise<void> {
  if (modelCatalogState.loadingProvider === provider) return;
  if (!refresh && modelCatalogState.models[provider]) return;
  modelCatalogState.loadingProvider = provider;
  delete modelCatalogState.errors[provider];
  try {
    const response = await listProviderModels({
      provider,
      agentConfig: buildProviderConfig(settingsState.settings, provider),
      refresh,
    });
    if (!response.success || !response.data) throw new Error(response.error || 'Failed to load models');
    modelCatalogState.models[provider] = response.data;
  } catch (error) {
    modelCatalogState.models[provider] = getFallbackModels(provider);
    modelCatalogState.errors[provider] = error instanceof Error ? error.message : 'Failed to load models';
  } finally {
    modelCatalogState.loadingProvider = null;
  }
}
