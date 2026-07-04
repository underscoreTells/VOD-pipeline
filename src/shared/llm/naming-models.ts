export type NamingModelProvider = 'openai' | 'gemini' | 'kimi';

export type NamingModelId = 'gpt-5-nano' | 'gemini-3-flash-preview' | 'kimi-k2.5';

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
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    provider: 'gemini',
    description: 'Fast Gemini naming model',
  },
  {
    id: 'kimi-k2.5',
    label: 'Kimi K2.5',
    provider: 'kimi',
    description: 'Moonshot Kimi naming model',
  },
];

const NAMING_MODEL_PROVIDER_MAP: Record<NamingModelId, NamingModelProvider> = {
  'gpt-5-nano': 'openai',
  'gemini-3-flash-preview': 'gemini',
  'kimi-k2.5': 'kimi',
};

const LEGACY_NAMING_MODEL_ALIASES: Record<string, NamingModelId> = {
  'gpt-4o-mini': 'gpt-5-nano',
  'gpt-4o': 'gpt-5-nano',
  'gemini-1.5-flash': 'gemini-3-flash-preview',
  'gemini-3.0-flash': 'gemini-3-flash-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
};

export function isNamingModelId(value: unknown): value is NamingModelId {
  return value === 'gpt-5-nano' ||
    value === 'gemini-3-flash-preview' ||
    value === 'kimi-k2.5';
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
