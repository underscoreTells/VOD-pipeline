import * as fs from 'node:fs';
import { ipcMain } from 'electron';
import { getAsset, getWaveform, saveWaveform } from '../../database/index.js';
import {
  generateWaveformTiers,
  WaveformError,
} from '../../../pipeline/waveform.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES, type IPCErrorCode } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('WaveformHandlers');

export const WAVEFORM_HANDLER_CHANNELS = [
  IPC_CHANNELS.WAVEFORM_GENERATE,
  IPC_CHANNELS.WAVEFORM_GET,
  IPC_CHANNELS.WAVEFORM_GENERATE_TIER,
];

export function registerWaveformHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE, async (event, {
    assetId,
    trackIndex,
    playbackActive,
  }) => {
    logger.info('waveform:generate', assetId, trackIndex, { playbackActive });
    try {
      if (!assetId) {
        return createErrorResponse('Asset ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const asset = await getAsset(assetId);
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      if (!fs.existsSync(asset.file_path)) {
        return createErrorResponse('Asset file not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      const requestedTrackIndex = typeof trackIndex === 'number' ? trackIndex : 0;
      const result = await generateWaveformTiers(
        asset.file_path,
        assetId,
        requestedTrackIndex,
        (progress) => {
          event.sender.send(IPC_CHANNELS.WAVEFORM_PROGRESS, {
            assetId,
            trackIndex: progress.trackIndex ?? requestedTrackIndex,
            progress,
          });
        },
        {
          includeTier2: false,
        }
      );

      return createSuccessResponse(result);
    } catch (error) {
      if (error instanceof WaveformError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? (error.code as IPCErrorCode)
          : IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
    }
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GET, async (_, { assetId, trackIndex, tierLevel }) => {
    logger.info('waveform:get', assetId, trackIndex, tierLevel);
    try {
      if (!assetId || tierLevel === undefined) {
        return createErrorResponse('Asset ID and tier level are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(await getWaveform(assetId, trackIndex ?? 0, tierLevel));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE_TIER, async (event, { assetId, trackIndex, tierLevel }) => {
    logger.info('waveform:generate-tier', assetId, trackIndex, tierLevel);
    try {
      if (!assetId || !tierLevel) {
        return createErrorResponse('Asset ID and tier level are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const asset = await getAsset(assetId);
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (!fs.existsSync(asset.file_path)) {
        return createErrorResponse('Asset file not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      const result = await generateWaveformTiers(
        asset.file_path,
        assetId,
        trackIndex ?? 0,
        (progress) => {
          event.sender.send(IPC_CHANNELS.WAVEFORM_PROGRESS, {
            assetId,
            trackIndex: progress.trackIndex ?? (trackIndex ?? 0),
            tierLevel,
            progress,
          });
        },
        {
          includeTier2: tierLevel === 2,
        }
      );

      if (!result) {
        return createErrorResponse(
          'Waveform generation not available. Please install audiowaveform.',
          IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED
        );
      }

      const tier = result.tiers.find((item) => item.level === tierLevel);
      if (tier) {
        await saveWaveform(assetId, trackIndex ?? 0, tierLevel, tier.peaks, tier.sampleRate, tier.duration);
      }

      return createSuccessResponse({ assetId, tierLevel, generated: Boolean(tier) });
    } catch (error) {
      if (error instanceof WaveformError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? (error.code as IPCErrorCode)
          : IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
    }
  });
}
