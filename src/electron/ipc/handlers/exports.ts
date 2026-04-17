import { dialog, ipcMain } from 'electron';
import type { ExportFormat } from '../../../pipeline/export/index.js';
import { createLogger } from '../../logger.js';
import { exportProjectToFile, getExportFormats } from '../../services/export-service.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('ExportHandlers');

export const EXPORT_HANDLER_CHANNELS = [
  IPC_CHANNELS.EXPORT_GENERATE,
  IPC_CHANNELS.EXPORT_GET_FORMATS,
  'dialog:showSaveDialog',
];

export function registerExportHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_GENERATE,
    async (_, { projectId, format, options, filePath }: { projectId: number; format: ExportFormat; options?: { frameRate?: number; includeAudio?: boolean }; filePath: string }) => {
      logger.info('export:generate', projectId, format, filePath);
      try {
        if (!projectId || !format || !filePath) {
          return createErrorResponse('Project ID, format, and file path are required', IPC_ERROR_CODES.VALIDATION_ERROR);
        }

        return createSuccessResponse(await exportProjectToFile({ projectId, format, options, filePath }));
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

  ipcMain.handle('dialog:showSaveDialog', async (_, options) => {
    logger.info('dialog:showSaveDialog');
    try {
      return await dialog.showSaveDialog(options);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
