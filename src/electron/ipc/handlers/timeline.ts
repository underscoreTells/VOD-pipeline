import { ipcMain } from 'electron';
import { loadTimelineState, saveTimelineState, updateTimelineState } from '../../database/index.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import {
  timelineStateLoadSchema,
  timelineStateSaveSchema,
  timelineStateUpdateSchema,
} from '../schemas.js';

const logger = createLogger('TimelineHandlers');

export const TIMELINE_HANDLER_CHANNELS = [
  IPC_CHANNELS.TIMELINE_STATE_SAVE,
  IPC_CHANNELS.TIMELINE_STATE_LOAD,
  IPC_CHANNELS.TIMELINE_STATE_UPDATE,
];

export function registerTimelineHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_SAVE, async (_, payload) => {
    const parsed = timelineStateSaveSchema.safeParse(payload);
    const projectId = parsed.success
      ? (parsed.data.projectId ?? parsed.data.project_id)
      : (payload?.projectId ?? payload?.project_id);
    const zoomLevel = parsed.success
      ? (parsed.data.zoomLevel ?? parsed.data.zoom_level)
      : (payload?.zoomLevel ?? payload?.zoom_level);
    const scrollPosition = parsed.success
      ? (parsed.data.scrollPosition ?? parsed.data.scroll_position)
      : (payload?.scrollPosition ?? payload?.scroll_position);
    const playheadTime = parsed.success
      ? (parsed.data.playheadTime ?? parsed.data.playhead_time)
      : (payload?.playheadTime ?? payload?.playhead_time);
    const selectedClipIds = payload?.selectedClipIds ?? payload?.selected_clip_ids;

    logger.info('timeline:state-save', projectId);
    try {
      if (!parsed.success) {
        return createErrorResponse('Invalid timeline payload', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
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

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_LOAD, async (_, payload) => {
    const projectId = payload?.projectId;
    logger.info('timeline:state-load', projectId);
    try {
      const parsed = timelineStateLoadSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid timeline payload', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!parsed.data.projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createSuccessResponse(await loadTimelineState(parsed.data.projectId as number));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_UPDATE, async (_, payload) => {
    const projectId = payload?.projectId;
    logger.info('timeline:state-update', projectId);
    try {
      const parsed = timelineStateUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid timeline payload', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!parsed.data.projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createSuccessResponse({ success: await updateTimelineState(parsed.data.projectId as number, parsed.data.updates as never) });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });
}
