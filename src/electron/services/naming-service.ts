import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '../../agent/providers/index.js';
import type {
  ProviderConfigPayload,
  ProviderConfigProvider,
} from '../../shared/contracts/electron-api.js';
import {
  NAMING_MODEL_OPTIONS,
  getNamingModelProvider,
  type NamingModelId,
  type NamingModelProvider,
} from '../../shared/llm/naming-models.js';
import { getChapter, getTranscriptsByChapter } from '../database/index.js';

const DEFAULT_CHAPTER_TITLE = 'Untitled chapter';
const NAME_MAX_LENGTH = 80;
const PROVIDER_FALLBACK_MODELS: Partial<Record<NamingModelProvider, string[]>> = {
  openai: ['gpt-4o'],
};

interface NamingRequestAttempt {
  provider: NamingModelProvider;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export function sanitizeGeneratedName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/^"+|"+$/g, '')
    .replace(/[.!?,:;]+$/g, '')
    .trim();

  if (normalized.length < 3) {
    return null;
  }

  return normalized.slice(0, NAME_MAX_LENGTH);
}

export function extractTextFromAIContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      textParts.push(part);
      continue;
    }

    if (!part || typeof part !== 'object') {
      continue;
    }

    const text = (part as Record<string, unknown>).text;
    if (typeof text === 'string') {
      textParts.push(text);
    }
  }

  if (textParts.length === 0) {
    return null;
  }

  return textParts.join(' ');
}

export function getProviderConfigApiKey(
  providerConfig: ProviderConfigPayload | null | undefined,
  provider: ProviderConfigProvider
): string | null {
  const apiKey = providerConfig?.providers?.[provider];
  if (typeof apiKey !== 'string') {
    return null;
  }

  const trimmed = apiKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function appendNamingRequestAttempt(
  attempts: NamingRequestAttempt[],
  attemptKeys: Set<string>,
  providerConfig: ProviderConfigPayload | undefined,
  provider: NamingModelProvider,
  model?: string
): void {
  const apiKey = getProviderConfigApiKey(providerConfig, provider);
  if (!apiKey) {
    return;
  }

  const attemptKey = `${provider}:${model ?? '(default)'}`;
  if (attemptKeys.has(attemptKey)) {
    return;
  }

  attemptKeys.add(attemptKey);
  const baseURL = providerConfig?.baseURLs?.[provider];
  attempts.push({ provider, apiKey, model, ...(baseURL ? { baseURL } : {}) });
}

function buildNamingRequestAttempts(input: {
  model: NamingModelId;
  providerConfig?: ProviderConfigPayload;
}): NamingRequestAttempt[] {
  const attempts: NamingRequestAttempt[] = [];
  const attemptKeys = new Set<string>();
  const selectedProvider = getNamingModelProvider(input.model);

  appendNamingRequestAttempt(attempts, attemptKeys, input.providerConfig, selectedProvider, input.model);
  for (const fallbackModel of PROVIDER_FALLBACK_MODELS[selectedProvider] ?? []) {
    appendNamingRequestAttempt(attempts, attemptKeys, input.providerConfig, selectedProvider, fallbackModel);
  }

  for (const option of NAMING_MODEL_OPTIONS) {
    const provider = getNamingModelProvider(option.id);
    appendNamingRequestAttempt(attempts, attemptKeys, input.providerConfig, provider, option.id);
    for (const fallbackModel of PROVIDER_FALLBACK_MODELS[provider] ?? []) {
      appendNamingRequestAttempt(attempts, attemptKeys, input.providerConfig, provider, fallbackModel);
    }
  }

  return attempts;
}

function buildTranscriptExcerpt(
  transcripts: Array<{ text: string; start_time: number; end_time: number }>,
  inPoint: number,
  outPoint: number
): string {
  const overlapEpsilon = 0.001;
  const snippets: string[] = [];

  for (const transcript of transcripts) {
    if (!transcript || typeof transcript.text !== 'string') {
      continue;
    }

    const start = transcript.start_time;
    const end = transcript.end_time;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    if (end <= inPoint + overlapEpsilon || start >= outPoint - overlapEpsilon) {
      continue;
    }

    const text = transcript.text.trim();
    if (!text) {
      continue;
    }

    snippets.push(text);
    if (snippets.join(' ').length > 1200) {
      break;
    }
  }

  return snippets.join(' ').slice(0, 1200);
}

async function requestGeneratedName(input: {
  model: NamingModelId;
  providerConfig?: ProviderConfigPayload;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  for (const attempt of buildNamingRequestAttempts(input)) {
    input.signal?.throwIfAborted();
    try {
      // The provider factory strips unsupported temperature params for OpenAI GPT-5 models.
      const llm = createLLM({
        provider: attempt.provider,
        apiKey: attempt.apiKey,
        ...(attempt.model ? { model: attempt.model } : {}),
        ...(attempt.baseURL ? { baseURL: attempt.baseURL } : {}),
        temperature: 0.2,
        maxTokens: input.maxTokens,
      });

      const response = await llm.invoke([
        new SystemMessage(input.systemPrompt),
        new HumanMessage(input.userPrompt),
      ], input.signal ? { signal: input.signal } : undefined);

      const generatedName = sanitizeGeneratedName(extractTextFromAIContent(response.content));
      if (generatedName) {
        return generatedName;
      }
    } catch (error) {
      input.signal?.throwIfAborted();
      console.warn(
        `[NamingService] Failed to generate name with ${attempt.provider}:${attempt.model ?? 'default'}`,
        error
      );
    }
  }

  return null;
}

export async function suggestChapterClipName(input: {
  chapterId: number;
  inPoint: number;
  outPoint: number;
  model: NamingModelId;
  providerConfig?: ProviderConfigPayload;
  chapterTitle?: string;
}): Promise<string | null> {
  const chapter = await getChapter(input.chapterId);
  if (!chapter) {
    throw new Error('Chapter not found');
  }

  const transcriptRows = await getTranscriptsByChapter(input.chapterId);
  const transcriptExcerpt = buildTranscriptExcerpt(transcriptRows, input.inPoint, input.outPoint);
  const chapterTitle = input.chapterTitle?.trim() || chapter.title || DEFAULT_CHAPTER_TITLE;

  return await requestGeneratedName({
    model: input.model,
    providerConfig: input.providerConfig,
    maxTokens: 24,
    systemPrompt:
      'You name short video clips for editors. Return only one concise 3-7 word title. No quotes, no trailing punctuation, no labels.',
    userPrompt: [
      `Chapter title: ${chapterTitle}`,
      `Clip local time range: ${input.inPoint.toFixed(2)}s to ${input.outPoint.toFixed(2)}s`,
      transcriptExcerpt ? `Transcript excerpt: ${transcriptExcerpt}` : 'Transcript excerpt: (none)',
      'Return title only.',
    ].join('\n'),
  });
}

export async function suggestConversationTitle(input: {
  message: string;
  chapterTitle?: string | null;
  model: NamingModelId;
  providerConfig?: ProviderConfigPayload;
  signal?: AbortSignal;
}): Promise<string | null> {
  const normalizedMessage = input.message.replace(/\s+/g, ' ').trim();
  if (!normalizedMessage) {
    return null;
  }

  return await requestGeneratedName({
    model: input.model,
    providerConfig: input.providerConfig,
    maxTokens: 20,
    signal: input.signal,
    systemPrompt:
      'You name editor chat threads. Return only one concise 2-6 word thread title. No quotes, no labels, no trailing punctuation.',
    userPrompt: [
      `Chapter title: ${input.chapterTitle?.trim() || DEFAULT_CHAPTER_TITLE}`,
      `First user message: ${normalizedMessage}`,
      'Return title only.',
    ].join('\n'),
  });
}
