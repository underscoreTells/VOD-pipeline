/**
 * Central LLM provider registry (metadata only).
 *
 * This file is the SINGLE source of truth for which providers exist and
 * their static capabilities. It is renderer-safe: no Node/LangChain imports.
 *
 * Runtime concerns (model factories, tool-call strategies, video message
 * builders) live in `src/agent/providers/registry.ts`, keyed by the same ids.
 *
 * To add a new provider:
 *   1. Add a metadata entry below.
 *   2. Add a matching runtime entry in `src/agent/providers/registry.ts`.
 *   3. Add an API-key field mapping in the renderer settings state
 *      (`src/renderer/lib/state/settings-helpers.ts` PROVIDER_KEY_MAP).
 * Everything else (validation, labels, limits, env config, tool binding)
 * derives from the registry automatically.
 */

export interface ProviderMetadata {
  /** Human-readable label shown in the UI. */
  label: string;
  /** Environment variable holding the API key (worker .env fallback). */
  envVar: string;
  /** Accepted API key prefixes for lightweight client-side validation. */
  apiKeyPrefixes: string[];
  /** Model used when the user has not picked one. */
  defaultModel: string;
  /** Legacy/alias model ids mapped to their canonical names. */
  modelAliases: Record<string, string>;
  /** Approximate context window used by the near-limit token guard. */
  contextTokenLimit: number;
  /** Whether the provider can analyze video evidence. */
  supportsVideo: boolean;
  /** Whether the provider's chat model supports native token streaming. */
  nativeStreaming: boolean;
  /** Default API base URL override (for OpenAI-compatible providers). */
  defaultBaseURL?: string;
  /** Environment variable that overrides the base URL. */
  baseURLEnvVar?: string;
  /** Curated models that are compatible with the agent's tool loop. */
  models: readonly ProviderModelMetadata[];
  /** API keys are optional for local OpenAI-compatible servers. */
  apiKeyOptional?: boolean;
}

export interface ProviderModelMetadata {
  id: string;
  label: string;
  contextTokenLimit: number;
  supportsVideo: boolean;
}

export const PROVIDER_METADATA = {
  gemini: {
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    apiKeyPrefixes: ['AIza'],
    defaultModel: 'gemini-3.6-flash',
    modelAliases: {
      'gemini-1.5-flash': 'gemini-3.5-flash-lite',
      'gemini-3.0-flash': 'gemini-3.6-flash',
      'gemini-3-flash': 'gemini-3.6-flash',
      'gemini-3-flash-preview': 'gemini-3.6-flash',
    },
    contextTokenLimit: 1_000_000,
    supportsVideo: true,
    nativeStreaming: true,
    models: [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', contextTokenLimit: 1_048_576, supportsVideo: true },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', contextTokenLimit: 1_048_576, supportsVideo: true },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', contextTokenLimit: 1_048_576, supportsVideo: true },
    ],
  },
  openai: {
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    apiKeyPrefixes: ['sk-'],
    defaultModel: 'gpt-4o',
    modelAliases: {},
    contextTokenLimit: 128_000,
    supportsVideo: false,
    nativeStreaming: true,
    models: [
      { id: 'gpt-5', label: 'GPT-5', contextTokenLimit: 400_000, supportsVideo: false },
      { id: 'gpt-5-mini', label: 'GPT-5 Mini', contextTokenLimit: 400_000, supportsVideo: false },
      { id: 'gpt-4o', label: 'GPT-4o', contextTokenLimit: 128_000, supportsVideo: false },
    ],
  },
  anthropic: {
    label: 'Anthropic Claude',
    envVar: 'ANTHROPIC_API_KEY',
    apiKeyPrefixes: ['sk-ant-'],
    defaultModel: 'claude-sonnet-4-20250514',
    modelAliases: {},
    contextTokenLimit: 200_000,
    supportsVideo: false,
    nativeStreaming: true,
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', contextTokenLimit: 200_000, supportsVideo: false },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    apiKeyPrefixes: ['sk-or-'],
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    modelAliases: {},
    contextTokenLimit: 200_000,
    supportsVideo: false,
    nativeStreaming: true,
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    baseURLEnvVar: 'OPENROUTER_BASE_URL',
    models: [
      { id: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', contextTokenLimit: 200_000, supportsVideo: false },
    ],
  },
  kimi: {
    label: 'Kimi Platform',
    envVar: 'KIMI_API_KEY',
    apiKeyPrefixes: ['sk-'],
    defaultModel: 'kimi-k3',
    modelAliases: {
      'kimi-k2.5': 'kimi-k3',
    },
    contextTokenLimit: 1_048_576,
    supportsVideo: true,
    nativeStreaming: false,
    defaultBaseURL: 'https://api.moonshot.ai/v1',
    baseURLEnvVar: 'KIMI_BASE_URL',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3', contextTokenLimit: 1_048_576, supportsVideo: true },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', contextTokenLimit: 262_144, supportsVideo: true },
      { id: 'kimi-k2.6', label: 'Kimi K2.6', contextTokenLimit: 262_144, supportsVideo: true },
    ],
  },
  kimiCode: {
    label: 'Kimi For Coding',
    envVar: 'KIMI_CODE_API_KEY',
    apiKeyPrefixes: ['sk-'],
    defaultModel: 'k3',
    modelAliases: {},
    contextTokenLimit: 1_048_576,
    supportsVideo: false,
    nativeStreaming: true,
    defaultBaseURL: 'https://api.kimi.com/coding/v1',
    baseURLEnvVar: 'KIMI_CODE_BASE_URL',
    models: [
      { id: 'k3', label: 'Kimi K3', contextTokenLimit: 1_048_576, supportsVideo: false },
      { id: 'kimi-for-coding', label: 'Kimi K2.7 Code', contextTokenLimit: 262_144, supportsVideo: false },
      { id: 'kimi-for-coding-highspeed', label: 'Kimi K2.7 Code HighSpeed', contextTokenLimit: 262_144, supportsVideo: false },
    ],
  },
  openaiCompatible: {
    label: 'OpenAI Compatible',
    envVar: 'OPENAI_COMPATIBLE_API_KEY',
    apiKeyPrefixes: [],
    defaultModel: 'default',
    modelAliases: {},
    contextTokenLimit: 128_000,
    supportsVideo: false,
    nativeStreaming: true,
    baseURLEnvVar: 'OPENAI_COMPATIBLE_BASE_URL',
    apiKeyOptional: true,
    models: [],
  },
} as const satisfies Record<string, ProviderMetadata>;

/** Union of all registered provider ids. */
export type LLMProviderType = keyof typeof PROVIDER_METADATA;

/** All provider ids in canonical display order. */
export const PROVIDER_IDS = Object.keys(PROVIDER_METADATA) as LLMProviderType[];

/** Providers able to analyze video evidence. */
export const VIDEO_CAPABLE_PROVIDERS: LLMProviderType[] = PROVIDER_IDS.filter(
  (id) => PROVIDER_METADATA[id].supportsVideo
);

export function isLLMProvider(value: unknown): value is LLMProviderType {
  return typeof value === 'string' && value in PROVIDER_METADATA;
}

/** Returns the provider id when valid, otherwise null. */
export function normalizeProvider(value: unknown): LLMProviderType | null {
  return isLLMProvider(value) ? value : null;
}

export function getProviderMetadata(provider: LLMProviderType): ProviderMetadata {
  return PROVIDER_METADATA[provider];
}

export function getProviderLabel(provider: LLMProviderType): string {
  return PROVIDER_METADATA[provider].label;
}

export function providerSupportsVideo(provider: LLMProviderType): boolean {
  return PROVIDER_METADATA[provider].supportsVideo;
}

export function getProviderContextTokenLimit(provider: LLMProviderType): number {
  return PROVIDER_METADATA[provider].contextTokenLimit;
}

export function getProviderModels(provider: LLMProviderType): readonly ProviderModelMetadata[] {
  return PROVIDER_METADATA[provider].models;
}

export function getProviderModelContextTokenLimit(
  provider: LLMProviderType,
  model?: string | null
): number {
  const resolved = resolveProviderModel(provider, model);
  return PROVIDER_METADATA[provider].models.find((candidate) => candidate.id === resolved)?.contextTokenLimit
    ?? PROVIDER_METADATA[provider].contextTokenLimit;
}

/** Resolves model aliases to the provider's canonical model name. */
export function resolveProviderModel(
  provider: LLMProviderType,
  model?: string | null
): string {
  const metadata = PROVIDER_METADATA[provider];
  const configured = model?.trim() || metadata.defaultModel;
  const aliases: Record<string, string> = metadata.modelAliases;
  return aliases[configured.toLowerCase()] ?? configured;
}

/** Lightweight client-side API key shape check. */
export function validateProviderApiKey(
  provider: LLMProviderType,
  key: string
): boolean {
  if (!key) return false;
  if (getProviderMetadata(provider).apiKeyOptional) return true;
  return PROVIDER_METADATA[provider].apiKeyPrefixes.some((prefix) =>
    key.startsWith(prefix)
  );
}
