import { ipcMain, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IPC_CHANNELS, IPC_ERROR_CODES, type IPCErrorCode } from './channels.js';
import {
  createProject,
  getProject,
  listProjects,
  deleteProject,
  updateProject,
  createAsset,
  getAsset,
  getAssetsByProject,
  deleteAsset,
  createChapter,
  getChapter,
  getChaptersByProject,
  updateChapter,
  deleteChapter,
  addAssetToChapter,
  removeAssetFromChapter,
  getAssetsForChapter,
  replaceTranscripts,
  getTranscriptsByChapter,
  deleteTranscriptsByChapter,
  getDetailedTranscriptWindow,
  upsertDetailedTranscript,
  deleteDetailedTranscriptsByChapter,
  createClip,
  getClip,
  getClipsByProject,
  getClipsByAsset,
  updateClip,
  deleteClip,
  batchUpdateClips,
  saveTimelineState,
  loadTimelineState,
  updateTimelineState,
  saveWaveform,
  getWaveform,
  createChatConversation,
  getChatConversation,
  getChatConversationsByChapter,
  updateChatConversation,
  deleteChatConversation,
  createChatMessage,
  getChatMessagesByConversation,
  createProxy,
  updateProxyStatus,
  updateProxyMetadata,
  getProxyByAsset,
  createChapterProxy,
  getChapterProxyByChapterAsset,
  updateChapterProxyStatus,
  updateChapterProxyMetadata,
  createSuggestion,
  getSuggestion,
  getSuggestionsByConversation,
  applySuggestionWithClip,
  previewSuggestionWithClip,
  cancelSuggestionPreview,
  rejectSuggestion,
} from '../database/db.js';
import { generateWaveformTiers, generateWaveformTiersForMkvTracks, WaveformError } from '../../pipeline/waveform.js';
import { getAgentBridge } from '../agent-bridge.js';
import {
  getVideoMetadata,
  isValidVideo,
  extractAudio,
  FFmpegError,
  generateAIProxy,
  generateChapterReverseProxy,
} from '../../pipeline/ffmpeg.js';
import { transcribe, WhisperError, getWhisperRuntimeStatus } from '../../pipeline/whisper.js';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import { generateFCPXML, generateJSON, generateEDL } from '../../pipeline/export/index.js';
import type { Asset, AssetMetadata, Clip, DetailedTranscript, ExecutionTraceEntry, Suggestion } from '../../shared/types/database.js';
import type { AgentChatData, AgentStreamEvent, TimelineAction } from '../../shared/types/agent-ipc.js';
import {
  parseStructuredAssistantPreview,
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from '../../shared/utils/assistant-content.js';
import {
  appendExecutionTraceEntry,
  serializeExecutionTrace,
} from '../../shared/utils/execution-trace.js';
import type { ExportFormat } from '../../pipeline/export/index.js';

// Helper to create consistent error responses
function createErrorResponse(error: unknown, code: IPCErrorCode = IPC_ERROR_CODES.UNKNOWN_ERROR) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[IPC Error] ${code}: ${message}`, error);
  return {
    success: false as const,
    error: message,
    code,
  };
}

// Helper to create success responses
function createSuccessResponse<T>(data: T) {
  return {
    success: true as const,
    data,
  };
}

const SETTINGS_SAFE_PREFIX = 'safe:';
const SETTINGS_PLAINTEXT_PREFIX = 'plain:';

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

function encryptSettingsPayload(text: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(text).toString('base64');
    return `${SETTINGS_SAFE_PREFIX}${encrypted}`;
  }

  console.warn('[Settings] safeStorage unavailable; using local plaintext fallback for API key storage.');
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return `${SETTINGS_PLAINTEXT_PREFIX}${encoded}`;
}

function decryptSettingsPayload(encrypted: string): string {
  if (encrypted.startsWith(SETTINGS_SAFE_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('System encryption is not available to decrypt saved settings. Re-enter API keys.');
    }

    const payload = encrypted.slice(SETTINGS_SAFE_PREFIX.length);
    const buffer = Buffer.from(payload, 'base64');
    return safeStorage.decryptString(buffer);
  }

  if (encrypted.startsWith(SETTINGS_PLAINTEXT_PREFIX)) {
    const payload = encrypted.slice(SETTINGS_PLAINTEXT_PREFIX.length);
    return Buffer.from(payload, 'base64').toString('utf8');
  }

  // Backward compatibility with legacy base64-only payloads.
  const buffer = Buffer.from(encrypted, 'base64');

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buffer);
    } catch {
      const decoded = buffer.toString('utf8');
      if (looksLikeJson(decoded)) {
        return decoded;
      }
      throw new Error('Unable to decrypt saved settings payload. Re-enter API keys.');
    }
  }

  const decoded = buffer.toString('utf8');
  if (looksLikeJson(decoded)) {
    return decoded;
  }

  throw new Error('System encryption is not available to decrypt saved settings. Re-enter API keys.');
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTranscriptionModel(value: unknown): 'tiny' | 'base' | 'small' | 'medium' {
  if (value === 'tiny' || value === 'base' || value === 'small' || value === 'medium') {
    return value;
  }
  return 'base';
}

function normalizeComputeType(value: unknown): 'int8' | 'float16' {
  if (value === 'int8' || value === 'float16') {
    return value;
  }
  return 'int8';
}

function sanitizeSuggestedClipName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/^"+|"+$/g, '')
    .trim();
  if (normalized.length < 3) return null;
  return normalized.slice(0, 80);
}

function extractOpenAITextPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const outputText = sanitizeSuggestedClipName(record.output_text);
  if (outputText) return outputText;

  const output = record.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const itemRecord = item as Record<string, unknown>;
      const content = itemRecord.content;
      if (!Array.isArray(content)) continue;
      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        const text = sanitizeSuggestedClipName((contentItem as Record<string, unknown>).text);
        if (text) return text;
      }
    }
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (first && typeof first === 'object') {
      const message = (first as Record<string, unknown>).message;
      if (message && typeof message === 'object') {
        const content = sanitizeSuggestedClipName((message as Record<string, unknown>).content);
        if (content) return content;
      }
    }
  }

  return null;
}

function buildTranscriptExcerpt(
  transcripts: Array<{ text: string; start_time: number; end_time: number }>,
  inPoint: number,
  outPoint: number
): string {
  const overlapEpsilon = 0.001;
  const snippets: string[] = [];

  for (const transcript of transcripts) {
    if (!transcript || typeof transcript.text !== 'string') continue;
    const start = transcript.start_time;
    const end = transcript.end_time;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= inPoint + overlapEpsilon || start >= outPoint - overlapEpsilon) continue;
    const text = transcript.text.trim();
    if (!text) continue;
    snippets.push(text);
    if (snippets.join(' ').length > 1200) {
      break;
    }
  }

  return snippets.join(' ').slice(0, 1200);
}

async function requestOpenAIClipName(input: {
  apiKey: string;
  model: string;
  chapterTitle: string;
  inPoint: number;
  outPoint: number;
  transcriptExcerpt: string;
}): Promise<string | null> {
  const { apiKey, model, chapterTitle, inPoint, outPoint, transcriptExcerpt } = input;

  if (typeof fetch !== 'function') {
    throw new Error('Fetch API is not available in main process');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_output_tokens: 24,
      input: [
        {
          role: 'system',
          content:
            'You name short video clips for editors. Return only one concise 3-7 word title. No quotes, no trailing punctuation, no labels.',
        },
        {
          role: 'user',
          content: [
            `Chapter title: ${chapterTitle || 'Untitled chapter'}`,
            `Clip local time range: ${inPoint.toFixed(2)}s to ${outPoint.toFixed(2)}s`,
            transcriptExcerpt
              ? `Transcript excerpt: ${transcriptExcerpt}`
              : 'Transcript excerpt: (none)',
            'Return title only.',
          ].join('\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${message.slice(0, 200)}`);
  }

  const payload = await response.json();
  return extractOpenAITextPayload(payload);
}

function clipOverlapsChapter(clip: Clip, chapterStart: number, chapterEnd: number): boolean {
  const duration = clip.out_point - clip.in_point;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const clipStart = clip.start_time;
  const clipEnd = clip.start_time + duration;
  return clipEnd > chapterStart && clipStart < chapterEnd;
}

const VIDEO_INTENT_KEYWORDS = [
  'watch',
  'video',
  'visual',
  'see',
  'look',
  'analyze video',
  "what's in the video",
  'what happens',
  'show me',
  'review video',
];

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

function applyNearLimitTokenGuard(
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

const hydratedConversationIds = new Set<number>();
const chapterProxyGenerationLocks = new Map<string, Promise<string | undefined>>();
const chapterReverseProxyGenerationLocks = new Map<string, Promise<string | undefined>>();
const chapterReverseProxyQuickGenerationLocks = new Map<string, Promise<string | undefined>>();
const chapterReverseProxyBackgroundTimers = new Map<string, NodeJS.Timeout>();
const chapterReverseProxyErrors = new Map<string, string>();
const chapterReverseProxyValidationCache = new Map<string, { mtimeMs: number; size: number; valid: boolean }>();
const chapterReverseProxyQueue: Array<() => Promise<void>> = [];
const CHAPTER_REVERSE_PROXY_MAX_CONCURRENCY = 1;
let activeChapterReverseProxyJobs = 0;
const chapterWaveformPrewarmLocks = new Map<string, Promise<void>>();
const chapterMediaPrewarmLocks = new Map<string, Promise<void>>();
const chapterMediaPrewarmQueue: Array<() => Promise<void>> = [];
const CHAPTER_MEDIA_PREWARM_MAX_CONCURRENCY = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2)));
let activeChapterMediaPrewarmJobs = 0;

function pumpChapterReverseProxyQueue() {
  while (
    activeChapterReverseProxyJobs < CHAPTER_REVERSE_PROXY_MAX_CONCURRENCY &&
    chapterReverseProxyQueue.length > 0
  ) {
    const nextJob = chapterReverseProxyQueue.shift();
    if (!nextJob) {
      continue;
    }

    activeChapterReverseProxyJobs += 1;
    void nextJob()
      .catch((error) => {
        console.warn('[ReverseProxy] Job failed:', error);
      })
      .finally(() => {
        activeChapterReverseProxyJobs = Math.max(0, activeChapterReverseProxyJobs - 1);
        pumpChapterReverseProxyQueue();
      });
  }
}

function enqueueChapterReverseProxy(job: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    chapterReverseProxyQueue.push(async () => {
      try {
        await job();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    pumpChapterReverseProxyQueue();
  });
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

function hasVideoIntent(content: string): boolean {
  const normalized = content.toLowerCase();
  return VIDEO_INTENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function deriveConversationTitle(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'New conversation';
  }
  if (normalized.length <= 64) {
    return normalized;
  }
  return `${normalized.slice(0, 61)}...`;
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

interface HiddenReasoningChunk {
  passIndex: number;
  nodeName: string;
  content: string;
}

function appendHiddenReasoningChunk(
  chunks: HiddenReasoningChunk[],
  event: { content: string; nodeName?: string },
  passIndex: number
): HiddenReasoningChunk[] {
  if (!event.content) {
    return chunks;
  }

  const nodeName = event.nodeName || 'unknown';
  const nextChunks = [...chunks];
  const lastChunk = nextChunks[nextChunks.length - 1];

  if (lastChunk && lastChunk.passIndex === passIndex && lastChunk.nodeName === nodeName) {
    lastChunk.content += event.content;
    return nextChunks;
  }

  nextChunks.push({
    passIndex,
    nodeName,
    content: event.content,
  });
  return nextChunks;
}

function serializeHiddenReasoning(chunks: HiddenReasoningChunk[]): string | null {
  const sections = chunks
    .map((chunk) => parseStructuredAssistantPreview(chunk.content).thinkingMarkdown ?? "")
    .filter((chunk) => chunk.length > 0);

  if (sections.length === 0) {
    return null;
  }

  return sections.join('\n\n').trim() || null;
}

function normalizeTimelineActions(value: unknown): TimelineAction[] {
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
        action_type: 'create_clip' as const,
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

function parseAgentGraphResult(
  result: Record<string, unknown>,
  chapterDuration: number | null,
  chapterAssetIds: number[]
): {
  message: string;
  thinkingMarkdown: string | null;
  timelineActions: TimelineAction[];
  suggestionDrafts: PersistableSuggestionDraft[];
  transcriptDetailRequests: TranscriptDetailRequest[];
} {
  const message = extractAssistantMessage(result);
  const thinkingMarkdown = extractThinkingMarkdown(result);
  const timelineActions = normalizeTimelineActions(result.timelineActions);
  const suggestionDrafts = [
    ...normalizeSuggestionDrafts(result.suggestions),
    ...timelineActionsToSuggestionDrafts(timelineActions),
  ];
  const transcriptDetailRequests =
    chapterDuration !== null
      ? normalizeTranscriptDetailRequests(result.transcriptDetailRequests, chapterDuration, chapterAssetIds)
      : [];

  return {
    message,
    thinkingMarkdown,
    timelineActions,
    suggestionDrafts,
    transcriptDetailRequests,
  };
}

function normalizeSuggestionProvider(provider: unknown): 'gemini' | 'kimi' | null {
  return provider === 'gemini' || provider === 'kimi' ? provider : null;
}

function normalizeConversationProvider(
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

async function persistAgentSuggestions(
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

const OVERVIEW_TRANSCRIPT_CHUNK_SECONDS = 15;
const OVERVIEW_TRANSCRIPT_MAX_LINES = 320;
const OVERVIEW_TRANSCRIPT_MAX_CHARS = 30000;
const MAX_DETAILED_TRANSCRIPT_REQUESTS = 3;
const MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS = 90;
const DETAILED_TRANSCRIPT_MODEL = 'small';
const DETAILED_TRANSCRIPT_COMPUTE_TYPE: 'int8' | 'float16' = 'int8';
const DETAILED_TRANSCRIPT_WORD_TIMESTAMPS = true;

interface TranscriptDetailRequest {
  windowStart: number;
  windowEnd: number;
  assetId?: number;
  reason?: string;
}

interface DetailedTranscriptContextWindow {
  assetId: number;
  windowStart: number;
  windowEnd: number;
  reason?: string;
  text: string;
  segments: DetailedTranscript['segments_json'];
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
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

function normalizeTranscriptDetailRequests(
  value: unknown,
  chapterDuration: number,
  chapterAssetIds: number[]
): TranscriptDetailRequest[] {
  if (!Array.isArray(value)) return [];

  const chapterAssetSet = new Set(chapterAssetIds);
  const dedupe = new Set<string>();
  const requests: TranscriptDetailRequest[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;

    const startRaw = typeof record.windowStart === 'number' ? record.windowStart : NaN;
    const endRaw = typeof record.windowEnd === 'number' ? record.windowEnd : NaN;
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) continue;

    const start = clamp(startRaw, 0, chapterDuration);
    let end = clamp(endRaw, 0, chapterDuration);
    if (end <= start) continue;

    if (end - start > MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS) {
      end = Math.min(chapterDuration, start + MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS);
    }

    const normalizedStart = roundSeconds(start);
    const normalizedEnd = roundSeconds(end);
    if (normalizedEnd <= normalizedStart) continue;

    let assetId: number | undefined;
    if (typeof record.assetId === 'number' && Number.isFinite(record.assetId) && chapterAssetSet.has(record.assetId)) {
      assetId = record.assetId;
    }

    const reason =
      typeof record.reason === 'string' && record.reason.trim().length > 0
        ? record.reason.trim().slice(0, 240)
        : undefined;

    const key = `${assetId ?? 'auto'}:${normalizedStart}-${normalizedEnd}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    requests.push({
      windowStart: normalizedStart,
      windowEnd: normalizedEnd,
      assetId,
      reason,
    });

    if (requests.length >= MAX_DETAILED_TRANSCRIPT_REQUESTS) {
      break;
    }
  }

  return requests;
}

function mapDetailedTranscriptForContext(
  detailed: DetailedTranscript,
  reason?: string
): DetailedTranscriptContextWindow {
  return {
    assetId: detailed.asset_id,
    windowStart: detailed.window_start,
    windowEnd: detailed.window_end,
    reason,
    text: detailed.text,
    segments: detailed.segments_json,
  };
}

async function generateDetailedTranscriptsForRequests(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  chapterAssetIds: number[],
  requests: TranscriptDetailRequest[]
): Promise<DetailedTranscriptContextWindow[]> {
  if (requests.length === 0) return [];

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const chapterAssetSet = new Set(chapterAssetIds);
  const windows: DetailedTranscriptContextWindow[] = [];

  for (const request of requests) {
    const assetId = request.assetId ?? chapterAssetIds[0];
    if (!assetId || !chapterAssetSet.has(assetId)) {
      continue;
    }

    const windowStart = roundSeconds(clamp(request.windowStart, 0, chapterDuration));
    const requestedEnd = roundSeconds(clamp(request.windowEnd, 0, chapterDuration));
    const maxEnd = windowStart + MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS;
    const windowEnd = roundSeconds(Math.min(requestedEnd, chapterDuration, maxEnd));
    if (windowEnd <= windowStart) continue;

    const cached = await getDetailedTranscriptWindow(
      chapter.id,
      assetId,
      windowStart,
      windowEnd,
      DETAILED_TRANSCRIPT_MODEL,
      DETAILED_TRANSCRIPT_COMPUTE_TYPE,
      DETAILED_TRANSCRIPT_WORD_TIMESTAMPS
    );

    if (cached) {
      windows.push(mapDetailedTranscriptForContext(cached, request.reason));
      continue;
    }

    const asset = await getAsset(assetId);
    if (!asset) {
      continue;
    }

    const tempAudioPath = path.join(
      os.tmpdir(),
      `vod-pipeline-detailed-${chapter.id}-${assetId}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
    );

    try {
      const globalStart = roundSeconds(chapter.start_time + windowStart);
      const globalEnd = roundSeconds(chapter.start_time + windowEnd);

      await extractAudio(asset.file_path, tempAudioPath, {
        trackIndex: 0,
        sampleRate: 16000,
        channels: 1,
        startTime: globalStart,
        endTime: globalEnd,
      });

      const transcription = await transcribe({
        audioPath: tempAudioPath,
        model: DETAILED_TRANSCRIPT_MODEL,
        computeType: DETAILED_TRANSCRIPT_COMPUTE_TYPE,
        wordTimestamps: DETAILED_TRANSCRIPT_WORD_TIMESTAMPS,
      });

      const detailedSegments = transcription.segments.map((segment, index) => ({
        id: typeof segment.id === 'number' && Number.isFinite(segment.id) ? segment.id : index,
        start: roundSeconds(windowStart + segment.start),
        end: roundSeconds(windowStart + segment.end),
        text: segment.text,
        words: Array.isArray(segment.words)
          ? segment.words.map((word) => ({
              word: word.word,
              start: roundSeconds(windowStart + word.start),
              end: roundSeconds(windowStart + word.end),
              probability: word.probability,
            }))
          : undefined,
      }));

      const saved = await upsertDetailedTranscript({
        chapter_id: chapter.id,
        asset_id: assetId,
        window_start: windowStart,
        window_end: windowEnd,
        model: DETAILED_TRANSCRIPT_MODEL,
        compute_type: DETAILED_TRANSCRIPT_COMPUTE_TYPE,
        word_timestamps: DETAILED_TRANSCRIPT_WORD_TIMESTAMPS,
        text: transcription.text,
        segments_json: detailedSegments,
      });

      windows.push(mapDetailedTranscriptForContext(saved, request.reason));
    } catch (error) {
      console.warn(
        `[AgentChat] Failed to generate detailed transcript for chapter=${chapter.id} asset=${assetId} window=${windowStart}-${windowEnd}:`,
        error
      );
    } finally {
      if (fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
      }
    }
  }

  return windows.sort((a, b) => a.windowStart - b.windowStart);
}

function getProxyDirectoryPath(): string {
  const userDataPath = app.getPath('userData');
  const proxiesDir = path.join(userDataPath, 'proxies');
  if (!fs.existsSync(proxiesDir)) {
    fs.mkdirSync(proxiesDir, { recursive: true });
  }
  return proxiesDir;
}

function getAssetProxyPath(assetId: number): string {
  return path.join(getProxyDirectoryPath(), `asset_${assetId}_ai_proxy.mp4`);
}

function getChapterProxyPath(chapterId: number, assetId: number): string {
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_ai_proxy.mp4`);
}

type ReverseProxyVariant = 'full' | 'quick';

function getChapterReverseProxyPath(chapterId: number, assetId: number, variant: ReverseProxyVariant = 'full'): string {
  const suffix = variant === 'full' ? 'reverse_preview.mp4' : 'reverse_preview_quick.mp4';
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_${suffix}`);
}

function getChapterReverseProxyTempPath(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full'
): string {
  const suffix = variant === 'full' ? 'reverse_preview.partial.mp4' : 'reverse_preview_quick.partial.mp4';
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_${suffix}`);
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

function scheduleChapterReverseProxyFullWarm(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  delayMs = 12000
): void {
  if (asset.file_type !== 'video') {
    return;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  if (chapterReverseProxyGenerationLocks.has(lockKey) || chapterReverseProxyBackgroundTimers.has(lockKey)) {
    return;
  }

  const timer = setTimeout(() => {
    chapterReverseProxyBackgroundTimers.delete(lockKey);
    void ensureChapterReverseProxyFullReady(chapter, asset).catch((error) => {
      console.warn(
        `[ReverseProxy] Failed background full warm chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
    });
  }, Math.max(0, delayMs));

  chapterReverseProxyBackgroundTimers.set(lockKey, timer);
}

async function getChapterReverseProxyStatus(chapterId: number, assetId: number): Promise<ChapterReverseProxyStatusPayload> {
  const lockKey = `${chapterId}:${assetId}`;

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

  if (chapterReverseProxyQuickGenerationLocks.has(lockKey) || chapterReverseProxyGenerationLocks.has(lockKey)) {
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

function invalidateChapterReverseProxy(chapterId: number, assetId: number): void {
  const lockKey = `${chapterId}:${assetId}`;
  chapterReverseProxyErrors.delete(lockKey);
  clearChapterReverseProxyBackgroundTimer(lockKey);
  invalidateChapterReverseProxyVariant(chapterId, assetId, 'full');
  invalidateChapterReverseProxyVariant(chapterId, assetId, 'quick');
}

async function ensureChapterReverseProxyQuickReady(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const inFlight = chapterReverseProxyQuickGenerationLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const fullProxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'full');
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
      chapterReverseProxyErrors.delete(lockKey);
      return fullProxyPath;
    }

    const quickProxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'quick');
    const quickTempPath = getChapterReverseProxyTempPath(chapter.id, asset.id, 'quick');
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'quick')) {
      chapterReverseProxyErrors.delete(lockKey);
      return quickProxyPath;
    }

    try {
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

      const chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
      if (
        chapterProxy?.status === 'ready' &&
        chapterProxy.file_path &&
        fs.existsSync(chapterProxy.file_path)
      ) {
        try {
          const chapterProxyMetadata = await getVideoMetadata(chapterProxy.file_path, 5000);
          if (chapterProxyMetadata.duration > 0.1) {
            const chapterDuration = Math.max(0.1, chapter.end_time - chapter.start_time);
            inputPath = chapterProxy.file_path;
            inputStartTime = 0;
            inputEndTime = Math.min(chapterProxyMetadata.duration, chapterDuration);
            fps = Math.max(5, Math.min(10, Math.round(chapterProxyMetadata.fps) || 5));
          }
        } catch {
          // Fallback to source media if chapter proxy metadata lookup fails.
        }
      }

      await generateChapterReverseProxy(inputPath, quickTempPath, {
        startTime: inputStartTime,
        endTime: inputEndTime,
        fps,
        encodingMode: 'auto',
        quality: 'fast',
        chunkDurationSec: 45,
        maxParallelChunks: 3,
      });

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
      invalidateChapterReverseProxyVariant(chapter.id, asset.id, 'quick');
      chapterReverseProxyErrors.set(lockKey, message);
      console.warn(
        `[ReverseProxy] Failed generating quick reverse chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }
  })();

  chapterReverseProxyQuickGenerationLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    chapterReverseProxyQuickGenerationLocks.delete(lockKey);
  }
}

async function ensureChapterReverseProxyFullReady(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  clearChapterReverseProxyBackgroundTimer(lockKey);

  const inFlight = chapterReverseProxyGenerationLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const proxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'full');
    const tempPath = getChapterReverseProxyTempPath(chapter.id, asset.id, 'full');
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
      chapterReverseProxyErrors.delete(lockKey);
      return proxyPath;
    }

    let generatedPath: string | undefined;

    try {
      await enqueueChapterReverseProxy(async () => {
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
          encodingMode: 'auto',
          quality: 'high',
          chunkDurationSec: 11,
          maxParallelChunks: 3,
        });

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
      invalidateChapterReverseProxyVariant(chapter.id, asset.id, 'full');
      chapterReverseProxyErrors.set(lockKey, message);
      console.warn(
        `[ReverseProxy] Failed generating chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }

    return generatedPath;
  })();

  chapterReverseProxyGenerationLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    chapterReverseProxyGenerationLocks.delete(lockKey);
  }
}

async function ensureChapterProxyReady(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  encodingMode: 'cpu' | 'gpu' | 'auto' = 'auto',
  quality: 'high' | 'balanced' | 'fast' = 'balanced'
): Promise<string | undefined> {
  const lockKey = `${chapter.id}:${asset.id}`;
  const inFlight = chapterProxyGenerationLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const existing = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    if (existing?.status === 'ready' && fs.existsSync(existing.file_path)) {
      return existing.file_path;
    }

    const proxyPath = existing?.file_path || getChapterProxyPath(chapter.id, asset.id);

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
      await updateChapterProxyStatus(chapterProxyId, 'generating');
    }

    try {
      const metadata = await generateAIProxy(
        asset.file_path,
        proxyPath,
        undefined,
        undefined,
        encodingMode,
        quality,
        {
          startTime: chapter.start_time,
          endTime: chapter.end_time,
        }
      );

      await updateChapterProxyMetadata(chapterProxyId, {
        width: metadata.width,
        height: metadata.height,
        framerate: metadata.framerate,
        file_size: metadata.fileSize,
        duration: metadata.duration,
      });
      await updateChapterProxyStatus(chapterProxyId, 'ready');

      return proxyPath;
    } catch (error) {
      await updateChapterProxyStatus(
        chapterProxyId,
        'error',
        error instanceof Error ? error.message : String(error)
      );
      console.warn(
        `[ChapterProxy] Failed generating chapter proxy chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }
  })();

  chapterProxyGenerationLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    chapterProxyGenerationLocks.delete(lockKey);
  }
}

async function ensureAssetMixWaveformReady(asset: Asset): Promise<void> {
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

async function prewarmChapterMedia(chapterId: number, assetId: number): Promise<void> {
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

  const jobs: Array<Promise<unknown>> = [
    ensureAssetMixWaveformReady(asset),
  ];

  if (asset.file_type === 'video') {
    jobs.push(ensureChapterProxyReady(chapter, asset, 'auto', 'balanced'));
  }

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`[ChapterPrewarm] Failed chapter=${chapter.id} asset=${asset.id}:`, result.reason);
    }
  }
}

function scheduleChapterMediaPrewarm(chapterId: number, assetId: number): Promise<void> {
  const lockKey = `${chapterId}:${assetId}`;
  const inFlight = chapterMediaPrewarmLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = enqueueChapterMediaPrewarm(async () => {
    await prewarmChapterMedia(chapterId, assetId);
  });

  chapterMediaPrewarmLocks.set(lockKey, task);
  return task.finally(() => {
    chapterMediaPrewarmLocks.delete(lockKey);
  });
}

async function buildAgentChatContext(
  projectId: number,
  chapterId?: number,
  options?: {
    detailedTranscripts?: DetailedTranscriptContextWindow[];
    ensureChapterProxyReady?: boolean;
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
      proxyPath: undefined as string | undefined,
      assets: projectAssets.map((asset) => ({
        id: asset.id,
        filePath: asset.file_path,
        duration: asset.duration,
        fileType: asset.file_type,
      })),
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

  let proxyPath: string | undefined;
  if (chapterAssets.length > 0) {
    const primaryAsset = chapterAssets[0];
    const chapterProxy = await getChapterProxyByChapterAsset(chapter.id, primaryAsset.id);

    if (chapterProxy?.status === 'ready' && fs.existsSync(chapterProxy.file_path)) {
      proxyPath = chapterProxy.file_path;
    } else if (options?.ensureChapterProxyReady) {
      proxyPath = await ensureChapterProxyReady(chapter, primaryAsset);
    }
  }

  const assets = chapterAssets
    .map((asset) => ({
      id: asset.id,
      filePath: asset.file_path,
      duration: asset.duration,
      fileType: asset.file_type,
      audioTrackCount: Array.isArray(asset.metadata?.audioTracks) ? asset.metadata.audioTracks.length : 0,
    }));

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
    proxyPath,
    assets,
  };
}

export function registerIpcHandlers() {
  console.log('Registering IPC handlers...');

  const agentBridge = getAgentBridge();
  agentBridge.on('exit', () => {
    hydratedConversationIds.clear();
  });
  agentBridge.on('error', () => {
    hydratedConversationIds.clear();
  });

  // Project handlers
  ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE, async (_, { name }) => {
    console.log('IPC: project:create', name);
    try {
      const project = await createProject(name);
      return createSuccessResponse(project);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_ALL, async () => {
    console.log('IPC: project:get-all');
    try {
      const projects = await listProjects();
      return createSuccessResponse(projects);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET, async (_, { id }) => {
    console.log('IPC: project:get', id);
    try {
      const project = await getProject(id);
      if (project) {
        return createSuccessResponse(project);
      } else {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_UPDATE, async (_, { id, name }) => {
    console.log('IPC: project:update', id, name);
    try {
      const success = await updateProject(id, name);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_DELETE, async (_, { id }) => {
    console.log('IPC: project:delete', id);
    try {
      const success = await deleteProject(id);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Background proxy generation
  async function generateProxyAsync(
    assetId: number, 
    sourcePath: string, 
    mainWindow: any,
    encodingMode: 'cpu' | 'gpu' | 'auto' = 'auto',
    quality: 'high' | 'balanced' | 'fast' = 'balanced'
  ) {
    const proxyPath = getAssetProxyPath(assetId);
    let proxyId: number | null = null;
    
    try {
      // Create proxy record and get its ID
      const proxy = await createProxy({
        asset_id: assetId,
        file_path: proxyPath,
        preset: 'ai_analysis',
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        status: 'generating',
        error_message: null,
      });
      proxyId = proxy.id;

      console.log(`[Proxy] Starting generation for asset ${assetId} (proxy ${proxyId})`);
      console.log(`[Proxy] Encoding mode: ${encodingMode}, Quality: ${quality}`);
      
      // Generate proxy with progress
      const proxyMetadata = await generateAIProxy(
        sourcePath, 
        proxyPath, 
        (progress) => {
          // Send progress to renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy:progress', { assetId, progress });
          }
        },
        undefined, // timeoutMs
        encodingMode,
        quality
      );

      // Update proxy record with metadata using the proxy ID
      await updateProxyMetadata(proxyId, {
        width: proxyMetadata.width,
        height: proxyMetadata.height,
        framerate: proxyMetadata.framerate,
        file_size: proxyMetadata.fileSize,
        duration: proxyMetadata.duration,
      });
      await updateProxyStatus(proxyId, 'ready');

      console.log(`[Proxy] Generation complete for asset ${assetId}: ${proxyPath}`);
      
      // Notify renderer of completion
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxy:complete', { assetId, proxyPath });
      }
    } catch (error) {
      console.error(`[Proxy] Generation failed for asset ${assetId}:`, error);
      // Try to update status using the proxy ID if we have it, otherwise fall back to finding it
      if (proxyId) {
        await updateProxyStatus(proxyId, 'error', error instanceof Error ? error.message : 'Unknown error');
      } else {
        // Try to find the proxy by asset ID and update it
        const existingProxy = await getProxyByAsset(assetId);
        if (existingProxy) {
          await updateProxyStatus(existingProxy.id, 'error', error instanceof Error ? error.message : 'Unknown error');
        }
      }
      
      // Notify renderer of error
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxy:error', { 
          assetId, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
  }

  // Asset handlers
  ipcMain.handle(IPC_CHANNELS.ASSET_ADD, async (event, { projectId, filePath, proxyOptions }) => {
    console.log('IPC: asset:add', projectId, filePath);

    try {
      if (!fs.existsSync(filePath)) {
        return createErrorResponse('File not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      // Determine file type from extension first
      const ext = path.extname(filePath).toLowerCase();
      const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts', '.m2ts', '.mts'];
      const audioExtensions = ['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg', '.wma'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
      
      let fileType: 'video' | 'audio' | 'image';
      if (audioExtensions.includes(ext)) {
        fileType = 'audio';
      } else if (imageExtensions.includes(ext)) {
        fileType = 'image';
      } else if (videoExtensions.includes(ext)) {
        fileType = 'video';
      } else {
        return createErrorResponse(`Unsupported file extension: ${ext}`, IPC_ERROR_CODES.INVALID_FORMAT);
      }

      // Only validate video files with FFmpeg
      let metadata: AssetMetadata = {};
      let duration: number | null = null;
      
      if (fileType === 'video') {
        try {
          const isValid = await isValidVideo(filePath);
          if (!isValid) {
            return createErrorResponse('Invalid or unsupported video format', IPC_ERROR_CODES.INVALID_FORMAT);
          }
        } catch (error) {
          if (error instanceof FFmpegError && error.code === 'FFPROBE_TIMEOUT') {
            return createErrorResponse(
              'Video validation timed out - file may be too large or corrupted. Try a smaller file or check file integrity.',
              IPC_ERROR_CODES.TIMEOUT
            );
          }
          return createErrorResponse('Failed to validate video file', IPC_ERROR_CODES.INVALID_FORMAT);
        }

        try {
          // Use longer timeout for full metadata extraction on large VODs
          const videoMetadata = await getVideoMetadata(filePath, 60000);
          metadata = {
            width: videoMetadata.width,
            height: videoMetadata.height,
            fps: videoMetadata.fps,
            videoCodec: videoMetadata.videoCodec,
            audioCodec: videoMetadata.audioCodec,
            audioTracks: videoMetadata.audioTracks,
            bitrate: videoMetadata.bitrate,
            container: videoMetadata.container,
            duration: videoMetadata.duration,
          };
          duration = videoMetadata.duration;
        } catch (error) {
          console.warn('[Asset Add] Failed to extract video metadata:', error);
          // Don't fail the import if metadata extraction fails - we can still use the file
        }
      }

      const asset = await createAsset({
        project_id: projectId,
        file_path: filePath,
        file_type: fileType,
        duration,
        metadata,
      });

      // Start proxy generation in background for video assets
      if (fileType === 'video') {
        const { getMainWindow } = await import('../main.js');
        const mainWindow = getMainWindow();
        // Extract proxy encoding options from settings
        const encodingMode = proxyOptions?.encodingMode || 'auto';
        const quality = proxyOptions?.quality || 'balanced';
        // Don't await - run in background
        generateProxyAsync(asset.id!, filePath, mainWindow, encodingMode, quality);
      }

      return createSuccessResponse(asset);
    } catch (error) {
      if (error instanceof FFmpegError) {
        // Validate error code is a known IPC error code
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode) 
          ? error.code as IPCErrorCode 
          : IPC_ERROR_CODES.UNKNOWN_ERROR;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_GET, async (_, { id }) => {
    console.log('IPC: asset:get', id);
    try {
      const asset = await getAsset(id);
      if (asset) {
        return createSuccessResponse(asset);
      } else {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_GET_BY_PROJECT, async (_, { projectId }) => {
    console.log('IPC: asset:get-by-project', projectId);
    try {
      const assets = await getAssetsByProject(projectId);
      return createSuccessResponse(assets);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_DELETE, async (_, { id }) => {
    console.log('IPC: asset:delete', id);
    try {
      const success = await deleteAsset(id);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Chapter handlers
  ipcMain.handle(IPC_CHANNELS.CHAPTER_CREATE, async (_, { projectId, title, startTime, endTime }) => {
    console.log('IPC: chapter:create', projectId, title, startTime, endTime);
    try {
      if (startTime < 0) {
        return createErrorResponse('Start time must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (endTime <= startTime) {
        return createErrorResponse('End time must be greater than start time', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const chapter = await createChapter({
        project_id: projectId,
        title,
        start_time: startTime,
        end_time: endTime,
      });

      const linkedAssetIds = await getAssetsForChapter(chapter.id);
      for (const assetId of linkedAssetIds) {
        void scheduleChapterMediaPrewarm(chapter.id, assetId).catch((error) => {
          console.warn(`[ChapterPrewarm] Failed to prewarm chapter=${chapter.id} asset=${assetId}:`, error);
        });
      }

      return createSuccessResponse(chapter);
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET, async (_, { id }) => {
    console.log('IPC: chapter:get', id);
    try {
      const chapter = await getChapter(id);
      if (chapter) {
        return createSuccessResponse(chapter);
      } else {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_BY_PROJECT, async (_, { projectId }) => {
    console.log('IPC: chapter:get-by-project', projectId);
    try {
      const chapters = await getChaptersByProject(projectId);

      for (const chapter of chapters) {
        void (async () => {
          try {
            const assetIds = await getAssetsForChapter(chapter.id);
            for (const assetId of assetIds) {
              void scheduleChapterMediaPrewarm(chapter.id, assetId).catch((error) => {
                console.warn(
                  `[ChapterPrewarm] Failed to prewarm chapter=${chapter.id} asset=${assetId}:`,
                  error
                );
              });
            }
          } catch (error) {
            console.warn(`[ChapterPrewarm] Failed to resolve assets for chapter=${chapter.id}:`, error);
          }
        })();
      }

      return createSuccessResponse(chapters);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_UPDATE, async (_, { id, updates }) => {
    console.log('IPC: chapter:update', id, updates);
    try {
      const normalizedUpdates: {
        title?: string;
        start_time?: number;
        end_time?: number;
        display_order?: number;
      } = {};

      if (updates.title !== undefined) {
        normalizedUpdates.title = updates.title;
      }
      if (updates.startTime !== undefined) {
        normalizedUpdates.start_time = updates.startTime;
      }
      if (updates.endTime !== undefined) {
        normalizedUpdates.end_time = updates.endTime;
      }
      if (updates.display_order !== undefined) {
        normalizedUpdates.display_order = updates.display_order;
      }

      const success = await updateChapter(id, normalizedUpdates);
      if (success) {
        if (normalizedUpdates.start_time !== undefined || normalizedUpdates.end_time !== undefined) {
          await deleteTranscriptsByChapter(id);

          const chapterAssetIds = await getAssetsForChapter(id);
          for (const assetId of chapterAssetIds) {
            invalidateChapterReverseProxy(id, assetId);
            void scheduleChapterMediaPrewarm(id, assetId).catch((error) => {
              console.warn(`[ChapterPrewarm] Failed to prewarm chapter=${id} asset=${assetId}:`, error);
            });
          }
        }
        await deleteDetailedTranscriptsByChapter(id);
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_DELETE, async (_, { id }) => {
    console.log('IPC: chapter:delete', id);
    try {
      const linkedAssetIds = await getAssetsForChapter(id);
      const success = await deleteChapter(id);
      if (success) {
        for (const assetId of linkedAssetIds) {
          invalidateChapterReverseProxy(id, assetId);
        }
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Chapter-Asset linking handlers
  ipcMain.handle(IPC_CHANNELS.CHAPTER_ADD_ASSET, async (_, { chapterId, assetId }) => {
    console.log('IPC: chapter:add-asset', chapterId, assetId);
    try {
      await addAssetToChapter(chapterId, assetId);
      await deleteTranscriptsByChapter(chapterId);
      await deleteDetailedTranscriptsByChapter(chapterId);

      void scheduleChapterMediaPrewarm(chapterId, assetId).catch((error) => {
        console.warn(`[ChapterPrewarm] Failed to prewarm chapter=${chapterId} asset=${assetId}:`, error);
      });

      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_REMOVE_ASSET, async (_, { chapterId, assetId }) => {
    console.log('IPC: chapter:remove-asset', chapterId, assetId);
    try {
      const success = await removeAssetFromChapter(chapterId, assetId);
      if (success) {
        invalidateChapterReverseProxy(chapterId, assetId);
        await deleteTranscriptsByChapter(chapterId);
        await deleteDetailedTranscriptsByChapter(chapterId);
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Link not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_ASSETS, async (_, { chapterId }) => {
    console.log('IPC: chapter:get-assets', chapterId);
    try {
      const assetIds = await getAssetsForChapter(chapterId);
      return createSuccessResponse(assetIds);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_REVERSE_PROXY_GET, async (_, payload) => {
    const chapterId = toNumberOrNull(payload?.chapterId);
    const assetId = toNumberOrNull(payload?.assetId);
    const ensureReady = Boolean(payload?.ensureReady);
    if (ensureReady) {
      console.log('IPC: chapter:reverse-proxy-get', chapterId, assetId, ensureReady);
    }

    try {
      if (chapterId === null || !Number.isInteger(chapterId) || chapterId <= 0) {
        return createErrorResponse('Invalid chapterId', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (assetId === null || !Number.isInteger(assetId) || assetId <= 0) {
        return createErrorResponse('Invalid assetId', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const [chapter, asset] = await Promise.all([
        getChapter(chapterId),
        getAsset(assetId),
      ]);

      if (!chapter) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const chapterAssetIds = await getAssetsForChapter(chapterId);
      if (!chapterAssetIds.includes(assetId)) {
        return createErrorResponse('Asset is not linked to chapter', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      if (asset.file_type !== 'video') {
        return createSuccessResponse({ status: 'missing' as const });
      }

      const statusBefore = await getChapterReverseProxyStatus(chapterId, assetId);

      if (ensureReady) {
        if (statusBefore.status === 'missing' || statusBefore.status === 'error') {
          void ensureChapterReverseProxyQuickReady(chapter, asset)
            .finally(() => {
              scheduleChapterReverseProxyFullWarm(chapter, asset);
            })
            .catch((error: unknown) => {
              console.warn(
                `[ReverseProxy] Failed quick warm request chapter=${chapterId} asset=${assetId}:`,
                error
              );
            });
        } else if (statusBefore.status === 'ready' && statusBefore.quality === 'quick') {
          scheduleChapterReverseProxyFullWarm(chapter, asset);
        }
      }

      const status = await getChapterReverseProxyStatus(chapterId, assetId);
      if (ensureReady && (status.status === 'missing' || status.status === 'generating')) {
        return createSuccessResponse({ status: 'generating' as const });
      }

      return createSuccessResponse(status);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_STATUS, async (_, payload) => {
    console.log('IPC: transcription:status');
    try {
      const autoSetup = Boolean(payload?.autoSetup);
      const status = await getWhisperRuntimeStatus({ autoSetup });
      return createSuccessResponse(status);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Transcription handler
  ipcMain.handle(IPC_CHANNELS.TRANSCRIBE_CHAPTER, async (event, { chapterId, options = {} }) => {
    console.log('IPC: transcribe:chapter', chapterId);
    let tempAudioPath: string | null = null;

    try {
      const chapter = await getChapter(chapterId);
      if (!chapter) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const chapterStart = chapter.start_time;
      const chapterEnd = chapter.end_time;
      const chapterDuration = Math.max(0.01, chapterEnd - chapterStart);
      const skipIfExists = options?.skipIfExists === true;

      if (skipIfExists) {
        const existingTranscripts = await getTranscriptsByChapter(chapterId);
        if (existingTranscripts.length > 0) {
          event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
            chapterId,
            progress: { percent: 100, status: 'Using existing transcript' },
          });

          return createSuccessResponse({
            chapterId,
            language: 'existing',
            duration: chapterDuration,
            segmentCount: existingTranscripts.length,
            skipped: true,
          });
        }
      }

      const assetIds = await getAssetsForChapter(chapterId);
      if (assetIds.length === 0) {
        return createErrorResponse('No assets linked to chapter', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const asset = await getAsset(assetIds[0]);
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const assetDuration =
        typeof asset.duration === 'number' && Number.isFinite(asset.duration) ? asset.duration : null;

      if (assetDuration !== null) {
        if (chapterStart >= assetDuration) {
          return createErrorResponse(
            `Chapter start (${chapterStart.toFixed(2)}s) is outside asset duration (${assetDuration.toFixed(2)}s)`,
            IPC_ERROR_CODES.VALIDATION_ERROR
          );
        }
        if (chapterEnd > assetDuration + 0.25) {
          return createErrorResponse(
            `Chapter end (${chapterEnd.toFixed(2)}s) exceeds asset duration (${assetDuration.toFixed(2)}s)`,
            IPC_ERROR_CODES.VALIDATION_ERROR
          );
        }
      }

      const tempDir = os.tmpdir();
      tempAudioPath = path.join(tempDir, `vod-pipeline-${chapterId}-${Date.now()}.wav`);

      event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
        chapterId,
        progress: { percent: 0, status: 'Extracting audio...' },
      });

      try {
        await extractAudio(asset.file_path, tempAudioPath, {
          trackIndex: 0,
          sampleRate: 16000,
          channels: 1,
          startTime: chapterStart,
          endTime: chapterEnd,
        });
      } catch (error) {
        // Preserve FFmpegError to allow proper error code mapping
        if (error instanceof FFmpegError) {
          throw error;
        }
        throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : String(error)}`);
      }

      event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
        chapterId,
        progress: { percent: 10, status: 'Starting transcription...' },
      });

      const result = await transcribe(
        {
          audioPath: tempAudioPath,
          model: normalizeTranscriptionModel(options.model),
          language: typeof options.language === 'string' ? options.language : undefined,
          computeType: normalizeComputeType(options.computeType),
          wordTimestamps: false,
        },
        (progress) => {
          event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
            chapterId,
            progress,
          });
        }
      );

      const transcriptInputs = result.segments
        .map((segment) => {
          const start = clamp(segment.start, 0, chapterDuration);
          const end = clamp(segment.end, start, chapterDuration);
          if (end <= start) return null;
          return {
            text: segment.text,
            start_time: start,
            end_time: end,
          };
        })
        .filter((segment): segment is { text: string; start_time: number; end_time: number } => segment !== null);

      // Atomically replace transcripts (delete old + insert new in transaction)
      await replaceTranscripts(chapterId, transcriptInputs);
      await deleteDetailedTranscriptsByChapter(chapterId);

      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
      }

      return createSuccessResponse({
        chapterId,
        language: result.language,
        duration: chapterDuration,
        segmentCount: result.segments.length,
      });
    } catch (error) {
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', cleanupError);
        }
      }

      if (error instanceof WhisperError) {
        // Validate error code is a known IPC error code
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode) 
          ? error.code as IPCErrorCode 
          : IPC_ERROR_CODES.UNKNOWN_ERROR;
        return createErrorResponse(error.message, errorCode);
      }
      
      if (error instanceof FFmpegError) {
        // Map FFmpegError codes to appropriate IPC error codes
        const validCodes = Object.values(IPC_ERROR_CODES);
        let errorCode: IPCErrorCode;
        
        if (error.code === 'TIMEOUT') {
          errorCode = IPC_ERROR_CODES.TRANSCRIPTION_FAILED;
        } else if (error.code === 'FFMPEG_NOT_FOUND') {
          errorCode = IPC_ERROR_CODES.FFMPEG_NOT_FOUND;
        } else {
          errorCode = validCodes.includes(error.code as IPCErrorCode) 
            ? error.code as IPCErrorCode 
            : IPC_ERROR_CODES.TRANSCRIPTION_FAILED;
        }
        
        return createErrorResponse(error.message, errorCode);
      }
      
      return createErrorResponse(error, IPC_ERROR_CODES.TRANSCRIPTION_FAILED);
    }
  });

  // Agent conversation handlers
  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_CREATE, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const provider = typeof payload?.provider === 'string' ? payload.provider : null;
    const titleRaw = typeof payload?.title === 'string' ? payload.title.trim() : '';

    console.log('IPC: agent:conversation-create', projectId, chapterId, provider);

    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!chapterId) {
        return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const chapter = await getChapter(chapterId);
      if (!chapter) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (chapter.project_id !== projectId) {
        return createErrorResponse('Chapter does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const conversation = await createChatConversation({
        project_id: projectId,
        chapter_id: chapterId,
        title: titleRaw || 'New conversation',
        provider: normalizeConversationProvider(provider),
        thread_id: randomUUID(),
      });

      return createSuccessResponse(conversation);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_LIST, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);

    console.log('IPC: agent:conversation-list', projectId, chapterId);

    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!chapterId) {
        return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const conversations = await getChatConversationsByChapter(projectId, chapterId);
      return createSuccessResponse(conversations);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_MESSAGES, async (_, payload) => {
    const conversationId = toNumberOrNull(payload?.conversationId);
    console.log('IPC: agent:conversation-messages', conversationId);

    try {
      if (!conversationId) {
        return createErrorResponse('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const conversation = await getChatConversation(conversationId);
      if (!conversation) {
        return createErrorResponse('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const messages = await getChatMessagesByConversation(conversationId);
      return createSuccessResponse(messages);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_DELETE, async (_, payload) => {
    const conversationId = toNumberOrNull(payload?.conversationId);
    console.log('IPC: agent:conversation-delete', conversationId);

    try {
      if (!conversationId) {
        return createErrorResponse('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const success = await deleteChatConversation(conversationId);
      if (success) {
        hydratedConversationIds.delete(conversationId);
        return createSuccessResponse(null);
      }
      return createErrorResponse('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Agent handler
  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (event, payload) => {
    const clientRequestId =
      typeof payload?.clientRequestId === 'string' ? payload.clientRequestId.trim() : '';
    const projectId = toNumberOrNull(payload?.projectId);
    const conversationId = toNumberOrNull(payload?.conversationId);
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    const provider = typeof payload?.provider === 'string' ? payload.provider : undefined;
    const selectedClipIds = Array.isArray(payload?.selectedClipIds)
      ? payload.selectedClipIds.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
      : [];
    const playheadTime = toNumberOrNull(payload?.playheadTime) ?? undefined;
    const agentConfig = payload?.agentConfig && typeof payload.agentConfig === 'object'
      ? payload.agentConfig
      : undefined;

    console.log('IPC: agent:chat', projectId, conversationId, provider, message);

    try {
      if (!clientRequestId) {
        return createErrorResponse('Client request ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!conversationId) {
        return createErrorResponse('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!message) {
        return createErrorResponse('Message is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const conversation = await getChatConversation(conversationId);
      if (!conversation) {
        return createErrorResponse('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (conversation.project_id !== projectId) {
        return createErrorResponse('Conversation does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const chapter = await getChapter(conversation.chapter_id);
      if (!chapter) {
        return createErrorResponse('Conversation chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (chapter.project_id !== projectId) {
        return createErrorResponse('Conversation chapter does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const effectiveProvider = provider ?? conversation.provider ?? undefined;
      if (provider && provider !== conversation.provider) {
        await updateChatConversation(conversation.id, {
          provider: normalizeConversationProvider(provider),
        });
      }

      await createChatMessage({
        conversation_id: conversation.id,
        role: 'user',
        content: message,
        thinking_markdown: null,
        trace_json: null,
      });

      const existingMessages = await getChatMessagesByConversation(conversation.id);
      if (conversation.title === 'New conversation' && existingMessages.length === 1) {
        await updateChatConversation(conversation.id, {
          title: deriveConversationTitle(message),
        });
      }

      const threadId = conversation.thread_id?.trim() || randomUUID();
      if (!conversation.thread_id || conversation.thread_id !== threadId) {
        await updateChatConversation(conversation.id, { thread_id: threadId });
      }

      const chapterAssetIds = await getAssetsForChapter(chapter.id);
      const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);

      const wantsVideoContext = hasVideoIntent(message);

      const initialContext = await buildAgentChatContext(projectId, chapter.id, {
        ensureChapterProxyReady: false,
      });

      if (wantsVideoContext && chapterAssetIds.length > 0) {
        const primaryAssetId = chapterAssetIds[0];
        void scheduleChapterMediaPrewarm(chapter.id, primaryAssetId).catch((error) => {
          console.warn(
            `[ChapterPrewarm] Failed scheduling from chat chapter=${chapter.id} asset=${primaryAssetId}:`,
            error
          );
        });
      }

      const latestUserTurn = [{ role: 'user', content: message }];
      const conversationHistory = conversation.thread_id?.trim()
        ? latestUserTurn
        : existingMessages.map((item) => ({
            role: item.role,
            content: item.role === 'assistant'
              ? sanitizeAssistantContent(item.content)
              : item.content,
          }));
      const guardedInitialPayload = applyNearLimitTokenGuard(
        conversationHistory,
        initialContext,
        effectiveProvider
      );

      if (guardedInitialPayload.compressed) {
        console.log(
          `[AgentChat] Token guard engaged conversation=${conversation.id} provider=${effectiveProvider || 'default'} ` +
          `estimatedTokens=${guardedInitialPayload.estimatedTotalTokens}/${guardedInitialPayload.effectiveContextLimit}`
        );
      }

      const agentBridge = getAgentBridge();
      await agentBridge.ensureStarted();
      let executionTrace: ExecutionTraceEntry[] = [];
      let hiddenReasoningChunks: HiddenReasoningChunk[] = [];

      const sendChatPass = async (
        messagesPayload: Array<{ role: string; content: string }>,
        contextPayload: Awaited<ReturnType<typeof buildAgentChatContext>> | undefined,
        passIndex: number
      ): Promise<Record<string, unknown>> => {
        const response = await agentBridge.send({
          type: 'chat',
          threadId,
          messages: messagesPayload,
          metadata: {
            projectId: String(projectId),
            provider: effectiveProvider,
            chapterId: String(chapter.id),
            selectedClipIds,
            playheadTime,
            agentConfig,
            context: contextPayload,
          },
        }, {
          streamContext: {
            clientRequestId,
            projectId: String(projectId),
            chapterId: String(chapter.id),
            conversationId: conversation.id,
            passIndex,
          },
          onStreamEvent: (streamMessage) => {
            if (streamMessage.type === 'token' && streamMessage.visibility === 'hidden') {
              hiddenReasoningChunks = appendHiddenReasoningChunk(hiddenReasoningChunks, streamMessage, passIndex);
              return;
            }

            if (streamMessage.type !== 'progress') {
              return;
            }

            executionTrace = appendExecutionTraceEntry(executionTrace, {
              status: streamMessage.status,
              message: streamMessage.message,
              nodeName: streamMessage.nodeName,
              passIndex,
            });
          },
        });

        if (response.type === 'error') {
          throw new Error(response.error);
        }
        if (response.type !== 'graph-complete') {
          throw new Error('Unexpected agent response type');
        }

        return response.result && typeof response.result === 'object'
          ? response.result as Record<string, unknown>
          : {};
      };

      const firstPassResult = await sendChatPass(guardedInitialPayload.messages, initialContext, 1);
      let finalPassResult = firstPassResult;

      const firstParsed = parseAgentGraphResult(firstPassResult, chapterDuration, chapterAssetIds);
      if (firstParsed.transcriptDetailRequests.length > 0) {
        const detailedTranscriptEvent: AgentStreamEvent = {
          type: 'progress',
          clientRequestId,
          projectId: String(projectId),
          chapterId: String(chapter.id),
          conversationId: conversation.id,
          passIndex: 2,
          status: 'loading_detailed_transcript_context',
          progress: 0,
          message: 'Fetching detailed transcript for a better answer...',
          resetDraft: true,
        };
        event.sender.send(IPC_CHANNELS.AGENT_STREAM, detailedTranscriptEvent);
        executionTrace = appendExecutionTraceEntry(executionTrace, detailedTranscriptEvent);

        const detailedTranscripts = await generateDetailedTranscriptsForRequests(
          chapter,
          chapterAssetIds,
          firstParsed.transcriptDetailRequests
        );

        if (detailedTranscripts.length > 0) {
          const detailedContext = await buildAgentChatContext(projectId, chapter.id, {
            detailedTranscripts,
          });
          const guardedDetailedPayload = applyNearLimitTokenGuard([], detailedContext, effectiveProvider);

          if (guardedDetailedPayload.compressed) {
            console.log(
              `[AgentChat] Token guard engaged (detailed pass) conversation=${conversation.id} provider=${effectiveProvider || 'default'} ` +
              `estimatedTokens=${guardedDetailedPayload.estimatedTotalTokens}/${guardedDetailedPayload.effectiveContextLimit}`
            );
          }

          finalPassResult = await sendChatPass(guardedDetailedPayload.messages, detailedContext, 2);
        }
      }

      const finalParsed = parseAgentGraphResult(finalPassResult, chapterDuration, chapterAssetIds);
      const assistantMessage = finalParsed.message || 'Analysis complete';
      const thinkingMarkdown = finalParsed.thinkingMarkdown ?? serializeHiddenReasoning(hiddenReasoningChunks);
      const persistedAssistantMessage = await createChatMessage({
        conversation_id: conversation.id,
        role: 'assistant',
        content: assistantMessage,
        thinking_markdown: thinkingMarkdown,
        trace_json: serializeExecutionTrace(executionTrace),
      });
      const persistedSuggestions = await persistAgentSuggestions(
        chapter.id,
        conversation.id,
        persistedAssistantMessage.id,
        effectiveProvider,
        finalParsed.suggestionDrafts
      );

      hydratedConversationIds.add(conversation.id);

      const normalized: AgentChatData = {
        message: assistantMessage,
        thinkingMarkdown: thinkingMarkdown ?? undefined,
        threadId,
        suggestions: persistedSuggestions,
        timelineActions: undefined,
      };

      return createSuccessResponse(normalized);
    } catch (error) {
      console.error('[IPC] agent:chat error:', error);
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_APPLY_ACTIONS, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const actionsRaw = Array.isArray(payload?.actions) ? payload.actions : [];

    console.log('IPC: agent:apply-actions', projectId, chapterId, actionsRaw.length);

    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      let chapter = null as Awaited<ReturnType<typeof getChapter>> | null;
      let chapterAssetIds: number[] = [];
      let chapterDuration: number | null = null;

      if (chapterId !== null) {
        chapter = await getChapter(chapterId);
        if (!chapter) {
          return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
        }
        if (chapter.project_id !== projectId) {
          return createErrorResponse('Chapter does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
        }

        chapterAssetIds = await getAssetsForChapter(chapter.id);
        chapterDuration = Math.max(0, chapter.end_time - chapter.start_time);
      }

      const projectAssets = await getAssetsByProject(projectId);
      const projectAssetIdSet = new Set(projectAssets.map((asset) => asset.id));
      const chapterAssetIdSet = new Set(chapterAssetIds);

      const results: Array<{
        index: number;
        action: TimelineAction;
        success: boolean;
        clip?: Clip;
        error?: string;
      }> = [];

      const toGlobalTime = (localSeconds: number): number => {
        if (!chapter) return localSeconds;
        return chapter.start_time + localSeconds;
      };

      const ensureChapterLocalTime = (value: number, fieldName: string) => {
        if (!chapter || chapterDuration === null) return;
        if (value < 0 || value > chapterDuration) {
          throw new Error(`${fieldName} (${value}) must be within chapter range 0-${chapterDuration.toFixed(2)}s`);
        }
      };

      for (let index = 0; index < actionsRaw.length; index += 1) {
        const rawAction = actionsRaw[index];
        const [action] = normalizeTimelineActions([rawAction]);

        if (!action) {
          results.push({
            index,
            action: {
              type: 'create_clip',
              inPoint: 0,
              outPoint: 0.01,
              reasoning: 'Invalid action payload',
            },
            success: false,
            error: 'Invalid timeline action payload',
          });
          continue;
        }

        try {
          if (action.type === 'create_clip') {
            const chapterLocalInPoint = action.inPoint;
            const chapterLocalOutPoint = action.outPoint;
            const chapterLocalStartTime = action.startTime ?? chapterLocalInPoint;

            ensureChapterLocalTime(chapterLocalStartTime, 'startTime');
            ensureChapterLocalTime(chapterLocalInPoint, 'inPoint');
            ensureChapterLocalTime(chapterLocalOutPoint, 'outPoint');

            const startTime = toGlobalTime(chapterLocalStartTime);
            const inPoint = toGlobalTime(chapterLocalInPoint);
            const outPoint = toGlobalTime(chapterLocalOutPoint);

            if (outPoint <= inPoint) {
              throw new Error('Out point must be greater than in point');
            }
            if (startTime < 0 || inPoint < 0) {
              throw new Error('Times must be non-negative');
            }

            let assetId = action.assetId;
            if (!assetId) {
              const fallbackAssets = chapter ? chapterAssetIds : projectAssets.map((asset) => asset.id);
              if (fallbackAssets.length === 1) {
                assetId = fallbackAssets[0];
              }
            }

            if (!assetId) {
              throw new Error('assetId is required when multiple assets are available');
            }

            if (!projectAssetIdSet.has(assetId)) {
              throw new Error(`Asset ${assetId} does not belong to project ${projectId}`);
            }

            if (chapter && !chapterAssetIdSet.has(assetId)) {
              throw new Error(`Asset ${assetId} is not linked to chapter ${chapter.id}`);
            }

            const clip = await createClip({
              project_id: projectId,
              asset_id: assetId,
              track_index: action.trackIndex ?? 0,
              start_time: startTime,
              in_point: inPoint,
              out_point: outPoint,
              role: action.role ?? null,
              description: action.description ?? null,
              is_essential: action.isEssential ?? false,
            });

            results.push({ index, action, success: true, clip });
            continue;
          }

          const existingClip = await getClip(action.clipId);
          if (!existingClip) {
            throw new Error(`Clip not found: ${action.clipId}`);
          }
          if (existingClip.project_id !== projectId) {
            throw new Error(`Clip ${action.clipId} does not belong to project ${projectId}`);
          }
          if (chapter && !chapterAssetIdSet.has(existingClip.asset_id)) {
            throw new Error(`Clip ${action.clipId} is not linked to chapter ${chapter.id}`);
          }

          const updates: Partial<Clip> = {};

          if (action.updates.startTime !== undefined) {
            ensureChapterLocalTime(action.updates.startTime, 'startTime');
            updates.start_time = toGlobalTime(action.updates.startTime);
          }
          if (action.updates.inPoint !== undefined) {
            ensureChapterLocalTime(action.updates.inPoint, 'inPoint');
            updates.in_point = toGlobalTime(action.updates.inPoint);
          }
          if (action.updates.outPoint !== undefined) {
            ensureChapterLocalTime(action.updates.outPoint, 'outPoint');
            updates.out_point = toGlobalTime(action.updates.outPoint);
          }
          if (action.updates.role !== undefined) {
            updates.role = action.updates.role;
          }
          if (action.updates.description !== undefined) {
            updates.description = action.updates.description;
          }
          if (action.updates.isEssential !== undefined) {
            updates.is_essential = action.updates.isEssential;
          }

          const effectiveIn = updates.in_point ?? existingClip.in_point;
          const effectiveOut = updates.out_point ?? existingClip.out_point;
          if (effectiveOut <= effectiveIn) {
            throw new Error('Out point must be greater than in point');
          }
          if ((updates.start_time ?? existingClip.start_time) < 0 || effectiveIn < 0) {
            throw new Error('Times must be non-negative');
          }

          const updated = await updateClip(action.clipId, updates);
          if (!updated) {
            throw new Error(`Failed to update clip ${action.clipId}`);
          }

          const refreshed = await getClip(action.clipId);
          results.push({ index, action, success: true, clip: refreshed ?? undefined });
        } catch (error) {
          results.push({
            index,
            action,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return createSuccessResponse({ results });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Clip handlers
  ipcMain.handle(IPC_CHANNELS.CLIP_CREATE, async (_, { id, createdAt, projectId, assetId, trackIndex, startTime, inPoint, outPoint, role, description, isEssential }) => {
    console.log('IPC: clip:create', id ?? 'auto', projectId, assetId);
    try {
      if (!projectId || !assetId) {
        return createErrorResponse('Project ID and Asset ID are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (id !== undefined && (!Number.isInteger(id) || id <= 0)) {
        return createErrorResponse('Clip ID must be a positive integer when provided', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (startTime < 0) {
        return createErrorResponse('Start time must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (inPoint < 0) {
        return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (outPoint <= inPoint) {
        return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const clip = await createClip({
        id,
        created_at: createdAt,
        project_id: projectId,
        asset_id: assetId,
        track_index: trackIndex ?? 0,
        start_time: startTime,
        in_point: inPoint,
        out_point: outPoint,
        role: role ?? null,
        description: description ?? null,
        is_essential: isEssential ?? false,
      });

      return createSuccessResponse(clip);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET, async (_, { id }) => {
    console.log('IPC: clip:get', id);
    try {
      const clip = await getClip(id);
      if (clip) {
        return createSuccessResponse(clip);
      } else {
        return createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_PROJECT, async (_, { projectId }) => {
    console.log('IPC: clip:get-by-project', projectId);
    try {
      const clips = await getClipsByProject(projectId);
      return createSuccessResponse(clips);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_ASSET, async (_, { assetId }) => {
    console.log('IPC: clip:get-by-asset', assetId);
    try {
      const clips = await getClipsByAsset(assetId);
      return createSuccessResponse(clips);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_UPDATE, async (_, { id, updates }) => {
    console.log('IPC: clip:update', id, updates);
    try {
      const success = await updateClip(id, updates);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_DELETE, async (_, { id }) => {
    console.log('IPC: clip:delete', id);
    try {
      const success = await deleteClip(id);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_BATCH_UPDATE, async (_, { updates }) => {
    console.log('IPC: clip:batch-update', updates?.length);
    try {
      if (!Array.isArray(updates) || updates.length === 0) {
        return createErrorResponse('Updates array is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const updatedCount = await batchUpdateClips(updates);
      return createSuccessResponse({ updatedCount });
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_SUGGEST_NAME, async (_, payload) => {
    console.log('IPC: clip:suggest-name');
    try {
      const chapterId = toNumberOrNull(payload?.chapterId);
      const inPoint = toNumberOrNull(payload?.inPoint);
      const outPoint = toNumberOrNull(payload?.outPoint);
      const model = typeof payload?.model === 'string' && payload.model.trim().length > 0
        ? payload.model.trim()
        : 'gpt-5-nano';
      const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';

      if (chapterId === null || !Number.isInteger(chapterId) || chapterId <= 0) {
        return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (inPoint === null || inPoint < 0) {
        return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (outPoint === null || outPoint <= inPoint) {
        return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!apiKey) {
        return createSuccessResponse({ name: null });
      }

      const chapter = await getChapter(chapterId);
      if (!chapter) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const transcriptRows = await getTranscriptsByChapter(chapterId);
      const transcriptExcerpt = buildTranscriptExcerpt(transcriptRows, inPoint, outPoint);
      const chapterTitle =
        (typeof payload?.chapterTitle === 'string' && payload.chapterTitle.trim().length > 0)
          ? payload.chapterTitle.trim()
          : chapter.title;

      let name: string | null = null;
      try {
        name = await requestOpenAIClipName({
          apiKey,
          model,
          chapterTitle,
          inPoint,
          outPoint,
          transcriptExcerpt,
        });
      } catch (primaryError) {
        if (model === 'gpt-4o-mini') {
          throw primaryError;
        }

        name = await requestOpenAIClipName({
          apiKey,
          model: 'gpt-4o-mini',
          chapterTitle,
          inPoint,
          outPoint,
          transcriptExcerpt,
        });
      }

      return createSuccessResponse({
        name: sanitizeSuggestedClipName(name),
      });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Timeline state handlers
  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_SAVE, async (_, payload) => {
    const projectId = payload?.projectId ?? payload?.project_id;
    const zoomLevel = payload?.zoomLevel ?? payload?.zoom_level;
    const scrollPosition = payload?.scrollPosition ?? payload?.scroll_position;
    const playheadTime = payload?.playheadTime ?? payload?.playhead_time;
    const selectedClipIds = payload?.selectedClipIds ?? payload?.selected_clip_ids;

    console.log('IPC: timeline:state-save', projectId);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const state = await saveTimelineState({
        project_id: projectId,
        zoom_level: zoomLevel ?? 100.0,
        scroll_position: scrollPosition ?? 0.0,
        playhead_time: playheadTime ?? 0.0,
        selected_clip_ids: Array.isArray(selectedClipIds) ? selectedClipIds : [],
      });

      return createSuccessResponse(state);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_LOAD, async (_, { projectId }) => {
    console.log('IPC: timeline:state-load', projectId);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const state = await loadTimelineState(projectId);
      if (state) {
        return createSuccessResponse(state);
      } else {
        return createSuccessResponse(null);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_UPDATE, async (_, { projectId, updates }) => {
    console.log('IPC: timeline:state-update', projectId, updates);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const success = await updateTimelineState(projectId, updates);
      return createSuccessResponse({ success });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Waveform handlers
  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE, async (event, {
    assetId,
    trackIndex,
    includeSourceTracks,
    playbackActive,
  }) => {
    console.log('IPC: waveform:generate', assetId, trackIndex, { includeSourceTracks, playbackActive });
    try {
      if (!assetId) {
        return createErrorResponse('Asset ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const asset = await getAsset(assetId);
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      if (!fs.existsSync(asset.file_path)) {
        return createErrorResponse('Asset file not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      const requestedTrackIndex = typeof trackIndex === 'number' ? trackIndex : 0;
      const includeAllSourceTracks = Boolean(includeSourceTracks);
      const isMkvMixRequest =
        requestedTrackIndex === -1 &&
        path.extname(asset.file_path).toLowerCase() === '.mkv';

      if (isMkvMixRequest) {
        const mkvResults = await generateWaveformTiersForMkvTracks(
          asset.file_path,
          assetId,
          (progress) => {
            event.sender.send(IPC_CHANNELS.WAVEFORM_PROGRESS, {
              assetId,
              trackIndex: progress.trackIndex ?? requestedTrackIndex,
              progress,
            });
          },
          {
            includeTier2: false,
            playbackActive: Boolean(playbackActive),
            trackIndices: includeAllSourceTracks ? undefined : [requestedTrackIndex],
          }
        );

        if (mkvResults && mkvResults.length > 0) {
          const requestedResult = mkvResults.find((result) => result.trackIndex === requestedTrackIndex) ?? {
            assetId,
            trackIndex: requestedTrackIndex,
            tiers: [],
          };
          return createSuccessResponse(requestedResult);
        }
      }

      const result = await generateWaveformTiers(
        asset.file_path,
        assetId,
        requestedTrackIndex,
        (progress) => {
          event.sender.send(IPC_CHANNELS.WAVEFORM_PROGRESS, {
            assetId,
            trackIndex: progress.trackIndex ?? requestedTrackIndex,
            progress,
          });
        },
        {
          includeTier2: false,
        }
      );

      // Note: Waveforms are now saved to database by the generateWaveformTiers function
      // to avoid redundant writes and race conditions

      return createSuccessResponse(result);
    } catch (error) {
      if (error instanceof WaveformError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? error.code as IPCErrorCode
          : IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
    }
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GET, async (_, { assetId, trackIndex, tierLevel }) => {
    console.log('IPC: waveform:get', assetId, trackIndex, tierLevel);
    try {
      if (!assetId || tierLevel === undefined) {
        return createErrorResponse('Asset ID and tier level are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const waveform = await getWaveform(assetId, trackIndex ?? 0, tierLevel);
      if (waveform) {
        return createSuccessResponse(waveform);
      } else {
        return createSuccessResponse(null);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE_TIER, async (event, { assetId, trackIndex, tierLevel }) => {
    console.log('IPC: waveform:generate-tier', assetId, trackIndex, tierLevel);
    try {
      if (!assetId || !tierLevel) {
        return createErrorResponse('Asset ID and tier level are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Generate specific tier - reuses full generation but we could optimize this later
      const asset = await getAsset(assetId);
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      if (!fs.existsSync(asset.file_path)) {
        return createErrorResponse('Asset file not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      const result = await generateWaveformTiers(
        asset.file_path,
        assetId,
        trackIndex ?? 0,
        (progress) => {
          event.sender.send(IPC_CHANNELS.WAVEFORM_PROGRESS, {
            assetId,
            trackIndex: progress.trackIndex ?? (trackIndex ?? 0),
            tierLevel,
            progress,
          });
        },
        {
          includeTier2: tierLevel === 2,
        }
      );

      // Handle case where result is null (audiowaveform not available)
      if (!result) {
        return createErrorResponse(
          'Waveform generation not available. Please install audiowaveform.',
          IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED
        );
      }

      // Save the specific tier
      const tier = result.tiers.find(t => t.level === tierLevel);
      if (tier) {
        await saveWaveform(assetId, trackIndex ?? 0, tierLevel, tier.peaks, tier.sampleRate, tier.duration);
      }

      return createSuccessResponse({ assetId, tierLevel, generated: !!tier });
    } catch (error) {
      if (error instanceof WaveformError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? error.code as IPCErrorCode
          : IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
    }
  });

  // Export handlers
  ipcMain.handle(IPC_CHANNELS.EXPORT_GENERATE, async (event, { projectId, format, options, filePath }: { projectId: number; format: ExportFormat; options?: { frameRate?: number; includeAudio?: boolean }; filePath: string }) => {
    console.log('IPC: export:generate', projectId, format, filePath);
    try {
      if (!projectId || !format || !filePath) {
        return createErrorResponse('Project ID, format, and file path are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Get project data
      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      // Get clips for project
      const clips = await getClipsByProject(projectId);
      if (clips.length === 0) {
        return createErrorResponse('No clips in project to export', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Get asset paths and durations
      const uniqueAssetIds = [...new Set(clips.map(c => c.asset_id))];
      const assetPaths = new Map<number, string>();
      const assetDurations = new Map<number, number>();
      const assetTrackIndices = new Map<number, number>();

      for (const assetId of uniqueAssetIds) {
        const asset = await getAsset(assetId);
        if (asset) {
          assetPaths.set(assetId, asset.file_path);
          assetDurations.set(assetId, asset.duration ?? 0);
          // Track index is per clip, but we can use the first clip's track index as reference
          const clipWithAsset = clips.find(c => c.asset_id === assetId);
          if (clipWithAsset) {
            assetTrackIndices.set(assetId, clipWithAsset.track_index);
          }
        }
      }

      // Calculate total duration
      const totalDuration = Math.max(...clips.map(c => c.start_time + (c.out_point - c.in_point)));

      // Generate export content based on format
      let content: string;
      const frameRate = options?.frameRate ?? 30;

      switch (format) {
        case 'fcpxml':
          content = generateFCPXML({
            projectName: project.name,
            projectId,
            frameRate,
            clips,
            assetPaths,
            assetDurations,
          });
          break;

        case 'json':
          content = generateJSON({
            projectId,
            projectName: project.name,
            frameRate,
            totalDuration,
            clips,
            assetPaths,
            audioTracks: Array.from(assetTrackIndices.entries()).map(([assetId, trackIndex]) => ({
              index: trackIndex,
              sourceFile: assetPaths.get(assetId) ?? '',
            })),
          });
          break;

        case 'edl':
          content = generateEDL({
            title: project.name,
            frameRate,
            clips,
            reelNames: new Map(Array.from(assetPaths.entries()).map(([id, path]) => [id, `REEL${id}`])),
          });
          break;

        default:
          return createErrorResponse(`Unsupported export format: ${format}`, IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Write to file
      await fs.promises.writeFile(filePath, content, 'utf-8');
      console.log(`[Export] Successfully exported ${format} to ${filePath}`);

      return createSuccessResponse({ filePath, format, clipCount: clips.length });
    } catch (error) {
      console.error('[Export] Generation failed:', error);
      return createErrorResponse(error instanceof Error ? error.message : String(error), IPC_ERROR_CODES.EXPORT_GENERATION_FAILED);
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_GET_FORMATS, async () => {
    console.log('IPC: export:get-formats');
    try {
      const formats = [
        { id: 'xml', name: 'FCPXML', description: 'Final Cut Pro XML format', extensions: ['.fcpxml'] },
        { id: 'edl', name: 'EDL', description: 'Edit Decision List (CMX3600)', extensions: ['.edl'] },
        { id: 'aaf', name: 'AAF', description: 'Advanced Authoring Format', extensions: ['.aaf'] },
      ];
      return createSuccessResponse(formats);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Dialog handler for save dialogs
  ipcMain.handle('dialog:showSaveDialog', async (event, options) => {
    const { dialog } = await import('electron');
    try {
      const result = await dialog.showSaveDialog(options);
      return result;
    } catch (error) {
      console.error('IPC dialog:showSaveDialog error', error);
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Suggestion handlers (Phase 4: Visual AI)
  ipcMain.handle(IPC_CHANNELS.SUGGESTION_CREATE, async (_, { chapterId, inPoint, outPoint, description, reasoning, provider }) => {
    console.log('IPC: suggestion:create', chapterId, inPoint, outPoint);
    try {
      if (!chapterId || inPoint === undefined || outPoint === undefined) {
        return createErrorResponse('Chapter ID, in_point, and out_point are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (inPoint < 0) {
        return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (outPoint <= inPoint) {
        return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const suggestion = await createSuggestion({
        chapter_id: chapterId,
        conversation_id: null,
        chat_message_id: null,
        in_point: inPoint,
        out_point: outPoint,
        description: description ?? null,
        reasoning: reasoning ?? null,
        provider: provider ?? null,
        action_type: 'create_clip',
        target_clip_id: null,
        action_payload_json: null,
        preview_snapshot_json: null,
        status: 'pending',
        display_order: 0,
        clip_id: null,
      });

      return createSuccessResponse(suggestion);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_GET_BY_CHAPTER, async (_, { chapterId, conversationId, status }) => {
    console.log('IPC: suggestion:get-by-chapter', chapterId, conversationId, status);
    try {
      if (!chapterId || !conversationId) {
        return createErrorResponse('Chapter ID and conversation ID are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const suggestions = await getSuggestionsByConversation(conversationId, chapterId, status);
      return createSuccessResponse(suggestions);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY, async (_, { id }) => {
    console.log('IPC: suggestion:apply', id);
    try {
      if (!id) {
        return createErrorResponse('Suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await applySuggestionWithClip(id);
      if (result.success) {
        return createSuccessResponse({ 
          applied: true, 
          clip: result.clip 
        });
      } else {
        return createErrorResponse(result.error || 'Failed to apply suggestion', IPC_ERROR_CODES.DATABASE_ERROR);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_PREVIEW, async (_, { id }) => {
    console.log('IPC: suggestion:preview', id);
    try {
      if (!id) {
        return createErrorResponse('Suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await previewSuggestionWithClip(id);
      if (result.success) {
        return createSuccessResponse({
          previewed: true,
          clip: result.clip,
        });
      }

      return createErrorResponse(result.error || 'Failed to preview suggestion', IPC_ERROR_CODES.DATABASE_ERROR);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_CANCEL_PREVIEW, async (_, { id }) => {
    console.log('IPC: suggestion:cancel-preview', id);
    try {
      if (!id) {
        return createErrorResponse('Suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await cancelSuggestionPreview(id);
      if (result.success) {
        return createSuccessResponse({
          cancelled: true,
          removedClipId: result.removedClipId,
          clip: result.clip,
        });
      }

      return createErrorResponse(result.error || 'Failed to cancel suggestion preview', IPC_ERROR_CODES.DATABASE_ERROR);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_REJECT, async (_, { id }) => {
    console.log('IPC: suggestion:reject', id);
    try {
      if (!id) {
        return createErrorResponse('Suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const suggestion = await getSuggestion(id);
      if (!suggestion) {
        return createErrorResponse('Suggestion not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const removedClipId =
        suggestion.status === 'pending' && suggestion.action_type === 'create_clip'
          ? (suggestion.clip_id ?? undefined)
          : undefined;
      const shouldReturnUpdatedClip =
        suggestion.status === 'pending' &&
        suggestion.action_type === 'update_clip' &&
        Boolean(suggestion.preview_snapshot_json) &&
        Number.isFinite(suggestion.target_clip_id);

      const success = await rejectSuggestion(id);
      if (success) {
        const restoredClip = shouldReturnUpdatedClip && suggestion.target_clip_id
          ? await getClip(suggestion.target_clip_id)
          : undefined;

        return createSuccessResponse({
          rejected: true,
          removedClipId,
          clip: restoredClip,
        });
      } else {
        return createErrorResponse('Suggestion not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY_ALL, async (_, { chapterId, conversationId }) => {
    console.log('IPC: suggestion:apply-all', chapterId, conversationId);
    try {
      if (!chapterId || !conversationId) {
        return createErrorResponse('Chapter ID and conversation ID are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const pendingSuggestions = await getSuggestionsByConversation(conversationId, chapterId, 'pending');
      const results: Array<{ suggestionId: number; success: boolean; clip?: Clip; error?: string }> = [];

      for (const suggestion of pendingSuggestions) {
        const result = await applySuggestionWithClip(suggestion.id);
        results.push({
          suggestionId: suggestion.id,
          success: result.success,
          clip: result.clip,
          error: result.error,
        });
      }

      const appliedCount = results.filter(r => r.success).length;
      const createdClips = results.filter(r => r.success && r.clip).map(r => r.clip!);

      return createSuccessResponse({ 
        appliedCount, 
        total: pendingSuggestions.length,
        clips: createdClips,
        results,
      });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Settings encryption handlers
  ipcMain.handle(IPC_CHANNELS.SETTINGS_ENCRYPT, async (_, { text }) => {
    console.log('IPC: settings:encrypt');
    try {
      if (!text) {
        return createErrorResponse('Text to encrypt is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(encryptSettingsPayload(text));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_DECRYPT, async (_, { encrypted }) => {
    console.log('IPC: settings:decrypt');
    try {
      if (!encrypted) {
        return createErrorResponse('Encrypted text is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(decryptSettingsPayload(encrypted));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}

export const registerLegacyIpcHandlers = registerIpcHandlers;
