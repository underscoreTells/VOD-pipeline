import { ipcMain } from 'electron';
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
  toNumberOrNull,
} from '../handler-support.js';

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

export function registerChapterHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CHAPTER_CREATE, async (_, { projectId, title, startTime, endTime }) => {
    logger.info('chapter:create', projectId, title, startTime, endTime);
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

      return createSuccessResponse(chapter);
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET, async (_, { id }) => {
    logger.info('chapter:get', id);
    try {
      const chapter = await getChapter(id);
      return chapter
        ? createSuccessResponse(chapter)
        : createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_BY_PROJECT, async (_, { projectId }) => {
    logger.info('chapter:get-by-project', projectId);
    try {
      return createSuccessResponse(await getChaptersByProject(projectId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_UPDATE, async (_, { id, updates }) => {
    logger.info('chapter:update', id, updates);
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
      if (!success) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      if (normalizedUpdates.start_time !== undefined || normalizedUpdates.end_time !== undefined) {
        await deleteTranscriptsByChapter(id);
        const updatedChapter = await getChapter(id);

        const chapterAssetIds = await getAssetsForChapter(id);
        for (const assetId of chapterAssetIds) {
          await invalidateChapterProxy(id, assetId, {
            startTime: updatedChapter?.start_time,
            endTime: updatedChapter?.end_time,
          });
          invalidateChapterReverseProxy(id, assetId);
        }
      }

      await deleteDetailedTranscriptsByChapter(id);
      return createSuccessResponse(null);
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_DELETE, async (_, { id }) => {
    logger.info('chapter:delete', id);
    try {
      const linkedAssetIds = await getAssetsForChapter(id);
      for (const assetId of linkedAssetIds) {
        await invalidateChapterProxy(id, assetId);
        invalidateChapterReverseProxy(id, assetId);
      }

      const success = await deleteChapter(id);
      if (!success) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_ADD_ASSET, async (_, payload) => {
    const chapterId = toNumberOrNull(payload?.chapterId);
    const assetId = toNumberOrNull(payload?.assetId);
    const prewarmProxy = Boolean(payload?.prewarmProxy);
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions
        : undefined;

    logger.info('chapter:add-asset', chapterId, assetId, prewarmProxy);
    try {
      if (chapterId === null || !Number.isInteger(chapterId) || chapterId <= 0) {
        return createErrorResponse('Invalid chapterId', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (assetId === null || !Number.isInteger(assetId) || assetId <= 0) {
        return createErrorResponse('Invalid assetId', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      await addAssetToChapter(chapterId, assetId);
      await deleteTranscriptsByChapter(chapterId);
      await deleteDetailedTranscriptsByChapter(chapterId);
      await invalidateChapterProxy(chapterId, assetId);
      invalidateChapterReverseProxy(chapterId, assetId);

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

  ipcMain.handle(IPC_CHANNELS.CHAPTER_REMOVE_ASSET, async (_, { chapterId, assetId }) => {
    logger.info('chapter:remove-asset', chapterId, assetId);
    try {
      const success = await removeAssetFromChapter(chapterId, assetId);
      if (!success) {
        return createErrorResponse('Link not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      invalidateChapterReverseProxy(chapterId, assetId);
      await invalidateChapterProxy(chapterId, assetId);
      await deleteTranscriptsByChapter(chapterId);
      await deleteDetailedTranscriptsByChapter(chapterId);
      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_ASSETS, async (_, { chapterId }) => {
    logger.info('chapter:get-assets', chapterId);
    try {
      return createSuccessResponse(await getAssetsForChapter(chapterId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_REVERSE_PROXY_GET, async (_, payload) => {
    const chapterId = toNumberOrNull(payload?.chapterId);
    const assetId = toNumberOrNull(payload?.assetId);
    const ensureReady = Boolean(payload?.ensureReady);
    const requestMode = payload?.requestMode === 'interactive' ? 'interactive' : 'background';
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions
        : undefined;
    if (ensureReady) {
      logger.info('chapter:reverse-proxy-get', chapterId, assetId, ensureReady);
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
