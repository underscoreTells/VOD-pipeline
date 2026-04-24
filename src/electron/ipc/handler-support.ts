import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { app } from 'electron';
import { isAudiowaveformAvailable } from '../audiowaveformDetector.js';
import {
  createChapterProxy,
  createSuggestion,
  getAsset,
  getAssetsByProject,
  getAssetsForChapter,
  getChapter,
  getChapterProxyByChapterAsset,
  getClip,
  getClipsByProject,
  getSuggestionsByConversation,
  getTranscriptsByChapter,
  getWaveform,
  updateChapterProxyDefinition,
  updateChapterProxyMetadata,
  updateChapterProxyStatus,
} from '../database/index.js';
import type { Asset, ChapterProxy, Clip, Suggestion } from '../../shared/types/database.js';
import type {
  AgentGroundingStatusData,
  ProxyOptions,
} from '../../shared/contracts/electron-api.js';
import type {
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from '../../shared/types/agent-ipc.js';
import {
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from '../../shared/utils/assistant-content.js';
import {
  generateDetailedTranscriptsForRequests,
  normalizeTranscriptDetailRequests,
} from '../../shared/utils/detailed-transcript-tools.js';
import {
  generateAIProxy,
  generateChapterReverseProxy,
  getVideoMetadata,
} from '../../pipeline/ffmpeg.js';
import {
  generateWaveformTiers,
  generateWaveformTiersForMkvTracks,
} from '../../pipeline/waveform.js';

const PROVIDER_CONTEXT_TOKEN_LIMITS: Record<'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'kimi', number> = {
  gemini: 1_000_000,
  openai: 128_000,
  anthropic: 200_000,
  openrouter: 200_000,
  kimi: 128_000,
};

const TOKEN_GUARD_SOFT_RATIO = 0.92;
const TOKEN_GUARD_HARD_RATIO = 0.97;
const TOKEN_GUARD_RESPONSE_RESERVE = 4096;
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
const TOKEN_GUARD_MIN_RECENT_MESSAGES = 8;
const TOKEN_GUARD_MAX_SUMMARY_CHARS = 12000;
const TOKEN_GUARD_MIN_MESSAGES_AFTER_TRIM = 6;

const OVERVIEW_TRANSCRIPT_CHUNK_SECONDS = 15;
const OVERVIEW_TRANSCRIPT_MAX_LINES = 320;
const OVERVIEW_TRANSCRIPT_MAX_CHARS = 30000;
const CHAPTER_PROXY_TIME_EPSILON = 0.01;
type ChapterRecord = NonNullable<Awaited<ReturnType<typeof getChapter>>>;
type ChapterProxyRecord = NonNullable<Awaited<ReturnType<typeof getChapterProxyByChapterAsset>>>;

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeTranscriptionModel(value: unknown): 'tiny' | 'base' | 'small' | 'medium' {
  if (value === 'tiny' || value === 'base' || value === 'small' || value === 'medium') {
    return value;
  }
  return 'base';
}

export function normalizeComputeType(value: unknown): 'int8' | 'float16' {
  if (value === 'int8' || value === 'float16') {
    return value;
  }
  return 'int8';
}

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

export function normalizeConversationProvider(
  provider: unknown
): 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'kimi' | null {
  return provider === 'gemini' ||
    provider === 'openai' ||
    provider === 'anthropic' ||
    provider === 'openrouter' ||
    provider === 'kimi'
    ? provider
    : null;
}

function getProviderContextLimit(provider: unknown): number {
  const normalizedProvider = normalizeConversationProvider(provider);
  if (!normalizedProvider) {
    return PROVIDER_CONTEXT_TOKEN_LIMITS.gemini;
  }
  return PROVIDER_CONTEXT_TOKEN_LIMITS[normalizedProvider];
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
  provider: unknown
): {
  messages: Array<{ role: string; content: string }>;
  estimatedTotalTokens: number;
  effectiveContextLimit: number;
  compressed: boolean;
} {
  const normalizedMessages = normalizeMessagePayload(rawMessages);
  const contextLimit = getProviderContextLimit(provider);
  const effectiveContextLimit = Math.max(8192, contextLimit - TOKEN_GUARD_RESPONSE_RESERVE);
  const softThreshold = Math.floor(effectiveContextLimit * TOKEN_GUARD_SOFT_RATIO);
  const hardThreshold = Math.floor(effectiveContextLimit * TOKEN_GUARD_HARD_RATIO);

  const estimateTotal = (messages: Array<{ role: string; content: string }>) => {
    return estimateMessageTokens(messages) + estimateContextTokens(contextPayload);
  };

  let estimatedTotalTokens = estimateTotal(normalizedMessages);
  if (estimatedTotalTokens <= softThreshold || normalizedMessages.length <= TOKEN_GUARD_MIN_RECENT_MESSAGES + 1) {
    return {
      messages: normalizedMessages,
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

  return {
    messages: guardedMessages,
    estimatedTotalTokens,
    effectiveContextLimit,
    compressed: true,
  };
}

function extractAssistantMessage(result: Record<string, unknown>): string {
  const explicit = result.assistantResponse;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return sanitizeAssistantContent(explicit);
  }

  const messages = Array.isArray(result.messages) ? result.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
    if (message && typeof message === 'object') {
      const record = message as Record<string, unknown>;
      const content = record.content;
      if (typeof content === 'string' && content.trim().length > 0) {
        return sanitizeAssistantContent(content);
      }
    }
  }

  return 'Analysis complete';
}

function extractThinkingMarkdown(result: Record<string, unknown>): string | null {
  const explicit = result.thinkingMarkdown;
  if (typeof explicit !== 'string') {
    return null;
  }

  const sanitized = sanitizeThinkingMarkdown(explicit);
  return sanitized.length > 0 ? sanitized : null;
}

export function normalizeTimelineActions(value: unknown): TimelineAction[] {
  if (!Array.isArray(value)) return [];
  const actions: TimelineAction[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const action = item as Record<string, unknown>;
    if (action.type === 'create_clip') {
      if (typeof action.inPoint !== 'number' || typeof action.outPoint !== 'number') continue;
      if (!Number.isFinite(action.inPoint) || !Number.isFinite(action.outPoint)) continue;
      if (action.outPoint <= action.inPoint) continue;

      actions.push({
        type: 'create_clip',
        assetId: typeof action.assetId === 'number' ? action.assetId : undefined,
        trackIndex: typeof action.trackIndex === 'number' ? action.trackIndex : undefined,
        startTime: typeof action.startTime === 'number' ? action.startTime : undefined,
        inPoint: action.inPoint,
        outPoint: action.outPoint,
        role: typeof action.role === 'string' || action.role === null ? action.role as Clip['role'] : undefined,
        description: typeof action.description === 'string' || action.description === null ? action.description : undefined,
        isEssential: typeof action.isEssential === 'boolean' ? action.isEssential : undefined,
        reasoning: typeof action.reasoning === 'string' ? action.reasoning : undefined,
      });
      continue;
    }

    if (action.type === 'update_clip') {
      if (typeof action.clipId !== 'number' || !Number.isFinite(action.clipId)) continue;
      const updatesRaw = action.updates;
      if (!updatesRaw || typeof updatesRaw !== 'object') continue;

      const updatesRecord = updatesRaw as Record<string, unknown>;
      const updates: {
        startTime?: number;
        inPoint?: number;
        outPoint?: number;
        role?: Clip['role'];
        description?: string | null;
        isEssential?: boolean;
      } = {};
      if (typeof updatesRecord.startTime === 'number' && Number.isFinite(updatesRecord.startTime)) {
        updates.startTime = updatesRecord.startTime;
      }
      if (typeof updatesRecord.inPoint === 'number' && Number.isFinite(updatesRecord.inPoint)) {
        updates.inPoint = updatesRecord.inPoint;
      }
      if (typeof updatesRecord.outPoint === 'number' && Number.isFinite(updatesRecord.outPoint)) {
        updates.outPoint = updatesRecord.outPoint;
      }
      if (typeof updatesRecord.role === 'string' || updatesRecord.role === null) {
        updates.role = updatesRecord.role as Clip['role'];
      }
      if (typeof updatesRecord.description === 'string' || updatesRecord.description === null) {
        updates.description = updatesRecord.description;
      }
      if (typeof updatesRecord.isEssential === 'boolean') {
        updates.isEssential = updatesRecord.isEssential;
      }

      if (Object.keys(updates).length === 0) continue;
      if (
        updates.inPoint !== undefined &&
        updates.outPoint !== undefined &&
        updates.outPoint <= updates.inPoint
      ) {
        continue;
      }

      actions.push({
        type: 'update_clip',
        clipId: action.clipId,
        updates,
        reasoning: typeof action.reasoning === 'string' ? action.reasoning : undefined,
      });
    }
  }

  return actions;
}

interface PersistableSuggestionDraft {
  in_point: number;
  out_point: number;
  description: string | null;
  reasoning: string | null;
  action_type: 'create_clip' | 'update_clip';
  target_clip_id: number | null;
  action_payload_json: string | null;
}

function normalizeSuggestionDrafts(value: unknown): PersistableSuggestionDraft[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): PersistableSuggestionDraft | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      if (typeof record.in_point !== 'number' || typeof record.out_point !== 'number') return null;
      if (!Number.isFinite(record.in_point) || !Number.isFinite(record.out_point)) return null;
      if (record.out_point <= record.in_point) return null;

      return {
        in_point: record.in_point,
        out_point: record.out_point,
        description: typeof record.description === 'string' ? record.description : null,
        reasoning: typeof record.reasoning === 'string' ? record.reasoning : null,
        action_type: 'create_clip',
        target_clip_id: null,
        action_payload_json: null,
      };
    })
    .filter((item): item is PersistableSuggestionDraft => item !== null);
}

function timelineActionsToSuggestionDrafts(actions: TimelineAction[]): PersistableSuggestionDraft[] {
  return actions
    .map((action): PersistableSuggestionDraft | null => {
      if (action.type === 'create_clip') {
        const payload = {
          create: {
            assetId: action.assetId,
            trackIndex: action.trackIndex,
            startTime: action.startTime,
            role: action.role,
            description: action.description ?? null,
            isEssential: action.isEssential,
          },
        };

        return {
          action_type: 'create_clip',
          in_point: action.inPoint,
          out_point: action.outPoint,
          description: action.description ?? action.reasoning ?? 'Create clip',
          reasoning: action.reasoning ?? null,
          target_clip_id: null,
          action_payload_json: JSON.stringify(payload),
        };
      }

      const updates = action.updates;
      const hasRange = typeof updates.inPoint === 'number' && typeof updates.outPoint === 'number' && updates.outPoint > updates.inPoint;
      const fallbackIn = typeof updates.inPoint === 'number' ? updates.inPoint : 0;
      const fallbackOut = hasRange
        ? (updates.outPoint as number)
        : typeof updates.outPoint === 'number' && updates.outPoint > fallbackIn
          ? updates.outPoint
          : fallbackIn + 1;

      const payload = {
        update: {
          startTime: updates.startTime,
          inPoint: updates.inPoint,
          outPoint: updates.outPoint,
          role: updates.role,
          description: updates.description,
          isEssential: updates.isEssential,
        },
      };

      return {
        action_type: 'update_clip',
        target_clip_id: action.clipId,
        in_point: fallbackIn,
        out_point: fallbackOut,
        description: updates.description ?? `Update clip #${action.clipId}`,
        reasoning: action.reasoning ?? null,
        action_payload_json: JSON.stringify(payload),
      };
    })
    .filter((item): item is PersistableSuggestionDraft => Boolean(item));
}

export function parseConversationTurnResult(
  result: Record<string, unknown>,
  chapterDuration: number | null,
  chapterAssetIds: number[]
): {
  message: string;
  thinkingMarkdown: string | null;
  outcome: 'discussion' | 'clarification' | 'proposal';
  timelineActions: TimelineAction[];
  suggestionDrafts: PersistableSuggestionDraft[];
  transcriptDetailRequests: TranscriptDetailRequest[];
} {
  const message = extractAssistantMessage(result);
  const thinkingMarkdown = extractThinkingMarkdown(result);
  const outcome = result.outcome === 'proposal' || result.outcome === 'clarification'
    ? result.outcome
    : 'discussion';
  const timelineActions = normalizeTimelineActions(result.timelineActions);
  const suggestionDrafts = [
    ...normalizeSuggestionDrafts(result.suggestionDrafts),
    ...timelineActionsToSuggestionDrafts(timelineActions),
  ];
  const transcriptDetailRequests =
    chapterDuration !== null
      ? normalizeTranscriptDetailRequests(result.transcriptDetailRequests, chapterDuration, chapterAssetIds)
      : [];

  return {
    message,
    thinkingMarkdown,
    outcome,
    timelineActions,
    suggestionDrafts,
    transcriptDetailRequests,
  };
}

function normalizeSuggestionProvider(provider: unknown): 'gemini' | 'kimi' | null {
  return provider === 'gemini' || provider === 'kimi' ? provider : null;
}

export async function persistAgentSuggestions(
  chapterId: number,
  conversationId: number,
  chatMessageId: number,
  provider: unknown,
  suggestions: PersistableSuggestionDraft[]
) {
  if (suggestions.length === 0) return [];

  const existing = await getSuggestionsByConversation(conversationId, chapterId);
  const chapter = await getChapter(chapterId);
  if (!chapter) {
    return [];
  }

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  let displayOrder = existing.length;
  const created: Suggestion[] = [];

  for (const suggestion of suggestions) {
    let localInPoint = suggestion.in_point;
    let localOutPoint = suggestion.out_point;

    if (suggestion.action_type === 'update_clip' && suggestion.target_clip_id) {
      const targetClip = await getClip(suggestion.target_clip_id);
      if (!targetClip) {
        continue;
      }

      const baseLocalIn = targetClip.in_point - chapter.start_time;
      const baseLocalOut = targetClip.out_point - chapter.start_time;

      let payloadInPoint: number | undefined;
      let payloadOutPoint: number | undefined;
      if (typeof suggestion.action_payload_json === 'string') {
        try {
          const payload = JSON.parse(suggestion.action_payload_json) as {
            update?: { inPoint?: unknown; outPoint?: unknown };
          };
          if (typeof payload?.update?.inPoint === 'number' && Number.isFinite(payload.update.inPoint)) {
            payloadInPoint = payload.update.inPoint;
          }
          if (typeof payload?.update?.outPoint === 'number' && Number.isFinite(payload.update.outPoint)) {
            payloadOutPoint = payload.update.outPoint;
          }
        } catch {
          // Keep draft fallback values when payload cannot be parsed.
        }
      }

      localInPoint = payloadInPoint ?? baseLocalIn;
      localOutPoint = payloadOutPoint ?? baseLocalOut;
    }

    localInPoint = clamp(localInPoint, 0, chapterDuration);
    localOutPoint = clamp(localOutPoint, localInPoint + 0.01, chapterDuration);

    if (!Number.isFinite(localInPoint) || !Number.isFinite(localOutPoint) || localOutPoint <= localInPoint) {
      continue;
    }

    const createdSuggestion = await createSuggestion({
      chapter_id: chapterId,
      conversation_id: conversationId,
      chat_message_id: chatMessageId,
      in_point: localInPoint,
      out_point: localOutPoint,
      description: suggestion.description,
      reasoning: suggestion.reasoning,
      provider: normalizeSuggestionProvider(provider),
      action_type: suggestion.action_type,
      target_clip_id: suggestion.target_clip_id,
      action_payload_json: suggestion.action_payload_json,
      preview_snapshot_json: null,
      status: 'pending',
      display_order: displayOrder,
      clip_id: null,
    });
    created.push(createdSuggestion);
    displayOrder += 1;
  }

  return created;
}

function normalizeChapterLocalSegment(
  segment: { start_time: number; end_time: number; text: string },
  chapterStart: number,
  chapterDuration: number
): { start: number; end: number; text: string } | null {
  if (!segment.text || !segment.text.trim()) return null;

  const looksLikeLegacyGlobal =
    segment.start_time > chapterDuration + 1 ||
    segment.end_time > chapterDuration + 1 ||
    segment.start_time < -0.001;

  const localStartRaw = looksLikeLegacyGlobal ? segment.start_time - chapterStart : segment.start_time;
  const localEndRaw = looksLikeLegacyGlobal ? segment.end_time - chapterStart : segment.end_time;

  const start = clamp(localStartRaw, 0, chapterDuration);
  const end = clamp(localEndRaw, start, chapterDuration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  return {
    start,
    end,
    text: segment.text.trim(),
  };
}

function formatOverviewTranscript(
  transcriptSegments: Array<{ start_time: number; end_time: number; text: string }>,
  chapterStart: number,
  chapterEnd: number
): string {
  const chapterDuration = Math.max(0.01, chapterEnd - chapterStart);

  const normalized = transcriptSegments
    .map((segment) => normalizeChapterLocalSegment(segment, chapterStart, chapterDuration))
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) return '';

  const chunks = new Map<number, { start: number; end: number; textParts: string[] }>();
  for (const segment of normalized) {
    const bucket = Math.floor(segment.start / OVERVIEW_TRANSCRIPT_CHUNK_SECONDS);
    const existing = chunks.get(bucket);
    if (existing) {
      existing.end = Math.max(existing.end, segment.end);
      existing.textParts.push(segment.text);
      continue;
    }

    chunks.set(bucket, {
      start: bucket * OVERVIEW_TRANSCRIPT_CHUNK_SECONDS,
      end: segment.end,
      textParts: [segment.text],
    });
  }

  const lines = [...chunks.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, OVERVIEW_TRANSCRIPT_MAX_LINES)
    .map(([, chunk]) => {
      const text = chunk.textParts.join(' ').replace(/\s+/g, ' ').trim();
      return `[${chunk.start.toFixed(2)}-${chunk.end.toFixed(2)}] ${text}`;
    });

  return lines.join('\n').slice(0, OVERVIEW_TRANSCRIPT_MAX_CHARS);
}

function getProxyDirectoryPath(): string {
  const userDataPath = app.getPath('userData');
  const proxiesDir = path.join(userDataPath, 'proxies');
  if (!fs.existsSync(proxiesDir)) {
    fs.mkdirSync(proxiesDir, { recursive: true });
  }
  return proxiesDir;
}

function getChapterProxyPath(chapterId: number, assetId: number): string {
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_ai_proxy.mp4`);
}

function getChapterProxyTempPath(chapterId: number, assetId: number, generationEpoch: number): string {
  return path.join(
    getProxyDirectoryPath(),
    `chapter_${chapterId}_asset_${assetId}_ai_proxy.partial.${generationEpoch}.mp4`
  );
}

function normalizeProxyOptions(proxyOptions?: ProxyOptions): Required<ProxyOptions> {
  return {
    encodingMode: proxyOptions?.encodingMode ?? 'auto',
    quality: proxyOptions?.quality ?? 'balanced',
  };
}

export function isChapterProxyReusable(
  proxy: {
    status: string;
    file_path: string;
    start_time: number;
    end_time: number;
  } | null | undefined,
  chapter: { start_time: number; end_time: number }
): boolean {
  if (!proxy || proxy.status !== 'ready') {
    return false;
  }

  return isChapterProxyArtifactCurrent(proxy, chapter);
}

function getReusableChapterProxy(
  proxy: ChapterProxyRecord | null | undefined,
  chapter: Pick<ChapterRecord, 'start_time' | 'end_time'>
): ChapterProxyRecord | null {
  if (!proxy) {
    return null;
  }

  return isChapterProxyReusable(proxy, chapter) ? proxy : null;
}

function isChapterProxyArtifactCurrent(
  proxy: Pick<ChapterProxy, 'file_path' | 'start_time' | 'end_time'> | null | undefined,
  chapter: Pick<ChapterRecord, 'start_time' | 'end_time'>
): boolean {
  if (!proxy?.file_path) {
    return false;
  }

  try {
    const stats = fs.statSync(proxy.file_path);
    if (!stats.isFile() || stats.size <= 0) {
      return false;
    }
  } catch {
    return false;
  }

  return (
    Math.abs(proxy.start_time - chapter.start_time) <= CHAPTER_PROXY_TIME_EPSILON
    && Math.abs(proxy.end_time - chapter.end_time) <= CHAPTER_PROXY_TIME_EPSILON
  );
}

async function recoverChapterProxyIfCurrent(
  proxy: ChapterProxyRecord | null | undefined,
  chapter: Pick<ChapterRecord, 'id' | 'start_time' | 'end_time'>
): Promise<ChapterProxyRecord | null> {
  if (!proxy || proxy.status === 'ready' || !isChapterProxyArtifactCurrent(proxy, chapter)) {
    return proxy ?? null;
  }

  const metadataUpdates: Parameters<typeof updateChapterProxyMetadata>[1] = {};

  try {
    const stats = fs.statSync(proxy.file_path);
    if (proxy.file_size === null) {
      metadataUpdates.file_size = stats.size;
    }
  } catch {
    return proxy;
  }

  const requiresVideoMetadata =
    proxy.width === null
    || proxy.height === null
    || proxy.framerate === null
    || proxy.duration === null;

  if (requiresVideoMetadata) {
    try {
      const metadata = await getVideoMetadata(proxy.file_path);
      if (proxy.width === null && Number.isFinite(metadata.width)) {
        metadataUpdates.width = metadata.width;
      }
      if (proxy.height === null && Number.isFinite(metadata.height)) {
        metadataUpdates.height = metadata.height;
      }
      if (proxy.framerate === null && Number.isFinite(metadata.fps)) {
        metadataUpdates.framerate = metadata.fps;
      }
      if (proxy.duration === null && Number.isFinite(metadata.duration)) {
        metadataUpdates.duration = metadata.duration;
      }
    } catch (error) {
      console.warn(
        `[ChapterProxy] Failed to backfill proxy metadata chapter=${chapter.id} asset=${proxy.asset_id}:`,
        error
      );
    }
  }

  if (Object.keys(metadataUpdates).length > 0) {
    await updateChapterProxyMetadata(proxy.id, metadataUpdates);
  }
  await updateChapterProxyStatus(proxy.id, 'ready');

  return await getChapterProxyByChapterAsset(chapter.id, proxy.asset_id);
}

type ReverseProxyVariant = 'full' | 'quick';

function getChapterReverseProxyPath(chapterId: number, assetId: number, variant: ReverseProxyVariant = 'full'): string {
  const suffix = variant === 'full' ? 'reverse_preview.mp4' : 'reverse_preview_quick.mp4';
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_${suffix}`);
}

function getChapterReverseProxyTempPath(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full',
  generationEpoch?: number
): string {
  const baseName = variant === 'full'
    ? `chapter_${chapterId}_asset_${assetId}_reverse_preview.partial`
    : `chapter_${chapterId}_asset_${assetId}_reverse_preview_quick.partial`;
  if (generationEpoch === undefined) {
    return path.join(getProxyDirectoryPath(), `${baseName}.mp4`);
  }
  return path.join(getProxyDirectoryPath(), `${baseName}.${generationEpoch}.mp4`);
}

function getChapterReverseProxyUrl(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full'
): string {
  if (variant === 'quick') {
    return `vod://reverse/${chapterId}/${assetId}/quick`;
  }
  return `vod://reverse/${chapterId}/${assetId}`;
}

function getReverseValidationCacheKey(chapterId: number, assetId: number, variant: ReverseProxyVariant): string {
  return `${chapterId}:${assetId}:${variant}`;
}

type ChapterReverseProxyStatusPayload = {
  status: 'missing' | 'generating' | 'ready' | 'error';
  url?: string;
  quality?: ReverseProxyVariant;
  isFinal?: boolean;
  error?: string;
};

type HeavyMediaJobType = 'chapterProxy' | 'transcription' | 'reverseQuickWarm' | 'reverseFullWarm';
type HeavyMediaJobPriority = 'background' | 'interactive';
type ReverseProxyExecutionMode = 'background' | 'interactive';

type HeavyMediaJob<T> = {
  key: string;
  type: HeavyMediaJobType;
  priority: HeavyMediaJobPriority;
  started: boolean;
  sequence: number;
  run: () => Promise<T>;
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const chapterProxyGenerationLocks = new Map<string, { epoch: number; promise: Promise<string | undefined> }>();
const chapterReverseProxyGenerationLocks = new Map<string, { epoch: number; promise: Promise<string | undefined> }>();
const chapterReverseProxyQuickGenerationLocks = new Map<string, { epoch: number; promise: Promise<string | undefined> }>();
const chapterReverseProxyBackgroundTimers = new Map<string, NodeJS.Timeout>();
const chapterReverseProxyErrors = new Map<string, string>();
const chapterReverseProxyValidationCache = new Map<string, { mtimeMs: number; size: number; valid: boolean }>();
const chapterWaveformPrewarmLocks = new Map<string, Promise<void>>();
const chapterMediaPrewarmLocks = new Map<string, Promise<void>>();
const chapterMediaPrewarmQueue: Array<() => Promise<void>> = [];
const CHAPTER_MEDIA_PREWARM_MAX_CONCURRENCY = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2)));
let activeChapterMediaPrewarmJobs = 0;
const chapterProxyGenerationEpochs = new Map<string, number>();
const chapterReverseProxyGenerationEpochs = new Map<string, number>();
const reverseQuickExecutionModes = new Map<string, ReverseProxyExecutionMode>();
const HEAVY_MEDIA_MAX_CONCURRENCY = 1;
const heavyMediaQueue: Array<HeavyMediaJob<unknown>> = [];
const heavyMediaJobs = new Map<string, HeavyMediaJob<unknown>>();
let activeHeavyMediaJobs = 0;
let heavyMediaJobSequence = 0;

function getGenerationEpoch(epochMap: Map<string, number>, lockKey: string): number {
  return epochMap.get(lockKey) ?? 0;
}

function bumpGenerationEpoch(epochMap: Map<string, number>, lockKey: string): number {
  const nextEpoch = getGenerationEpoch(epochMap, lockKey) + 1;
  epochMap.set(lockKey, nextEpoch);
  return nextEpoch;
}

function deleteFileIfExists(filePath: string | null | undefined, label: string): void {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.warn(`[${label}] Failed deleting file ${filePath}:`, error);
  }
}

function getHeavyMediaPriorityRank(priority: HeavyMediaJobPriority): number {
  return priority === 'interactive' ? 0 : 1;
}

function sortHeavyMediaQueue(): void {
  heavyMediaQueue.sort((left, right) => {
    const priorityDelta = getHeavyMediaPriorityRank(left.priority) - getHeavyMediaPriorityRank(right.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.sequence - right.sequence;
  });
}

function pumpHeavyMediaQueue(): void {
  while (activeHeavyMediaJobs < HEAVY_MEDIA_MAX_CONCURRENCY && heavyMediaQueue.length > 0) {
    sortHeavyMediaQueue();
    const nextJob = heavyMediaQueue.shift();
    if (!nextJob) {
      continue;
    }

    nextJob.started = true;
    activeHeavyMediaJobs += 1;

    void nextJob.run()
      .then((value) => {
        nextJob.resolve(value);
      })
      .catch((error) => {
        console.warn(`[HeavyMedia] Job failed type=${nextJob.type} key=${nextJob.key}:`, error);
        nextJob.reject(error);
      })
      .finally(() => {
        activeHeavyMediaJobs = Math.max(0, activeHeavyMediaJobs - 1);
        heavyMediaJobs.delete(nextJob.key);
        pumpHeavyMediaQueue();
      });
  }
}

export function enqueueHeavyMediaJob<T>(
  key: string,
  type: HeavyMediaJobType,
  priority: HeavyMediaJobPriority,
  run: () => Promise<T>
): Promise<T> {
  const existing = heavyMediaJobs.get(key) as HeavyMediaJob<T> | undefined;
  if (existing) {
    if (!existing.started && getHeavyMediaPriorityRank(priority) < getHeavyMediaPriorityRank(existing.priority)) {
      existing.priority = priority;
      sortHeavyMediaQueue();
    }
    return existing.promise;
  }

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  const job: HeavyMediaJob<T> = {
    key,
    type,
    priority,
    started: false,
    sequence: heavyMediaJobSequence++,
    run,
    promise,
    resolve,
    reject,
  };

  heavyMediaJobs.set(key, job as HeavyMediaJob<unknown>);
  heavyMediaQueue.push(job as HeavyMediaJob<unknown>);
  sortHeavyMediaQueue();
  pumpHeavyMediaQueue();
  return promise;
}

function promoteHeavyMediaJob(key: string): void {
  const existing = heavyMediaJobs.get(key);
  if (!existing || existing.started) {
    return;
  }

  if (existing.priority !== 'interactive') {
    existing.priority = 'interactive';
    sortHeavyMediaQueue();
  }
}

function getChapterProxyJobKey(chapterId: number, assetId: number): string {
  return `chapterProxy:${chapterId}:${assetId}`;
}

function getReverseQuickJobKey(chapterId: number, assetId: number): string {
  return `reverseQuickWarm:${chapterId}:${assetId}`;
}

function getReverseFullJobKey(chapterId: number, assetId: number): string {
  return `reverseFullWarm:${chapterId}:${assetId}`;
}

function getTranscriptionJobKey(chapterId: number): string {
  return `transcription:${chapterId}`;
}

function pumpChapterMediaPrewarmQueue() {
  while (
    activeChapterMediaPrewarmJobs < CHAPTER_MEDIA_PREWARM_MAX_CONCURRENCY &&
    chapterMediaPrewarmQueue.length > 0
  ) {
    const nextJob = chapterMediaPrewarmQueue.shift();
    if (!nextJob) {
      continue;
    }

    activeChapterMediaPrewarmJobs += 1;
    void nextJob()
      .catch((error) => {
        console.warn('[ChapterPrewarm] Job failed:', error);
      })
      .finally(() => {
        activeChapterMediaPrewarmJobs = Math.max(0, activeChapterMediaPrewarmJobs - 1);
        pumpChapterMediaPrewarmQueue();
      });
  }
}

function enqueueChapterMediaPrewarm(job: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    chapterMediaPrewarmQueue.push(async () => {
      try {
        await job();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    pumpChapterMediaPrewarmQueue();
  });
}

async function isChapterReverseProxyPlayable(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full'
): Promise<boolean> {
  const cacheKey = getReverseValidationCacheKey(chapterId, assetId, variant);
  const proxyPath = getChapterReverseProxyPath(chapterId, assetId, variant);
  if (!fs.existsSync(proxyPath)) {
    chapterReverseProxyValidationCache.delete(cacheKey);
    return false;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(proxyPath);
  } catch {
    chapterReverseProxyValidationCache.delete(cacheKey);
    return false;
  }

  const cached = chapterReverseProxyValidationCache.get(cacheKey);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.valid;
  }

  let valid = false;
  try {
    const metadata = await getVideoMetadata(proxyPath, 5000);
    valid = Number.isFinite(metadata.duration) && metadata.duration > 0.01;
  } catch {
    valid = false;
  }

  chapterReverseProxyValidationCache.set(cacheKey, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    valid,
  });
  return valid;
}

function invalidateChapterReverseProxyVariant(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant
): void {
  const cacheKey = getReverseValidationCacheKey(chapterId, assetId, variant);
  const proxyPath = getChapterReverseProxyPath(chapterId, assetId, variant);
  const tempPath = getChapterReverseProxyTempPath(chapterId, assetId, variant);
  const legacyTempPath = `${proxyPath}.partial`;
  chapterReverseProxyValidationCache.delete(cacheKey);

  if (fs.existsSync(proxyPath)) {
    try {
      fs.unlinkSync(proxyPath);
    } catch (error) {
      console.warn(
        `[ReverseProxy] Failed deleting ${variant} cache chapter=${chapterId} asset=${assetId}:`,
        error
      );
    }
  }

  if (fs.existsSync(tempPath)) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore stale partial cleanup errors.
    }
  }

  if (variant === 'full' && fs.existsSync(legacyTempPath)) {
    try {
      fs.unlinkSync(legacyTempPath);
    } catch {
      // Ignore stale legacy partial cleanup errors.
    }
  }
}

async function ensureChapterReverseProxyCacheValid(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full'
): Promise<boolean> {
  const proxyPath = getChapterReverseProxyPath(chapterId, assetId, variant);
  if (!fs.existsSync(proxyPath)) {
    return false;
  }

  const isPlayable = await isChapterReverseProxyPlayable(chapterId, assetId, variant);
  if (isPlayable) {
    return true;
  }

  console.warn(
    `[ReverseProxy] Invalid cached ${variant} reverse preview detected, rebuilding chapter=${chapterId} asset=${assetId}`
  );
  invalidateChapterReverseProxyVariant(chapterId, assetId, variant);
  return false;
}

function clearChapterReverseProxyBackgroundTimer(lockKey: string): void {
  const timer = chapterReverseProxyBackgroundTimers.get(lockKey);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  chapterReverseProxyBackgroundTimers.delete(lockKey);
}

export function scheduleChapterReverseProxyFullWarm(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  proxyOptions?: ProxyOptions,
  delayMs = 12000
): void {
  if (asset.file_type !== 'video') {
    return;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const currentEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  const inFlight = chapterReverseProxyGenerationLocks.get(lockKey);
  if (
    (inFlight && inFlight.epoch === currentEpoch)
    || chapterReverseProxyBackgroundTimers.has(lockKey)
  ) {
    return;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);

  const timer = setTimeout(() => {
    chapterReverseProxyBackgroundTimers.delete(lockKey);
    void ensureChapterReverseProxyFullReady(
      chapter,
      asset,
      normalizedProxyOptions,
      'background'
    ).catch((error) => {
      console.warn(
        `[ReverseProxy] Failed background full warm chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
    });
  }, Math.max(0, delayMs));

  chapterReverseProxyBackgroundTimers.set(lockKey, timer);
}

export async function getChapterReverseProxyStatus(chapterId: number, assetId: number): Promise<ChapterReverseProxyStatusPayload> {
  const lockKey = `${chapterId}:${assetId}`;
  const currentEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);

  if (await ensureChapterReverseProxyCacheValid(chapterId, assetId, 'full')) {
    chapterReverseProxyErrors.delete(lockKey);
    return {
      status: 'ready',
      url: getChapterReverseProxyUrl(chapterId, assetId, 'full'),
      quality: 'full',
      isFinal: true,
    };
  }

  if (await ensureChapterReverseProxyCacheValid(chapterId, assetId, 'quick')) {
    chapterReverseProxyErrors.delete(lockKey);
    return {
      status: 'ready',
      url: getChapterReverseProxyUrl(chapterId, assetId, 'quick'),
      quality: 'quick',
      isFinal: false,
    };
  }

  const quickLock = chapterReverseProxyQuickGenerationLocks.get(lockKey);
  const fullLock = chapterReverseProxyGenerationLocks.get(lockKey);
  if (
    (quickLock && quickLock.epoch === currentEpoch)
    || (fullLock && fullLock.epoch === currentEpoch)
  ) {
    return { status: 'generating' };
  }

  const error = chapterReverseProxyErrors.get(lockKey);
  if (error) {
    return {
      status: 'error',
      error,
    };
  }

  return { status: 'missing' };
}

export function invalidateChapterReverseProxy(chapterId: number, assetId: number): void {
  const lockKey = `${chapterId}:${assetId}`;
  bumpGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  chapterReverseProxyErrors.delete(lockKey);
  reverseQuickExecutionModes.delete(lockKey);
  clearChapterReverseProxyBackgroundTimer(lockKey);
  invalidateChapterReverseProxyVariant(chapterId, assetId, 'full');
  invalidateChapterReverseProxyVariant(chapterId, assetId, 'quick');
}

export async function ensureChapterReverseProxyQuickReady(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  proxyOptions?: ProxyOptions,
  options: {
    priority?: HeavyMediaJobPriority;
    executionMode?: ReverseProxyExecutionMode;
  } = {}
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const jobKey = getReverseQuickJobKey(chapter.id, asset.id);
  const queuePriority = options.priority ?? 'background';
  const requestedExecutionMode = options.executionMode ?? 'background';
  const currentExecutionMode = reverseQuickExecutionModes.get(lockKey) ?? 'background';
  const nextExecutionMode =
    requestedExecutionMode === 'interactive' || currentExecutionMode === 'interactive'
      ? 'interactive'
      : 'background';
  reverseQuickExecutionModes.set(lockKey, nextExecutionMode);
  if (queuePriority === 'interactive') {
    promoteHeavyMediaJob(jobKey);
  }

  const generationEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  const inFlight = chapterReverseProxyQuickGenerationLocks.get(lockKey);
  if (inFlight && inFlight.epoch === generationEpoch) {
    return inFlight.promise;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);

  const task = (async () => {
    const fullProxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'full');
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
      chapterReverseProxyErrors.delete(lockKey);
      return fullProxyPath;
    }

    const quickProxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'quick');
    const quickTempPath = getChapterReverseProxyTempPath(chapter.id, asset.id, 'quick', generationEpoch);
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'quick')) {
      chapterReverseProxyErrors.delete(lockKey);
      return quickProxyPath;
    }

    try {
      await enqueueHeavyMediaJob(jobKey, 'reverseQuickWarm', queuePriority, async () => {
        if (fs.existsSync(quickTempPath)) {
          try {
            fs.unlinkSync(quickTempPath);
          } catch {
            // Ignore stale temp cleanup errors.
          }
        }

        let inputPath = asset.file_path;
        let inputStartTime = chapter.start_time;
        let inputEndTime = chapter.end_time;
        let fps = 10;

        let chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
        chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
        const reusableChapterProxy = getReusableChapterProxy(chapterProxy, chapter);
        if (reusableChapterProxy) {
          try {
            const chapterProxyMetadata = await getVideoMetadata(reusableChapterProxy.file_path, 5000);
            if (chapterProxyMetadata.duration > 0.1) {
              const chapterDuration = Math.max(0.1, chapter.end_time - chapter.start_time);
              inputPath = reusableChapterProxy.file_path;
              inputStartTime = 0;
              inputEndTime = Math.min(chapterProxyMetadata.duration, chapterDuration);
              fps = Math.max(5, Math.min(10, Math.round(chapterProxyMetadata.fps) || 5));
            }
          } catch {
            // Fallback to source media if chapter proxy metadata lookup fails.
          }
        }

        const executionMode = reverseQuickExecutionModes.get(lockKey) ?? requestedExecutionMode;
        await generateChapterReverseProxy(inputPath, quickTempPath, {
          startTime: inputStartTime,
          endTime: inputEndTime,
          fps,
          encodingMode: normalizedProxyOptions.encodingMode,
          quality: normalizedProxyOptions.quality,
          chunkDurationSec: 45,
          maxParallelChunks: executionMode === 'interactive' ? 2 : 1,
          executionMode,
        });
      });

      if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) !== generationEpoch) {
        deleteFileIfExists(quickTempPath, 'ReverseProxy');
        return undefined;
      }

      if (fs.existsSync(quickProxyPath)) {
        fs.unlinkSync(quickProxyPath);
      }

      fs.renameSync(quickTempPath, quickProxyPath);

      if (!(await isChapterReverseProxyPlayable(chapter.id, asset.id, 'quick'))) {
        throw new Error('Generated quick reverse preview is not playable');
      }

      chapterReverseProxyErrors.delete(lockKey);
      return quickProxyPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deleteFileIfExists(quickTempPath, 'ReverseProxy');
      if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) === generationEpoch) {
        invalidateChapterReverseProxyVariant(chapter.id, asset.id, 'quick');
        chapterReverseProxyErrors.set(lockKey, message);
      }
      console.warn(
        `[ReverseProxy] Failed generating quick reverse chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }
  })();

  chapterReverseProxyQuickGenerationLocks.set(lockKey, { epoch: generationEpoch, promise: task });
  try {
    return await task;
  } finally {
    const currentLock = chapterReverseProxyQuickGenerationLocks.get(lockKey);
    if (currentLock?.promise === task) {
      chapterReverseProxyQuickGenerationLocks.delete(lockKey);
    }
    reverseQuickExecutionModes.delete(lockKey);
  }
}

async function ensureChapterReverseProxyFullReady(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  proxyOptions?: ProxyOptions,
  priority: HeavyMediaJobPriority = 'background'
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const jobKey = getReverseFullJobKey(chapter.id, asset.id);
  clearChapterReverseProxyBackgroundTimer(lockKey);

  const generationEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  const inFlight = chapterReverseProxyGenerationLocks.get(lockKey);
  if (inFlight && inFlight.epoch === generationEpoch) {
    if (priority === 'interactive') {
      promoteHeavyMediaJob(jobKey);
    }
    return inFlight.promise;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);

  const task = (async () => {
    const proxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'full');
    const tempPath = getChapterReverseProxyTempPath(chapter.id, asset.id, 'full', generationEpoch);
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
      chapterReverseProxyErrors.delete(lockKey);
      return proxyPath;
    }

    let generatedPath: string | undefined;

    try {
      await enqueueHeavyMediaJob(jobKey, 'reverseFullWarm', priority, async () => {
        if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
          generatedPath = proxyPath;
          chapterReverseProxyErrors.delete(lockKey);
          return;
        }

        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // Ignore stale temp cleanup errors.
          }
        }

        await generateChapterReverseProxy(asset.file_path, tempPath, {
          startTime: chapter.start_time,
          endTime: chapter.end_time,
          fps: 15,
          encodingMode: normalizedProxyOptions.encodingMode,
          quality: normalizedProxyOptions.quality,
          chunkDurationSec: 11,
          maxParallelChunks: 1,
          executionMode: 'background',
        });

        if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) !== generationEpoch) {
          deleteFileIfExists(tempPath, 'ReverseProxy');
          return;
        }

        if (fs.existsSync(proxyPath)) {
          fs.unlinkSync(proxyPath);
        }

        fs.renameSync(tempPath, proxyPath);

        if (!(await isChapterReverseProxyPlayable(chapter.id, asset.id, 'full'))) {
          throw new Error('Generated reverse preview is not playable');
        }

        generatedPath = proxyPath;
        chapterReverseProxyErrors.delete(lockKey);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deleteFileIfExists(tempPath, 'ReverseProxy');
      if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) === generationEpoch) {
        invalidateChapterReverseProxyVariant(chapter.id, asset.id, 'full');
        chapterReverseProxyErrors.set(lockKey, message);
      }
      console.warn(
        `[ReverseProxy] Failed generating chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }

    return generatedPath;
  })();

  chapterReverseProxyGenerationLocks.set(lockKey, { epoch: generationEpoch, promise: task });
  try {
    return await task;
  } finally {
    const currentLock = chapterReverseProxyGenerationLocks.get(lockKey);
    if (currentLock?.promise === task) {
      chapterReverseProxyGenerationLocks.delete(lockKey);
    }
  }
}

export async function ensureChapterProxyReady(
  chapter: ChapterRecord,
  asset: Asset,
  encodingMode: 'cpu' | 'gpu' | 'auto' = 'auto',
  quality: 'high' | 'balanced' | 'fast' = 'balanced',
  priority: HeavyMediaJobPriority = 'interactive'
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const jobKey = getChapterProxyJobKey(chapter.id, asset.id);
  const generationEpoch = getGenerationEpoch(chapterProxyGenerationEpochs, lockKey);
  const inFlight = chapterProxyGenerationLocks.get(lockKey);
  if (inFlight && inFlight.epoch === generationEpoch) {
    if (priority === 'interactive') {
      promoteHeavyMediaJob(jobKey);
    }
    return inFlight.promise;
  }

  const task = (async () => {
    const existing = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    const reusableExisting = getReusableChapterProxy(existing, chapter);
    if (reusableExisting) {
      return reusableExisting.file_path;
    }

    const recovered = await recoverChapterProxyIfCurrent(existing, chapter);
    const reusableRecovered = getReusableChapterProxy(recovered, chapter);
    if (reusableRecovered) {
      return reusableRecovered.file_path;
    }

    const proxyPath = existing?.file_path || getChapterProxyPath(chapter.id, asset.id);
    const tempPath = getChapterProxyTempPath(chapter.id, asset.id, generationEpoch);

    let chapterProxyId = existing?.id ?? null;
    if (chapterProxyId === null) {
      const created = await createChapterProxy({
        chapter_id: chapter.id,
        asset_id: asset.id,
        file_path: proxyPath,
        preset: 'ai_analysis_chapter',
        start_time: chapter.start_time,
        end_time: chapter.end_time,
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        status: 'generating',
        error_message: null,
      });
      chapterProxyId = created.id;
    } else {
      if (!existing) {
        throw new Error(`Expected existing chapter proxy for chapter=${chapter.id} asset=${asset.id}`);
      }

      deleteFileIfExists(existing.file_path, 'ChapterProxy');
      await updateChapterProxyDefinition(chapterProxyId, {
        file_path: proxyPath,
        start_time: chapter.start_time,
        end_time: chapter.end_time,
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        status: 'pending',
        error_message: null,
      });
    }

    try {
      await enqueueHeavyMediaJob(jobKey, 'chapterProxy', priority, async () => {
        deleteFileIfExists(tempPath, 'ChapterProxy');
        await updateChapterProxyStatus(chapterProxyId, 'generating');

        const metadata = await generateAIProxy(
          asset.file_path,
          tempPath,
          undefined,
          undefined,
          encodingMode,
          quality,
          {
            startTime: chapter.start_time,
            endTime: chapter.end_time,
          }
        );

        if (getGenerationEpoch(chapterProxyGenerationEpochs, lockKey) !== generationEpoch) {
          deleteFileIfExists(tempPath, 'ChapterProxy');
          return;
        }

        deleteFileIfExists(proxyPath, 'ChapterProxy');
        fs.renameSync(tempPath, proxyPath);

        await updateChapterProxyMetadata(chapterProxyId, {
          width: metadata.width,
          height: metadata.height,
          framerate: metadata.framerate,
          file_size: metadata.fileSize,
          duration: metadata.duration,
        });
        await updateChapterProxyStatus(chapterProxyId, 'ready');
      });

      if (getGenerationEpoch(chapterProxyGenerationEpochs, lockKey) !== generationEpoch) {
        deleteFileIfExists(tempPath, 'ChapterProxy');
        return undefined;
      }

      return proxyPath;
    } catch (error) {
      deleteFileIfExists(tempPath, 'ChapterProxy');
      if (getGenerationEpoch(chapterProxyGenerationEpochs, lockKey) === generationEpoch) {
        await updateChapterProxyStatus(
          chapterProxyId,
          'error',
          error instanceof Error ? error.message : String(error)
        );
      }
      console.warn(
        `[ChapterProxy] Failed generating chapter proxy chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }
  })();

  chapterProxyGenerationLocks.set(lockKey, { epoch: generationEpoch, promise: task });
  try {
    return await task;
  } finally {
    const currentLock = chapterProxyGenerationLocks.get(lockKey);
    if (currentLock?.promise === task) {
      chapterProxyGenerationLocks.delete(lockKey);
    }
  }
}

function getGroundingStatusMessage(
  status: AgentGroundingStatusData['status']
): string {
  switch (status) {
    case 'missing_video_asset':
      return 'This chapter has no linked video asset. Agent chat requires video grounding and is locked.';
    case 'error':
      return 'Video proxy failed to build. Agent chat is locked until grounding is available.';
    case 'ready':
      return 'Video grounding is ready.';
    case 'idle':
      return '';
    case 'generating':
    default:
      return 'Video proxy is still preparing. Agent chat is locked until grounding is ready.';
  }
}

export async function getAgentGroundingStatus(
  projectId: number,
  chapterId: number,
  options?: {
    ensureReady?: boolean;
    proxyOptions?: ProxyOptions;
  }
): Promise<AgentGroundingStatusData> {
  const chapter = await getChapter(chapterId);
  if (!chapter) {
    throw new Error(`Chapter not found: ${chapterId}`);
  }
  if (chapter.project_id !== projectId) {
    throw new Error(`Chapter ${chapterId} does not belong to project ${projectId}`);
  }

  const [projectAssets, chapterAssetIds] = await Promise.all([
    getAssetsByProject(projectId),
    getAssetsForChapter(chapter.id),
  ]);
  const chapterAssetSet = new Set(chapterAssetIds);
  const chapterVideoAssets = projectAssets.filter(
    (asset) => chapterAssetSet.has(asset.id) && asset.file_type === 'video'
  );

  if (chapterVideoAssets.length === 0) {
    return {
      status: 'missing_video_asset',
      requiredVideoAssetCount: 0,
      readyVideoAssetCount: 0,
      assets: [],
      message: getGroundingStatusMessage('missing_video_asset'),
    };
  }

  const assets: AgentGroundingStatusData['assets'] = [];
  let readyVideoAssetCount = 0;
  let hasError = false;
  let hasGenerating = false;

  for (const asset of chapterVideoAssets) {
    let chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
    let reusableChapterProxy = getReusableChapterProxy(chapterProxy, chapter);

    if (reusableChapterProxy) {
      readyVideoAssetCount += 1;
      assets.push({
        assetId: asset.id,
        status: 'ready',
      });
      continue;
    }

    if (!asset.file_path || !fs.existsSync(asset.file_path)) {
      hasError = true;
      assets.push({
        assetId: asset.id,
        status: 'error',
        error: 'Source media file is missing.',
      });
      continue;
    }

    if (options?.ensureReady) {
      const normalizedProxyOptions = normalizeProxyOptions(options.proxyOptions);
      await ensureChapterProxyReady(
        chapter,
        asset,
        normalizedProxyOptions.encodingMode,
        normalizedProxyOptions.quality,
        'interactive'
      );
      chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
      chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
      reusableChapterProxy = getReusableChapterProxy(chapterProxy, chapter);
    }

    if (reusableChapterProxy) {
      readyVideoAssetCount += 1;
      assets.push({
        assetId: asset.id,
        status: 'ready',
      });
      continue;
    }

    if (chapterProxy?.status === 'error') {
      hasError = true;
      assets.push({
        assetId: asset.id,
        status: 'error',
        error: chapterProxy.error_message ?? 'Video proxy generation failed.',
      });
      continue;
    }

    hasGenerating = true;
    assets.push({
      assetId: asset.id,
      status: 'generating',
    });
  }

  const status: AgentGroundingStatusData['status'] = hasError
    ? 'error'
    : readyVideoAssetCount === chapterVideoAssets.length
      ? 'ready'
      : hasGenerating
        ? 'generating'
        : 'error';

  return {
    status,
    requiredVideoAssetCount: chapterVideoAssets.length,
    readyVideoAssetCount,
    assets,
    message: getGroundingStatusMessage(status),
  };
}

export async function invalidateChapterProxy(
  chapterId: number,
  assetId: number,
  bounds?: { startTime?: number; endTime?: number }
): Promise<void> {
  const lockKey = `${chapterId}:${assetId}`;
  bumpGenerationEpoch(chapterProxyGenerationEpochs, lockKey);

  const existing = await getChapterProxyByChapterAsset(chapterId, assetId);
  if (!existing) {
    return;
  }

  deleteFileIfExists(existing.file_path, 'ChapterProxy');
  await updateChapterProxyDefinition(existing.id, {
    file_path: existing.file_path || getChapterProxyPath(chapterId, assetId),
    start_time: bounds?.startTime ?? existing.start_time,
    end_time: bounds?.endTime ?? existing.end_time,
    width: null,
    height: null,
    framerate: null,
    file_size: null,
    duration: null,
    status: 'pending',
    error_message: null,
  });
}

async function ensureAssetMixWaveformReady(asset: Asset): Promise<void> {
  if (!isAudiowaveformAvailable()) {
    return;
  }

  const lockKey = `${asset.id}:-1`;
  const inFlight = chapterWaveformPrewarmLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    if (!asset.file_path || !fs.existsSync(asset.file_path)) {
      return;
    }

    const existingTier1 = await getWaveform(asset.id, -1, 1);
    if (existingTier1) {
      return;
    }

    const isMkv = path.extname(asset.file_path).toLowerCase() === '.mkv';
    if (isMkv) {
      await generateWaveformTiersForMkvTracks(asset.file_path, asset.id, undefined, {
        includeTier2: false,
        playbackActive: false,
        trackIndices: [-1],
        maxParallelTracks: 1,
      });
      return;
    }

    await generateWaveformTiers(asset.file_path, asset.id, -1, undefined, {
      includeTier2: false,
    });
  })();

  chapterWaveformPrewarmLocks.set(lockKey, task);
  try {
    await task;
  } finally {
    chapterWaveformPrewarmLocks.delete(lockKey);
  }
}

async function prewarmChapterMedia(
  chapterId: number,
  assetId: number,
  proxyOptions?: ProxyOptions
): Promise<void> {
  const [chapter, asset] = await Promise.all([
    getChapter(chapterId),
    getAsset(assetId),
  ]);

  if (!chapter || !asset) {
    return;
  }

  if (!asset.file_path || !fs.existsSync(asset.file_path)) {
    console.warn(`[ChapterPrewarm] Asset file missing for chapter=${chapterId} asset=${assetId}`);
    return;
  }

  const chapterAssetIds = await getAssetsForChapter(chapter.id);
  if (!chapterAssetIds.includes(asset.id)) {
    return;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);
  if (asset.file_type === 'video') {
    try {
      await ensureChapterProxyReady(
        chapter,
        asset,
        normalizedProxyOptions.encodingMode,
        normalizedProxyOptions.quality,
        'background'
      );
    } catch (error) {
      console.warn(`[ChapterPrewarm] Failed chapter proxy chapter=${chapter.id} asset=${asset.id}:`, error);
    }
  }

  try {
    await ensureAssetMixWaveformReady(asset);
  } catch (error) {
    console.warn(`[ChapterPrewarm] Failed waveform chapter=${chapter.id} asset=${asset.id}:`, error);
  }
}

export function scheduleChapterMediaPrewarm(
  chapterId: number,
  assetId: number,
  proxyOptions?: ProxyOptions
): Promise<void> {
  const lockKey = `${chapterId}:${assetId}`;
  const inFlight = chapterMediaPrewarmLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = enqueueChapterMediaPrewarm(async () => {
    await prewarmChapterMedia(chapterId, assetId, proxyOptions);
  });

  chapterMediaPrewarmLocks.set(lockKey, task);
  return task.finally(() => {
    chapterMediaPrewarmLocks.delete(lockKey);
  });
}

export function queueChapterTranscription<T>(
  chapterId: number,
  priority: HeavyMediaJobPriority,
  run: () => Promise<T>
): Promise<T> {
  return enqueueHeavyMediaJob(getTranscriptionJobKey(chapterId), 'transcription', priority, run);
}

function clipOverlapsChapter(clip: Clip, chapterStart: number, chapterEnd: number): boolean {
  const duration = clip.out_point - clip.in_point;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const clipStart = clip.start_time;
  const clipEnd = clip.start_time + duration;
  return clipEnd > chapterStart && clipStart < chapterEnd;
}

export async function buildAgentChatContext(
  projectId: number,
  chapterId?: number,
  options?: {
    detailedTranscripts?: DetailedTranscriptWindow[];
    ensureChapterProxyReady?: boolean;
    proxyOptions?: ProxyOptions;
  }
) {
  const detailedTranscripts = options?.detailedTranscripts ?? [];
  const projectAssets = await getAssetsByProject(projectId);
  const projectClips = await getClipsByProject(projectId);

  if (!chapterId) {
    return {
      chapter: undefined,
      chapterAssetIds: [] as number[],
      chapterClips: [] as Array<{
        id: number;
        assetId: number;
        trackIndex: number;
        startTime: number;
        inPoint: number;
        outPoint: number;
        role: string | null;
        description: string | null;
        isEssential: boolean;
      }>,
      transcript: '',
      detailedTranscripts,
      videoAnalysisAssets: [] as Array<{ assetId: number; proxyPath: string }>,
    };
  }

  const chapter = await getChapter(chapterId);
  if (!chapter) {
    throw new Error(`Chapter not found: ${chapterId}`);
  }
  if (chapter.project_id !== projectId) {
    throw new Error(`Chapter ${chapterId} does not belong to project ${projectId}`);
  }

  const chapterAssetIds = await getAssetsForChapter(chapter.id);
  const chapterAssetSet = new Set(chapterAssetIds);
  const chapterAssets = projectAssets.filter((asset) => chapterAssetSet.has(asset.id));
  const chapterClips = projectClips
    .filter((clip) => chapterAssetSet.has(clip.asset_id))
    .filter((clip) => clipOverlapsChapter(clip, chapter.start_time, chapter.end_time))
    .map((clip) => ({
      id: clip.id,
      assetId: clip.asset_id,
      trackIndex: clip.track_index,
      startTime: clip.start_time,
      inPoint: clip.in_point,
      outPoint: clip.out_point,
      role: clip.role,
      description: clip.description,
      isEssential: clip.is_essential,
    }));

  const transcriptSegments = await getTranscriptsByChapter(chapter.id);
  const transcript = formatOverviewTranscript(
    transcriptSegments,
    chapter.start_time,
    chapter.end_time
  );

  const videoAnalysisAssets: Array<{ assetId: number; proxyPath: string }> = [];
  for (const asset of chapterAssets.filter((candidate) => candidate.file_type === 'video')) {
    let chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
    let reusableChapterProxy = getReusableChapterProxy(chapterProxy, chapter);

    if (!reusableChapterProxy && options?.ensureChapterProxyReady) {
      const normalizedProxyOptions = normalizeProxyOptions(options.proxyOptions);
      await ensureChapterProxyReady(
        chapter,
        asset,
        normalizedProxyOptions.encodingMode,
        normalizedProxyOptions.quality,
        'interactive'
      );
      chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
      chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
      reusableChapterProxy = getReusableChapterProxy(chapterProxy, chapter);
    }

    if (reusableChapterProxy) {
      videoAnalysisAssets.push({
        assetId: asset.id,
        proxyPath: reusableChapterProxy.file_path,
      });
    }
  }

  return {
    chapter: {
      id: String(chapter.id),
      title: chapter.title,
      startTime: chapter.start_time,
      endTime: chapter.end_time,
    },
    chapterAssetIds,
    chapterClips,
    transcript,
    detailedTranscripts,
    videoAnalysisAssets,
  };
}
