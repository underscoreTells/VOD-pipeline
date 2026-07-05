import { ipcMain } from 'electron';
import type { ProviderConfigPayload } from '../../../shared/contracts/electron-api.js';
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
import { suggestChapterClipName } from '../../services/naming-service.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import { normalizeNamingModel } from '../../../shared/llm/naming-models.js';
import {
  clipBatchUpdateSchema,
  clipCreateSchema,
  clipGetByAssetSchema,
  clipGetByProjectSchema,
  clipIdSchema,
  clipSuggestNameSchema,
  clipUpdateSchema,
} from '../schemas.js';

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

export function registerClipHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CLIP_CREATE,
    async (_, payload) => {
      const parsed = clipCreateSchema.safeParse(payload);
      const id = parsed.success ? parsed.data.id : payload?.id;
      const createdAt = parsed.success ? parsed.data.createdAt : payload?.createdAt;
      const projectId = parsed.success ? parsed.data.projectId : payload?.projectId;
      const assetId = parsed.success ? parsed.data.assetId : payload?.assetId;
      logger.info('clip:create', id ?? 'auto', projectId, assetId);
      try {
        if (!parsed.success) {
          return createErrorResponse('Invalid clip payload', IPC_ERROR_CODES.VALIDATION_ERROR);
        }
        const {
          trackIndex,
          inPoint,
          outPoint,
          role,
          description,
          isEssential,
        } = parsed.data;

        if (!projectId || !assetId) {
          return createErrorResponse('Project ID and Asset ID are required', IPC_ERROR_CODES.VALIDATION_ERROR);
        }
        if (id !== undefined && (!Number.isInteger(id) || id <= 0)) {
          return createErrorResponse('Clip ID must be a positive integer when provided', IPC_ERROR_CODES.VALIDATION_ERROR);
        }
        if ((inPoint as number) < 0) {
          return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
        }
        if ((outPoint as number) <= (inPoint as number)) {
          return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
        }

        return createSuccessResponse(await createClip({
          id: id as number | undefined,
          created_at: createdAt,
          project_id: projectId as number,
          asset_id: assetId as number,
          track_index: trackIndex ?? 0,
          in_point: inPoint as number,
          out_point: outPoint as number,
          role: (role ?? null) as Clip['role'],
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

  ipcMain.handle(IPC_CHANNELS.CLIP_GET, async (_, payload) => {
    const id = payload?.id;
    logger.info('clip:get', id);
    try {
      const parsed = clipIdSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid clip payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const clip = await getClip(parsed.data.id as number);
      return clip
        ? createSuccessResponse(clip)
        : createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_PROJECT, async (_, payload) => {
    const projectId = payload?.projectId;
    logger.info('clip:get-by-project', projectId);
    try {
      const parsed = clipGetByProjectSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid clip payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      return createSuccessResponse(await getClipsByProject(parsed.data.projectId as number));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_ASSET, async (_, payload) => {
    const assetId = payload?.assetId;
    logger.info('clip:get-by-asset', assetId);
    try {
      const parsed = clipGetByAssetSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid clip payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      return createSuccessResponse(await getClipsByAsset(parsed.data.assetId as number));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_UPDATE, async (_, payload) => {
    const id = payload?.id;
    logger.info('clip:update', id);
    try {
      const parsed = clipUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid clip payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const updated = await updateClip(parsed.data.id as number, parsed.data.updates as Partial<Clip>);
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

  ipcMain.handle(IPC_CHANNELS.CLIP_DELETE, async (_, payload) => {
    const id = payload?.id;
    logger.info('clip:delete', id);
    try {
      const parsed = clipIdSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid clip payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const deleted = await deleteClip(parsed.data.id as number);
      return deleted
        ? createSuccessResponse(null)
        : createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_BATCH_UPDATE, async (_, payload) => {
    const updatesRaw = payload?.updates;
    logger.info('clip:batch-update', updatesRaw?.length);
    try {
      const parsed = clipBatchUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Updates array is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const updates = parsed.data.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return createErrorResponse('Updates array is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse({ updatedCount: await batchUpdateClips(updates as Array<{ id: number } & Partial<Clip>>) });
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
      const parsed = clipSuggestNameSchema.safeParse(payload);
      const model = normalizeNamingModel(payload?.model);
      const providerConfig = payload?.providerConfig && typeof payload.providerConfig === 'object'
        ? payload.providerConfig as ProviderConfigPayload
        : undefined;

      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path?.[0];
        if (field === 'chapterId') {
          return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
        }
        if (field === 'inPoint') {
          return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
        }
        return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const { chapterId, inPoint, outPoint } = parsed.data;

      if (inPoint === null || inPoint < 0) {
        return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (outPoint === null || outPoint <= inPoint) {
        return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse({
        name: await suggestChapterClipName({
          chapterId,
          inPoint,
          outPoint,
          model,
          providerConfig,
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
