import {
  createSuggestion,
  getChapter,
  getClip,
  getSuggestionsByConversation,
} from '../../database/index.js';
import type { Clip, Suggestion } from '../../../shared/types/database.js';
import type {
  TranscriptDetailRequest,
  TimelineAction,
} from '../../../shared/types/agent-ipc.js';
import { clamp } from '../../../shared/utils/clip-timing.js';
import {
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from '../../../shared/utils/assistant-content.js';
import {
  normalizeTranscriptDetailRequests,
} from '../../../shared/utils/detailed-transcript-tools.js';
import { normalizeSuggestionProvider } from './payload.js';

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
        inPoint?: number;
        outPoint?: number;
        role?: Clip['role'];
        description?: string | null;
        isEssential?: boolean;
      } = {};
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
