import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  addAssetToChapter,
  deleteChapter,
  deleteDetailedTranscriptsByChapter,
  deleteTranscriptsByChapter,
  getAsset,
  getAssetsForChapter,
  getChapter,
  getChaptersByProject,
  updateChapter,
  createChapter,
  removeAssetFromChapter,
} from '../../database/index.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import {
  ensureChapterReverseProxyQuickReady,
  getChapterReverseProxyStatus,
  invalidateChapterProxy,
  invalidateChapterReverseProxy,
  scheduleChapterMediaPrewarm,
  scheduleChapterReverseProxyFullWarm,
} from '../handler-support.js';
import {
  chapterAddAssetSchema,
  chapterCreateSchema,
  chapterGetByProjectSchema,
  chapterIdSchema,
  chapterReverseProxyGetSchema,
  chapterUpdateSchema,
} from '../schemas.js';

const logger = createLogger('ChapterHandlers');

export const CHAPTER_HANDLER_CHANNELS = [
  IPC_CHANNELS.CHAPTER_CREATE,
  IPC_CHANNELS.CHAPTER_GET,
  IPC_CHANNELS.CHAPTER_GET_BY_PROJECT,
  IPC_CHANNELS.CHAPTER_UPDATE,
  IPC_CHANNELS.CHAPTER_DELETE,
  IPC_CHANNELS.CHAPTER_ADD_ASSET,
  IPC_CHANNELS.CHAPTER_REMOVE_ASSET,
  IPC_CHANNELS.CHAPTER_GET_ASSETS,
  IPC_CHANNELS.CHAPTER_REVERSE_PROXY_GET,
];

function chapterAssetLinkError(error: z.ZodError): string {
  const field = error.issues[0]?.path?.[0];
  return field === 'assetId' ? 'Invalid assetId' : 'Invalid chapterId';
}

export function registerChapterHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CHAPTER_CREATE, async (_, payload) => {
    const parsed = chapterCreateSchema.safeParse(payload);
    const projectId = parsed.success ? parsed.data.projectId : payload?.projectId;
    const title = parsed.success ? parsed.data.title : payload?.title;
    const startTime = parsed.success ? parsed.data.startTime : payload?.startTime;
    const endTime = parsed.success ? parsed.data.endTime : payload?.endTime;
    logger.info('chapter:create', projectId, title, startTime, endTime);
    try {
      if (!parsed.success) {
        return createErrorResponse('Invalid chapter payload', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if ((startTime as number) < 0) {
        return createErrorResponse('Start time must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if ((endTime as number) <= (startTime as number)) {
        return createErrorResponse('End time must be greater than start time', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const chapter = await createChapter({
        project_id: projectId as number,
        title: title as string,
        start_time: startTime as number,
        end_time: endTime as number,
      });

      return createSuccessResponse(chapter);
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET, async (_, payload) => {
    const id = payload?.id;
    logger.info('chapter:get', id);
    try {
      const parsed = chapterIdSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid chapter payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const chapter = await getChapter(parsed.data.id as number);
      return chapter
        ? createSuccessResponse(chapter)
        : createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_BY_PROJECT, async (_, payload) => {
    const projectId = payload?.projectId;
    logger.info('chapter:get-by-project', projectId);
    try {
      const parsed = chapterGetByProjectSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid chapter payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      return createSuccessResponse(await getChaptersByProject(parsed.data.projectId as number));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_UPDATE, async (_, payload) => {
    const id = payload?.id;
    logger.info('chapter:update', id, payload?.updates);
    try {
      const parsed = chapterUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid chapter payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const updates = parsed.data.updates as Record<string, unknown> | undefined;

      const normalizedUpdates: {
        title?: string;
        start_time?: number;
        end_time?: number;
        display_order?: number;
      } = {};

      if (updates?.title !== undefined) {
        normalizedUpdates.title = updates.title as string;
      }
      if (updates?.startTime !== undefined) {
        normalizedUpdates.start_time = updates.startTime as number;
      }
      if (updates?.endTime !== undefined) {
        normalizedUpdates.end_time = updates.endTime as number;
      }
      if (updates?.display_order !== undefined) {
        normalizedUpdates.display_order = updates.display_order as number;
      }

      const success = await updateChapter(parsed.data.id as number, normalizedUpdates);
      if (!success) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      if (normalizedUpdates.start_time !== undefined || normalizedUpdates.end_time !== undefined) {
        await deleteTranscriptsByChapter(parsed.data.id as number);
        const updatedChapter = await getChapter(parsed.data.id as number);

        const chapterAssetIds = await getAssetsForChapter(parsed.data.id as number);
        for (const assetId of chapterAssetIds) {
          await invalidateChapterProxy(parsed.data.id as number, assetId, {
            startTime: updatedChapter?.start_time,
            endTime: updatedChapter?.end_time,
          });
          await invalidateChapterReverseProxy(parsed.data.id as number, assetId);
        }
      }

      await deleteDetailedTranscriptsByChapter(parsed.data.id as number);
      return createSuccessResponse(null);
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_DELETE, async (_, payload) => {
    const id = payload?.id;
    logger.info('chapter:delete', id);
    try {
      const parsed = chapterIdSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid chapter payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const chapterId = parsed.data.id as number;
      const linkedAssetIds = await getAssetsForChapter(chapterId);
      for (const assetId of linkedAssetIds) {
        await invalidateChapterProxy(chapterId, assetId);
        await invalidateChapterReverseProxy(chapterId, assetId);
      }

      const success = await deleteChapter(chapterId);
      if (!success) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_ADD_ASSET, async (_, payload) => {
    const prewarmProxy = Boolean(payload?.prewarmProxy);
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions
        : undefined;

    const parsed = chapterAddAssetSchema.safeParse(payload);
    const chapterIdLog = parsed.success ? parsed.data.chapterId : null;
    const assetIdLog = parsed.success ? parsed.data.assetId : null;
    logger.info('chapter:add-asset', chapterIdLog, assetIdLog, prewarmProxy);
    try {
      if (!parsed.success) {
        return createErrorResponse(chapterAssetLinkError(parsed.error), IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const { chapterId, assetId } = parsed.data;

      await addAssetToChapter(chapterId, assetId);
      await deleteTranscriptsByChapter(chapterId);
      await deleteDetailedTranscriptsByChapter(chapterId);
      await invalidateChapterProxy(chapterId, assetId);
      await invalidateChapterReverseProxy(chapterId, assetId);

      if (prewarmProxy) {
        void scheduleChapterMediaPrewarm(chapterId, assetId, proxyOptions).catch((error) => {
          console.warn(`[ChapterPrewarm] Failed to prewarm chapter=${chapterId} asset=${assetId}:`, error);
        });
      }

      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_REMOVE_ASSET, async (_, payload) => {
    const chapterId = payload?.chapterId;
    const assetId = payload?.assetId;
    logger.info('chapter:remove-asset', chapterId, assetId);
    try {
      const success = await removeAssetFromChapter(chapterId, assetId);
      if (!success) {
        return createErrorResponse('Link not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      await invalidateChapterReverseProxy(chapterId, assetId);
      await invalidateChapterProxy(chapterId, assetId);
      await deleteTranscriptsByChapter(chapterId);
      await deleteDetailedTranscriptsByChapter(chapterId);
      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_ASSETS, async (_, payload) => {
    const chapterId = payload?.chapterId;
    logger.info('chapter:get-assets', chapterId);
    try {
      return createSuccessResponse(await getAssetsForChapter(chapterId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_REVERSE_PROXY_GET, async (_, payload) => {
    const ensureReady = payload?.ensureReady === true;
    const requestMode = payload?.requestMode === 'interactive' ? 'interactive' : 'background';
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions
        : undefined;
    const parsed = chapterReverseProxyGetSchema.safeParse(payload);
    if (ensureReady) {
      const chapterIdLog = parsed.success ? parsed.data.chapterId : null;
      const assetIdLog = parsed.success ? parsed.data.assetId : null;
      logger.info('chapter:reverse-proxy-get', chapterIdLog, assetIdLog, ensureReady);
    }

    try {
      if (!parsed.success) {
        return createErrorResponse(chapterAssetLinkError(parsed.error), IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const { chapterId, assetId } = parsed.data;

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
        if (
          statusBefore.status === 'missing'
          || statusBefore.status === 'error'
          || statusBefore.status === 'generating'
        ) {
          void ensureChapterReverseProxyQuickReady(chapter, asset, proxyOptions, {
            priority: requestMode,
            executionMode: requestMode,
          })
            .finally(() => {
              scheduleChapterReverseProxyFullWarm(chapter, asset, proxyOptions);
            })
            .catch((error: unknown) => {
              console.warn(
                `[ReverseProxy] Failed quick warm request chapter=${chapterId} asset=${assetId}:`,
                error
              );
            });
        } else if (statusBefore.status === 'ready' && statusBefore.quality === 'quick') {
          scheduleChapterReverseProxyFullWarm(chapter, asset, proxyOptions);
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
}
