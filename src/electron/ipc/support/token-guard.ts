import { normalizeConversationProvider } from './payload.js';
import { getProviderContextTokenLimit } from '../../../shared/llm/provider-registry.js';

const TOKEN_GUARD_SOFT_RATIO = 0.92;
const TOKEN_GUARD_HARD_RATIO = 0.97;
const TOKEN_GUARD_RESPONSE_RESERVE = 4096;
const TOKEN_GUARD_MIN_INPUT_BUDGET = 4096;
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
const TOKEN_GUARD_MIN_RECENT_MESSAGES = 8;
const TOKEN_GUARD_MAX_SUMMARY_CHARS = 12000;
const TOKEN_GUARD_MIN_MESSAGES_AFTER_TRIM = 6;
const TOKEN_GUARD_SYSTEM_PROMPT_OVERHEAD = 1800;

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN));
}

function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, message) => {
    const roleTokens = estimateTokenCount(message.role || 'user');
    const contentTokens = estimateTokenCount(message.content || '');
    return total + roleTokens + contentTokens + 4;
  }, 0);
}

function estimateContextTokens(contextPayload: unknown): number {
  if (!contextPayload) return 0;
  try {
    return estimateTokenCount(JSON.stringify(contextPayload));
  } catch {
    return 0;
  }
}

function fitStringField(
  payload: Record<string, unknown>,
  field: string,
  value: string,
  maxTokens: number
): void {
  payload[field] = '';
  if (estimateContextTokens(payload) > maxTokens) return;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    payload[field] = value.slice(0, midpoint);
    if (estimateContextTokens(payload) <= maxTokens) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  payload[field] = value.slice(0, low);

  while (low > 0 && estimateContextTokens(payload) > maxTokens) {
    low -= 1;
    payload[field] = value.slice(0, low);
  }
}

function compactContextPayload(contextPayload: unknown, maxTokens: number): unknown {
  if (!contextPayload || typeof contextPayload !== 'object' || Array.isArray(contextPayload)) {
    return contextPayload;
  }

  const context = contextPayload as Record<string, unknown>;
  const referencedEntities = Array.isArray(context.referencedEntities) ? context.referencedEntities : [];
  const referencedSuggestionIds = referencedEntities
    .filter((entity): entity is Record<string, unknown> => (
      Boolean(entity) && typeof entity === 'object' && !Array.isArray(entity)
    ))
    .filter((entity) => entity.type === 'suggestion' && typeof entity.id === 'number')
    .map((entity) => entity.id as number);
  const referencedSuggestionSummary = typeof context.suggestionSummary === 'string'
    ? context.suggestionSummary
        .split('\n')
        .filter((line) => referencedSuggestionIds.some((id) => line.includes(`suggestion#${id} `)))
        .join('\n')
    : '';
  const referencedSuggestionTargetClipIds = referencedSuggestionSummary
    .split('\n')
    .map((line) => line.match(/\b(?:update|delete|split) clip #(\d+)\b/)?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number);
  const chapterClips = Array.isArray(context.chapterClips)
    ? context.chapterClips.map((clip) => {
        if (!clip || typeof clip !== 'object' || Array.isArray(clip)) return clip;
        const normalizedClip = clip as Record<string, unknown>;
        return {
          ...normalizedClip,
          ...(typeof normalizedClip.transcriptExcerpt === 'string'
            ? { transcriptExcerpt: normalizedClip.transcriptExcerpt.slice(0, 240) }
            : {}),
        };
      })
    : context.chapterClips;
  const compacted: Record<string, unknown> = {
    ...context,
    chapterClips,
    ...(Array.isArray(context.detailedTranscripts) ? { detailedTranscripts: [] } : {}),
    ...(typeof context.transcript === 'string' ? { transcript: '' } : {}),
  };

  const fitTranscript = () => {
    if (typeof context.transcript !== 'string') return;
    fitStringField(compacted, 'transcript', context.transcript, maxTokens);
  };

  fitTranscript();
  if (estimateContextTokens(compacted) > maxTokens && Array.isArray(compacted.chapterClips)) {
    compacted.chapterClips = compacted.chapterClips.map((clip) => (
      clip && typeof clip === 'object' && !Array.isArray(clip)
        ? { ...(clip as Record<string, unknown>), transcriptExcerpt: '' }
        : clip
    ));
    compacted.transcript = '';
    fitTranscript();
  }

  if (estimateContextTokens(compacted) > maxTokens && typeof compacted.suggestionSummary === 'string') {
    if (referencedSuggestionSummary) {
      compacted.suggestionSummary = referencedSuggestionSummary;
      if (typeof context.transcript === 'string') compacted.transcript = '';
      fitTranscript();
    } else {
      const suggestionSummary = compacted.suggestionSummary;
      fitStringField(compacted, 'suggestionSummary', suggestionSummary, maxTokens);
    }
  }

  if (estimateContextTokens(compacted) <= maxTokens) return compacted;

  const minimalContext: Record<string, unknown> = {
    ...(context.chapter && typeof context.chapter === 'object' ? { chapter: context.chapter } : {}),
    chapterAssetIds: Array.isArray(context.chapterAssetIds) ? context.chapterAssetIds : [],
    chapterClips: [],
    videoAnalysisAssets: [],
    ...(referencedEntities.length > 0 ? { referencedEntities } : {}),
    ...(referencedSuggestionSummary ? { suggestionSummary: referencedSuggestionSummary } : {}),
    ...(Array.isArray(context.selectedClipIds) ? { selectedClipIds: context.selectedClipIds } : {}),
  };
  if (estimateContextTokens(minimalContext) > maxTokens) {
    // Returning the original payload forces the caller's final size check to
    // reject the turn instead of silently running without chapter grounding.
    return contextPayload;
  }

  if (Array.isArray(context.videoAnalysisAssets)) {
    for (const asset of context.videoAnalysisAssets) {
      const candidateAssets = [...(minimalContext.videoAnalysisAssets as unknown[]), asset];
      const candidateContext = { ...minimalContext, videoAnalysisAssets: candidateAssets };
      if (estimateContextTokens(candidateContext) <= maxTokens) {
        minimalContext.videoAnalysisAssets = candidateAssets;
      }
    }
  }

  const compactClips = Array.isArray(context.chapterClips)
    ? context.chapterClips.map((clip) => {
        if (!clip || typeof clip !== 'object' || Array.isArray(clip)) return clip;
        const normalizedClip = clip as Record<string, unknown>;
        return {
          ...normalizedClip,
          ...(typeof normalizedClip.description === 'string'
            ? { description: normalizedClip.description.slice(0, 240) }
            : {}),
          ...(typeof normalizedClip.transcriptExcerpt === 'string' ? { transcriptExcerpt: '' } : {}),
        };
      })
    : [];
  const referencedClipIds = new Set(
    referencedEntities
      .filter((entity): entity is Record<string, unknown> => (
        Boolean(entity) && typeof entity === 'object' && !Array.isArray(entity)
      ))
      .filter((entity) => entity.type === 'clip' && typeof entity.id === 'number')
      .map((entity) => entity.id as number)
      .concat(
        (Array.isArray(context.selectedClipIds) ? context.selectedClipIds : [])
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
      )
      .concat(referencedSuggestionTargetClipIds)
  );
  const prioritizedClips = [
    ...compactClips.filter((clip) => (
      Boolean(clip)
      && typeof clip === 'object'
      && !Array.isArray(clip)
      && referencedClipIds.has((clip as Record<string, unknown>).id as number)
    )),
    ...compactClips.filter((clip) => (
      !clip
      || typeof clip !== 'object'
      || Array.isArray(clip)
      || !referencedClipIds.has((clip as Record<string, unknown>).id as number)
    )),
  ];
  const selectedClips = new Set<unknown>();
  for (const clip of prioritizedClips) {
    const candidateClips = prioritizedClips.filter(
      (candidate) => selectedClips.has(candidate) || candidate === clip
    );
    const candidateContext = { ...minimalContext, chapterClips: candidateClips };
    if (estimateContextTokens(candidateContext) <= maxTokens) selectedClips.add(clip);
  }
  minimalContext.chapterClips = prioritizedClips.filter((clip) => selectedClips.has(clip));
  return minimalContext;
}

function getProviderContextLimit(provider: unknown): number {
  const normalizedProvider = normalizeConversationProvider(provider);
  if (!normalizedProvider) {
    return getProviderContextTokenLimit('gemini');
  }
  return getProviderContextTokenLimit(normalizedProvider);
}

function normalizeMessagePayload(
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  return messages
    .map((message) => ({
      role: typeof message.role === 'string' ? message.role : 'user',
      content: typeof message.content === 'string' ? message.content : String(message.content ?? ''),
    }))
    .filter((message) => message.content.trim().length > 0);
}

function buildConversationArchiveSummary(
  archivedMessages: Array<{ role: string; content: string }>,
  maxChars: number
): string {
  if (archivedMessages.length === 0) return '';

  const lines: string[] = [
    `Conversation archive summary (${archivedMessages.length} earlier messages):`,
    'Keep continuity with this prior context when responding.',
  ];

  let usedChars = lines.join('\n').length;
  for (const message of archivedMessages) {
    if (usedChars >= maxChars) break;

    const role = typeof message.role === 'string' ? message.role.toLowerCase() : 'user';
    const normalizedRole = role === 'assistant' || role === 'ai' || role === 'system' ? role : 'user';
    const normalizedContent = (typeof message.content === 'string' ? message.content : String(message.content ?? ''))
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalizedContent) continue;

    const entry = `- ${normalizedRole}: ${normalizedContent.slice(0, 260)}`;
    const nextChars = usedChars + entry.length + 1;
    if (nextChars > maxChars) {
      break;
    }

    lines.push(entry);
    usedChars = nextChars;
  }

  return lines.join('\n');
}

export function applyNearLimitTokenGuard(
  rawMessages: Array<{ role: string; content: string }>,
  contextPayload: unknown,
  provider: unknown,
  contextTokenLimitOverride?: number
): {
  messages: Array<{ role: string; content: string }>;
  contextPayload: unknown;
  estimatedTotalTokens: number;
  effectiveContextLimit: number;
  compressed: boolean;
} {
  const normalizedMessages = normalizeMessagePayload(rawMessages);
  const contextLimit = typeof contextTokenLimitOverride === 'number' && Number.isFinite(contextTokenLimitOverride)
    ? Math.max(8192, Math.floor(contextTokenLimitOverride))
    : getProviderContextLimit(provider);
  const effectiveContextLimit = Math.max(TOKEN_GUARD_MIN_INPUT_BUDGET, contextLimit - TOKEN_GUARD_RESPONSE_RESERVE);
  const softThreshold = Math.floor(effectiveContextLimit * TOKEN_GUARD_SOFT_RATIO);
  const hardThreshold = Math.floor(effectiveContextLimit * TOKEN_GUARD_HARD_RATIO);

  let guardedContextPayload = contextPayload;
  const estimateTotal = (messages: Array<{ role: string; content: string }>) => {
    const contextTokens = estimateContextTokens(guardedContextPayload);
    // The worker renders this context into a system prompt in addition to its
    // fixed editing instructions. Counting both is deliberately conservative.
    return estimateMessageTokens(messages)
      + TOKEN_GUARD_SYSTEM_PROMPT_OVERHEAD
      + (contextTokens * 2);
  };

  let estimatedTotalTokens = estimateTotal(normalizedMessages);
  if (estimatedTotalTokens <= softThreshold) {
    return {
      messages: normalizedMessages,
      contextPayload: guardedContextPayload,
      estimatedTotalTokens,
      effectiveContextLimit,
      compressed: false,
    };
  }

  const recentCount = Math.max(TOKEN_GUARD_MIN_RECENT_MESSAGES, Math.min(24, normalizedMessages.length - 1));
  const splitIndex = Math.max(0, normalizedMessages.length - recentCount);
  const archivedMessages = normalizedMessages.slice(0, splitIndex);
  const recentMessages = normalizedMessages.slice(splitIndex);

  const summary = buildConversationArchiveSummary(archivedMessages, TOKEN_GUARD_MAX_SUMMARY_CHARS);
  let guardedMessages = summary
    ? [{ role: 'system', content: summary }, ...recentMessages]
    : recentMessages;

  estimatedTotalTokens = estimateTotal(guardedMessages);

  while (estimatedTotalTokens > hardThreshold && guardedMessages.length > TOKEN_GUARD_MIN_MESSAGES_AFTER_TRIM) {
    const removalIndex = guardedMessages[0]?.role === 'system' ? 1 : 0;
    if (removalIndex >= guardedMessages.length - 1) {
      break;
    }

    guardedMessages = guardedMessages.filter((_, index) => index !== removalIndex);
    estimatedTotalTokens = estimateTotal(guardedMessages);
  }

  if (estimatedTotalTokens > hardThreshold && guardedMessages[0]?.role === 'system') {
    const compactSummary = guardedMessages[0].content.slice(0, 3200);
    guardedMessages = [{ role: 'system', content: compactSummary }, ...guardedMessages.slice(1)];
    estimatedTotalTokens = estimateTotal(guardedMessages);
  }

  if (estimatedTotalTokens > hardThreshold) {
    const contextBudget = Math.max(0, Math.floor(
      (hardThreshold - estimateMessageTokens(guardedMessages) - TOKEN_GUARD_SYSTEM_PROMPT_OVERHEAD) / 2
    ));
    guardedContextPayload = compactContextPayload(guardedContextPayload, contextBudget);
    estimatedTotalTokens = estimateTotal(guardedMessages);
  }

  while (estimatedTotalTokens > hardThreshold && guardedMessages.length > 1) {
    guardedMessages = guardedMessages.slice(1);
    estimatedTotalTokens = estimateTotal(guardedMessages);
  }

  if (estimatedTotalTokens > hardThreshold) {
    throw new Error(
      `The latest message exceeds this model's input limit (${hardThreshold} estimated tokens). Shorten it and try again.`
    );
  }

  return {
    messages: guardedMessages,
    contextPayload: guardedContextPayload,
    estimatedTotalTokens,
    effectiveContextLimit,
    compressed: true,
  };
}
