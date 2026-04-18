import { dialog, ipcMain } from 'electron';
import { createLogger } from '../../logger.js';
import { IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse } from '../shared.js';

const logger = createLogger('DialogHandlers');

export const DIALOG_HANDLER_CHANNELS = ['dialog:showSaveDialog'];

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:showSaveDialog', async (_, options) => {
    logger.info('dialog:showSaveDialog');
    try {
      return await dialog.showSaveDialog(options);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
