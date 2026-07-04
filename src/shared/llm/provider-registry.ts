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
}

export const PROVIDER_METADATA = {
  gemini: {
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    apiKeyPrefixes: ['AIza'],
    defaultModel: 'gemini-3-flash-preview',
    modelAliases: {
      'gemini-3.0-flash': 'gemini-3-flash-preview',
      'gemini-3-flash': 'gemini-3-flash-preview',
    },
    contextTokenLimit: 1_000_000,
    supportsVideo: true,
    nativeStreaming: true,
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
  },
  kimi: {
    label: 'Kimi K2.5 (Moonshot AI)',
    envVar: 'KIMI_API_KEY',
    apiKeyPrefixes: ['sk-'],
    defaultModel: 'kimi-k2.5',
    modelAliases: {},
    contextTokenLimit: 128_000,
    supportsVideo: true,
    nativeStreaming: false,
    defaultBaseURL: 'https://api.moonshot.cn/v1',
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
  return PROVIDER_METADATA[provider].apiKeyPrefixes.some((prefix) =>
    key.startsWith(prefix)
  );
}
