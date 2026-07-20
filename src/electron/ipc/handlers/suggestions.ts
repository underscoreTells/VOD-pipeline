import { ipcMain } from 'electron';
import {
  applySuggestionWithClip,
  applySuggestionsBatch,
  createSuggestion,
  getClip,
  getSuggestion,
  getSuggestionsByConversation,
  rejectSuggestion,
  rejectSuggestionsBatch,
  restoreRejectedSuggestionsBatch,
  revertAppliedSuggestionsBatch,
} from '../../database/index.js';
import type { Clip } from '../../../shared/types/database.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { toNumberOrNull } from '../handler-support.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('SuggestionHandlers');

export const SUGGESTION_HANDLER_CHANNELS = [
  IPC_CHANNELS.SUGGESTION_CREATE,
  IPC_CHANNELS.SUGGESTION_GET_BY_CHAPTER,
  IPC_CHANNELS.SUGGESTION_APPLY,
  IPC_CHANNELS.SUGGESTION_REJECT,
  IPC_CHANNELS.SUGGESTION_APPLY_ALL,
  IPC_CHANNELS.SUGGESTION_APPLY_BATCH,
  IPC_CHANNELS.SUGGESTION_REJECT_BATCH,
  IPC_CHANNELS.SUGGESTION_RESTORE_BATCH,
  IPC_CHANNELS.SUGGESTION_REVERT_BATCH,
];

export function registerSuggestionHandlers(): void {
  const parseSuggestionIds = (payload: unknown): number[] => {
    const ids = (payload as { suggestionIds?: unknown } | null)?.suggestionIds;
    if (!Array.isArray(ids)) return [];
    return ids.filter(
      (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
    );
  };

  const toBatchResponse = (result: Awaited<ReturnType<typeof applySuggestionsBatch>>) => {
    if (result.success) {
      return createSuccessResponse({
        appliedCount: result.appliedCount,
        total: result.total,
        results: result.results,
      });
    }
    // Surface auto-rejections persisted alongside a failed batch so the
    // renderer can reconcile local suggestion status instead of leaving
    // them displayed as pending.
    const autoRejectedIds = result.results
      .filter((item) => item.autoRejected)
      .map((item) => item.suggestionId);
    return {
      ...createErrorResponse(result.error || 'Suggestion batch failed', IPC_ERROR_CODES.DATABASE_ERROR),
      ...(autoRejectedIds.length > 0 ? { autoRejectedIds } : {}),
    };
  };

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_CREATE, async (_, { chapterId, inPoint, outPoint, description, reasoning, provider }) => {
    logger.info('suggestion:create', chapterId, inPoint, outPoint);
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

      return createSuccessResponse(await createSuggestion({
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
      }));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_GET_BY_CHAPTER, async (_, { chapterId, conversationId, status }) => {
    logger.info('suggestion:get-by-chapter', chapterId, conversationId, status);
    try {
      const normalizedChapterId = toNumberOrNull(chapterId);
      if (
        normalizedChapterId === null ||
        !Number.isInteger(normalizedChapterId) ||
        normalizedChapterId <= 0 ||
        !conversationId
      ) {
        return createErrorResponse('Chapter ID and conversation ID are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(await getSuggestionsByConversation(conversationId, normalizedChapterId, status));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY, async (_, { id }) => {
    logger.info('suggestion:apply', id);
    try {
      if (!id) {
        return createErrorResponse('Suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await applySuggestionWithClip(id);
      return result.success
        ? createSuccessResponse({ applied: true, clip: result.clip })
        : createErrorResponse(result.error || 'Failed to apply suggestion', IPC_ERROR_CODES.DATABASE_ERROR);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_REJECT, async (_, { id }) => {
    logger.info('suggestion:reject', id);
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
      if (!success) {
        return createErrorResponse('Suggestion not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const restoredClip = shouldReturnUpdatedClip && suggestion.target_clip_id
        ? await getClip(suggestion.target_clip_id)
        : undefined;

      return createSuccessResponse({
        rejected: true,
        removedClipId,
        clip: restoredClip,
      });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY_ALL, async (_, { chapterId, conversationId }) => {
    logger.info('suggestion:apply-all', chapterId, conversationId);
    try {
      const normalizedChapterId = toNumberOrNull(chapterId);
      if (
        normalizedChapterId === null ||
        !Number.isInteger(normalizedChapterId) ||
        normalizedChapterId <= 0 ||
        !conversationId
      ) {
        return createErrorResponse('Chapter ID and conversation ID are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const pendingSuggestions = await getSuggestionsByConversation(conversationId, normalizedChapterId, 'pending');
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

      const appliedCount = results.filter((result) => result.success).length;
      const createdClips = results.filter((result) => result.success && result.clip).map((result) => result.clip!);

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

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY_BATCH, async (_, payload) => {
    const suggestionIds = parseSuggestionIds(payload);
    if (suggestionIds.length === 0) {
      return createErrorResponse('At least one suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    return toBatchResponse(await applySuggestionsBatch(suggestionIds));
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_REJECT_BATCH, async (_, payload) => {
    const suggestionIds = parseSuggestionIds(payload);
    if (suggestionIds.length === 0) {
      return createErrorResponse('At least one suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    return toBatchResponse(await rejectSuggestionsBatch(suggestionIds));
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_RESTORE_BATCH, async (_, payload) => {
    const suggestionIds = parseSuggestionIds(payload);
    if (suggestionIds.length === 0) {
      return createErrorResponse('At least one suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    return toBatchResponse(await restoreRejectedSuggestionsBatch(suggestionIds));
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_REVERT_BATCH, async (_, payload) => {
    const rawItems = (payload as { items?: unknown } | null)?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return createErrorResponse('At least one suggestion revert item is required', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    const items = rawItems.filter((item): item is Parameters<typeof revertAppliedSuggestionsBatch>[0][number] => {
      if (!item || typeof item !== 'object') return false;
      const suggestionId = (item as { suggestionId?: unknown }).suggestionId;
      return typeof suggestionId === 'number' && Number.isInteger(suggestionId) && suggestionId > 0;
    });
    if (items.length !== rawItems.length) {
      return createErrorResponse('Suggestion revert items are invalid', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    return toBatchResponse(await revertAppliedSuggestionsBatch(items));
  });
}
