import { ipcMain } from 'electron';
import type { ExportFormat } from '../../../pipeline/export/index.js';
import { createLogger } from '../../logger.js';
import { exportProjectToFile, getExportFormats } from '../../services/export-service.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import { exportGenerateSchema } from '../schemas.js';

const logger = createLogger('ExportHandlers');

export const EXPORT_HANDLER_CHANNELS = [
  IPC_CHANNELS.EXPORT_GENERATE,
  IPC_CHANNELS.EXPORT_GET_FORMATS,
];

export function registerExportHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_GENERATE,
    async (_, payload) => {
      const projectId = payload?.projectId;
      const format = payload?.format;
      const filePath = payload?.filePath;
      logger.info('export:generate', projectId, format, filePath);
      try {
        const parsed = exportGenerateSchema.safeParse(payload);
        if (!parsed.success) {
          return createErrorResponse('Invalid export payload', IPC_ERROR_CODES.EXPORT_GENERATION_FAILED);
        }
        if (!parsed.data.projectId || !parsed.data.format || !parsed.data.filePath) {
          return createErrorResponse('Project ID, format, and file path are required', IPC_ERROR_CODES.VALIDATION_ERROR);
        }

        return createSuccessResponse(await exportProjectToFile({
          projectId: parsed.data.projectId,
          format: parsed.data.format as ExportFormat,
          options: parsed.data.options as { frameRate?: number; includeAudio?: boolean } | undefined,
          filePath: parsed.data.filePath,
        }));
      } catch (error) {
        return createErrorResponse(error, IPC_ERROR_CODES.EXPORT_GENERATION_FAILED);
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.EXPORT_GET_FORMATS, async () => {
    logger.info('export:get-formats');
    try {
      return createSuccessResponse(getExportFormats());
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
