import { ipcMain } from 'electron';
import { createLogger } from '../../logger.js';
import { decryptSettingsPayload, encryptSettingsPayload } from '../../services/settings-service.js';
import { listProviderModels } from '../../services/provider-model-service.js';
import { normalizeProvider } from '../../../shared/llm/provider-registry.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('SettingsHandlers');

export const SETTINGS_HANDLER_CHANNELS = [
  IPC_CHANNELS.SETTINGS_ENCRYPT,
  IPC_CHANNELS.SETTINGS_DECRYPT,
  IPC_CHANNELS.SETTINGS_LIST_PROVIDER_MODELS,
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

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_PROVIDER_MODELS, async (_, payload) => {
    const provider = normalizeProvider(payload?.provider);
    try {
      if (!provider || !payload?.agentConfig || typeof payload.agentConfig !== 'object') {
        return createErrorResponse('Provider configuration is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createSuccessResponse(await listProviderModels(
        provider,
        payload.agentConfig,
        payload.refresh === true
      ));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
