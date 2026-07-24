import type { ProxyOptions } from '../../../shared/contracts/electron-api.js';
import {
  normalizeProvider,
  type LLMProviderType,
} from '../../../shared/llm/provider-registry.js';

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeTranscriptionModel(value: unknown): 'tiny' | 'base' | 'small' | 'medium' {
  if (value === 'tiny' || value === 'base' || value === 'small' || value === 'medium') {
    return value;
  }
  return 'small';
}

export function normalizeComputeType(value: unknown): 'int8' | 'float16' {
  if (value === 'int8' || value === 'float16') {
    return value;
  }
  return 'int8';
}

export function normalizeConversationProvider(
  provider: unknown
): LLMProviderType | null {
  return normalizeProvider(provider);
}

export function normalizeSuggestionProvider(provider: unknown): Extract<LLMProviderType, 'gemini' | 'kimi'> | null {
  return provider === 'gemini' || provider === 'kimi' ? provider : null;
}

export function normalizeProxyOptions(proxyOptions?: ProxyOptions): Required<ProxyOptions> {
  return {
    encodingMode: proxyOptions?.encodingMode ?? 'auto',
    quality: proxyOptions?.quality ?? 'balanced',
  };
}
