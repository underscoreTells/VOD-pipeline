import type { LLMProviderType } from './provider-registry.js';

export type NamingModelProvider = Extract<LLMProviderType, 'openai' | 'gemini' | 'kimi'>;

export type NamingModelId = 'gpt-5-nano' | 'gemini-3.5-flash-lite' | 'kimi-k3';

export interface NamingModelOption {
  id: NamingModelId;
  label: string;
  provider: NamingModelProvider;
  description: string;
}

export const DEFAULT_NAMING_MODEL: NamingModelId = 'gpt-5-nano';

export const NAMING_MODEL_OPTIONS: NamingModelOption[] = [
  {
    id: 'gpt-5-nano',
    label: 'GPT-5 Nano',
    provider: 'openai',
    description: 'Smallest OpenAI naming model',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    provider: 'gemini',
    description: 'Fast Gemini naming model',
  },
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    provider: 'kimi',
    description: 'Moonshot Kimi naming model',
  },
];

const NAMING_MODEL_PROVIDER_MAP: Record<NamingModelId, NamingModelProvider> = {
  'gpt-5-nano': 'openai',
  'gemini-3.5-flash-lite': 'gemini',
  'kimi-k3': 'kimi',
};

const LEGACY_NAMING_MODEL_ALIASES: Record<string, NamingModelId> = {
  'gpt-4o-mini': 'gpt-5-nano',
  'gpt-4o': 'gpt-5-nano',
  'gemini-1.5-flash': 'gemini-3.5-flash-lite',
  'gemini-3.0-flash': 'gemini-3.5-flash-lite',
  'gemini-3-flash': 'gemini-3.5-flash-lite',
  'gemini-3-flash-preview': 'gemini-3.5-flash-lite',
  'kimi-k2.5': 'kimi-k3',
};

export function isNamingModelId(value: unknown): value is NamingModelId {
  return value === 'gpt-5-nano' ||
    value === 'gemini-3.5-flash-lite' ||
    value === 'kimi-k3';
}

export function normalizeNamingModel(
  value: unknown,
  fallback: NamingModelId = DEFAULT_NAMING_MODEL
): NamingModelId {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (isNamingModelId(normalized)) {
    return normalized;
  }

  return LEGACY_NAMING_MODEL_ALIASES[normalized] ?? fallback;
}

export function getNamingModelProvider(model: NamingModelId): NamingModelProvider {
  return NAMING_MODEL_PROVIDER_MAP[model];
}
