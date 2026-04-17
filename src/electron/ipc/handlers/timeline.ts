import { ipcMain } from 'electron';
import { loadTimelineState, saveTimelineState, updateTimelineState } from '../../database/index.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('TimelineHandlers');

export const TIMELINE_HANDLER_CHANNELS = [
  IPC_CHANNELS.TIMELINE_STATE_SAVE,
  IPC_CHANNELS.TIMELINE_STATE_LOAD,
  IPC_CHANNELS.TIMELINE_STATE_UPDATE,
];

export function registerTimelineHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_SAVE, async (_, payload) => {
    const projectId = payload?.projectId ?? payload?.project_id;
    const zoomLevel = payload?.zoomLevel ?? payload?.zoom_level;
    const scrollPosition = payload?.scrollPosition ?? payload?.scroll_position;
    const playheadTime = payload?.playheadTime ?? payload?.playhead_time;
    const selectedClipIds = payload?.selectedClipIds ?? payload?.selected_clip_ids;

    logger.info('timeline:state-save', projectId);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(await saveTimelineState({
        project_id: projectId,
        zoom_level: zoomLevel ?? 100,
        scroll_position: scrollPosition ?? 0,
        playhead_time: playheadTime ?? 0,
        selected_clip_ids: Array.isArray(selectedClipIds) ? selectedClipIds : [],
      }));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_LOAD, async (_, { projectId }) => {
    logger.info('timeline:state-load', projectId);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createSuccessResponse(await loadTimelineState(projectId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_UPDATE, async (_, { projectId, updates }) => {
    logger.info('timeline:state-update', projectId);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createSuccessResponse({ success: await updateTimelineState(projectId, updates) });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });
}
