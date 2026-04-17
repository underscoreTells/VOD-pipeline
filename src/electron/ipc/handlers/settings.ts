import { ipcMain } from 'electron';
import { createLogger } from '../../logger.js';
import { decryptSettingsPayload, encryptSettingsPayload } from '../../services/settings-service.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('SettingsHandlers');

export const SETTINGS_HANDLER_CHANNELS = [
  IPC_CHANNELS.SETTINGS_ENCRYPT,
  IPC_CHANNELS.SETTINGS_DECRYPT,
];

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_ENCRYPT, async (_, { text }) => {
    logger.info('settings:encrypt');
    try {
      if (!text) {
        return createErrorResponse('Text to encrypt is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(encryptSettingsPayload(text));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_DECRYPT, async (_, { encrypted }) => {
    logger.info('settings:decrypt');
    try {
      if (!encrypted) {
        return createErrorResponse('Encrypted text is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(decryptSettingsPayload(encrypted));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
