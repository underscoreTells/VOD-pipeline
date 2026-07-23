import { createHash } from 'node:crypto';
import {
  getProviderMetadata,
  getProviderModels,
  resolveProviderModel,
  type LLMProviderType,
  type ReasoningEffort,
} from '../../shared/llm/provider-registry.js';
import type {
  ProviderConfigPayload,
  ProviderModelInfo,
} from '../../shared/contracts/electron-api.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const cache = new Map<string, { expiresAt: number; models: ProviderModelInfo[] }>();

function getBaseURL(provider: LLMProviderType, config: ProviderConfigPayload): string {
  const configured = config.baseURLs?.[provider]?.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta';
  return getProviderMetadata(provider).defaultBaseURL?.replace(/\/$/, '') ?? '';
}

function assertHttpURL(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Model endpoint must use HTTP or HTTPS');
  }
  return url;
}

async function fetchJson(url: URL, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Model discovery failed with HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Model response is too large');
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('Model response is too large');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Model endpoint returned invalid JSON');
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

function humanizeModelId(id: string): string {
  return id
    .replace(/^models\//, '')
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => /^\d/.test(part) ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function isOpenAIChatModel(id: string): boolean {
  const normalized = id.toLowerCase();
  if (!/^(gpt-|o\d|chatgpt-)/.test(normalized)) return false;
  return !/(realtime|audio|transcribe|tts|image|embedding|moderation)/.test(normalized);
}

function parseReasoningEfforts(value: unknown): ReasoningEffort[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)
    .filter((effort) => {
      const capability = record[effort];
      return capability === true
        || (capability && typeof capability === 'object' && (capability as Record<string, unknown>).supported === true);
    });
}

function normalizeLiveModels(
  provider: LLMProviderType,
  payload: Record<string, unknown>
): Array<{ id: string; label?: string; contextTokenLimit?: number; reasoningEfforts?: ReasoningEffort[]; compatible: boolean }> {
  const rawModels = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];

  return rawModels.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const rawId = typeof record.id === 'string'
      ? record.id
      : typeof record.name === 'string'
        ? record.name
        : '';
    const id = rawId.replace(/^models\//, '').trim();
    if (!id) return [];

    if (provider === 'gemini') {
      const methods = Array.isArray(record.supportedGenerationMethods)
        ? record.supportedGenerationMethods
        : [];
      if (!methods.includes('generateContent')) return [];
    }
    if (provider === 'openai' && !isOpenAIChatModel(id)) return [];

    const supportedParameters = Array.isArray(record.supported_parameters)
      ? record.supported_parameters
      : [];
    const compatible = provider === 'openrouter'
      ? supportedParameters.length === 0 || supportedParameters.includes('tools')
      : true;
    if (!compatible) return [];

    const capabilities = record.capabilities && typeof record.capabilities === 'object'
      ? record.capabilities as Record<string, unknown>
      : {};
    const effort = capabilities.effort && typeof capabilities.effort === 'object'
      ? capabilities.effort as Record<string, unknown>
      : undefined;
    const hasOpenRouterReasoning = supportedParameters.includes('reasoning')
      || supportedParameters.includes('reasoning_effort');

    return [{
      id,
      label: typeof record.display_name === 'string'
        ? record.display_name
        : typeof record.displayName === 'string'
          ? record.displayName
          : undefined,
      contextTokenLimit: typeof record.max_input_tokens === 'number'
        ? record.max_input_tokens
        : typeof record.inputTokenLimit === 'number'
          ? record.inputTokenLimit
          : typeof record.context_length === 'number'
            ? record.context_length
            : undefined,
      reasoningEfforts: effort?.supported === true
        ? parseReasoningEfforts(effort)
        : hasOpenRouterReasoning
          ? ['low', 'medium', 'high']
          : undefined,
      compatible,
    }];
  });
}

export function getFallbackProviderModels(provider: LLMProviderType): ProviderModelInfo[] {
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

export async function listProviderModels(
  provider: LLMProviderType,
  config: ProviderConfigPayload,
  refresh = false
): Promise<ProviderModelInfo[]> {
  const baseURL = getBaseURL(provider, config);
  if (!baseURL) throw new Error('Configure an endpoint before loading models');
  const apiKey = config.providers?.[provider]?.trim() ?? '';
  if (!apiKey && !getProviderMetadata(provider).apiKeyOptional) {
    throw new Error(`Configure ${getProviderMetadata(provider).label} before loading models`);
  }

  const credentialFingerprint = createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
  const cacheKey = `${provider}:${baseURL}:${credentialFingerprint}`;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.models;

  const endpoint = assertHttpURL(`${baseURL}/models`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider === 'gemini') {
    endpoint.searchParams.set('key', apiKey);
  } else if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    endpoint.searchParams.set('limit', '1000');
  } else if (apiKey && apiKey !== 'not-required') {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const payload = await fetchJson(endpoint, headers);
  const liveModels = normalizeLiveModels(provider, payload);
  const fallbackById = new Map(getFallbackProviderModels(provider).map((model) => [model.id, model]));
  const models = liveModels.map((model): ProviderModelInfo => {
    const resolvedId = resolveProviderModel(provider, model.id);
    const fallback = fallbackById.get(model.id)
      ?? fallbackById.get(resolvedId)
      ?? [...fallbackById.values()].find((candidate) => model.id.startsWith(`${candidate.id}-`));
    return {
      id: model.id,
      label: model.label || fallback?.label || humanizeModelId(model.id),
      contextTokenLimit: model.contextTokenLimit
        || fallback?.contextTokenLimit
        || getProviderMetadata(provider).unknownModelContextTokenLimit
        || getProviderMetadata(provider).contextTokenLimit,
      supportsVideo: fallback?.supportsVideo ?? getProviderMetadata(provider).supportsVideo,
      reasoningEfforts: model.reasoningEfforts ?? fallback?.reasoningEfforts ?? [],
      source: 'live',
      compatibility: fallback || provider !== 'openai' ? 'supported' : 'unknown',
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  if (models.length === 0) throw new Error('No compatible chat models were returned by this provider');
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, models });
  return models;
}
