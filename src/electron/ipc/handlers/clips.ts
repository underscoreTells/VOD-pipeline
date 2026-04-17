import { ipcMain } from 'electron';
import type { Clip } from '../../../shared/types/database.js';
import {
  batchUpdateClips,
  createClip,
  deleteClip,
  getClip,
  getClipsByAsset,
  getClipsByProject,
  updateClip,
} from '../../database/index.js';
import { createLogger } from '../../logger.js';
import { suggestChapterClipName } from '../../services/clip-naming-service.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('ClipHandlers');

export const CLIP_HANDLER_CHANNELS = [
  IPC_CHANNELS.CLIP_CREATE,
  IPC_CHANNELS.CLIP_GET,
  IPC_CHANNELS.CLIP_GET_BY_PROJECT,
  IPC_CHANNELS.CLIP_GET_BY_ASSET,
  IPC_CHANNELS.CLIP_UPDATE,
  IPC_CHANNELS.CLIP_DELETE,
  IPC_CHANNELS.CLIP_BATCH_UPDATE,
  IPC_CHANNELS.CLIP_SUGGEST_NAME,
];

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function registerClipHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CLIP_CREATE,
    async (_, { id, createdAt, projectId, assetId, trackIndex, startTime, inPoint, outPoint, role, description, isEssential }) => {
      logger.info('clip:create', id ?? 'auto', projectId, assetId);
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

        return createSuccessResponse(await createClip({
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
        }));
      } catch (error) {
        if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
          return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
        }
        return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.CLIP_GET, async (_, { id }) => {
    logger.info('clip:get', id);
    try {
      const clip = await getClip(id);
      return clip
        ? createSuccessResponse(clip)
        : createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_PROJECT, async (_, { projectId }) => {
    logger.info('clip:get-by-project', projectId);
    try {
      return createSuccessResponse(await getClipsByProject(projectId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_ASSET, async (_, { assetId }) => {
    logger.info('clip:get-by-asset', assetId);
    try {
      return createSuccessResponse(await getClipsByAsset(assetId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_UPDATE, async (_, { id, updates }: { id: number; updates: Partial<Clip> }) => {
    logger.info('clip:update', id);
    try {
      const updated = await updateClip(id, updates);
      return updated
        ? createSuccessResponse(null)
        : createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_DELETE, async (_, { id }) => {
    logger.info('clip:delete', id);
    try {
      const deleted = await deleteClip(id);
      return deleted
        ? createSuccessResponse(null)
        : createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_BATCH_UPDATE, async (_, { updates }) => {
    logger.info('clip:batch-update', updates?.length);
    try {
      if (!Array.isArray(updates) || updates.length === 0) {
        return createErrorResponse('Updates array is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse({ updatedCount: await batchUpdateClips(updates) });
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_SUGGEST_NAME, async (_, payload) => {
    logger.info('clip:suggest-name');
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

      return createSuccessResponse({
        name: await suggestChapterClipName({
          chapterId,
          inPoint,
          outPoint,
          model,
          apiKey,
          chapterTitle: typeof payload?.chapterTitle === 'string' ? payload.chapterTitle : undefined,
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Chapter not found') {
        return createErrorResponse(error.message, IPC_ERROR_CODES.NOT_FOUND);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
