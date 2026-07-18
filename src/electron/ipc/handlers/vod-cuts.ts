import { ipcMain } from 'electron';
import {
  clearVodCutDraft,
  commitVodCut,
  loadVodCutDraft,
  saveVodCutDraft,
} from '../../database/index.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { scheduleChapterMediaPrewarm } from '../handler-support.js';
import {
  vodCutCommitSchema,
  vodCutDraftKeySchema,
  vodCutDraftSaveSchema,
} from '../schemas.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('VodCutHandlers');

export const VOD_CUT_HANDLER_CHANNELS = [
  IPC_CHANNELS.VOD_CUT_DRAFT_SAVE,
  IPC_CHANNELS.VOD_CUT_DRAFT_LOAD,
  IPC_CHANNELS.VOD_CUT_DRAFT_CLEAR,
  IPC_CHANNELS.VOD_CUT_COMMIT,
];

export function registerVodCutHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.VOD_CUT_DRAFT_SAVE, async (_, payload) => {
    const parsed = vodCutDraftSaveSchema.safeParse(payload);
    if (!parsed.success) {
      return createErrorResponse('Invalid VOD cut draft', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    try {
      return createSuccessResponse(await saveVodCutDraft(
        parsed.data.projectId,
        parsed.data.assetId,
        parsed.data.ranges,
      ));
    } catch (error) {
      logger.error('Failed to save VOD cut draft', error);
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.VOD_CUT_DRAFT_LOAD, async (_, payload) => {
    const parsed = vodCutDraftKeySchema.safeParse(payload);
    if (!parsed.success) {
      return createErrorResponse('Invalid VOD cut draft key', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    try {
      return createSuccessResponse(await loadVodCutDraft(parsed.data.projectId, parsed.data.assetId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.VOD_CUT_DRAFT_CLEAR, async (_, payload) => {
    const parsed = vodCutDraftKeySchema.safeParse(payload);
    if (!parsed.success) {
      return createErrorResponse('Invalid VOD cut draft key', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    try {
      await clearVodCutDraft(parsed.data.projectId, parsed.data.assetId);
      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.VOD_CUT_COMMIT, async (_, payload) => {
    const parsed = vodCutCommitSchema.safeParse(payload);
    if (!parsed.success) {
      return createErrorResponse('Invalid VOD cut ranges', IPC_ERROR_CODES.VALIDATION_ERROR);
    }
    try {
      const chapters = await commitVodCut(
        parsed.data.projectId,
        parsed.data.assetId,
        parsed.data.ranges,
      );
      if (parsed.data.prewarmProxy) {
        for (const chapter of chapters) {
          void scheduleChapterMediaPrewarm(
            chapter.id,
            parsed.data.assetId,
            parsed.data.proxyOptions,
          ).catch((error) => {
            logger.warn(`Failed to prewarm chapter=${chapter.id}`, error);
          });
        }
      }
      return createSuccessResponse(chapters);
    } catch (error) {
      const validationError = error instanceof Error && error.name === 'VodCutValidationError';
      return createErrorResponse(
        error,
        validationError ? IPC_ERROR_CODES.VALIDATION_ERROR : IPC_ERROR_CODES.DATABASE_ERROR,
      );
    }
  });
}
