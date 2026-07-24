import * as fs from 'node:fs';
import { ipcMain } from 'electron';
import { getAsset, getWaveform, saveWaveform } from '../../database/index.js';
import { getAudiowaveformPath } from '../../audiowaveformDetector.js';
import { getFFmpegPath, getFFprobePath } from '../../ffmpegDetector.js';
import { getWaveformCacheDirectoryPath } from '../../paths.js';
import {
  generateWaveformTiers,
  WaveformError,
} from '../../../pipeline/waveform.js';
import { requestProgressiveWaveformBlocks } from '../../../pipeline/progressive-waveform.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES, type IPCErrorCode } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import {
  waveformGenerateSchema,
  waveformGenerateTierSchema,
  waveformBlocksRequestSchema,
  waveformGetSchema,
} from '../schemas.js';
import { cancelHeavyMediaJob, enqueueHeavyMediaJob } from '../support/heavy-media-queue.js';

const logger = createLogger('WaveformHandlers');

export const WAVEFORM_HANDLER_CHANNELS = [
  IPC_CHANNELS.WAVEFORM_GENERATE,
  IPC_CHANNELS.WAVEFORM_GET,
  IPC_CHANNELS.WAVEFORM_GENERATE_TIER,
  IPC_CHANNELS.WAVEFORM_BLOCKS_REQUEST,
  IPC_CHANNELS.WAVEFORM_BLOCKS_CANCEL,
];

interface WaveformBlockRequestState {
  cancelled: boolean;
  jobKeys: Set<string>;
}

const waveformBlockRequests = new Map<string, WaveformBlockRequestState>();

export function registerWaveformHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WAVEFORM_BLOCKS_CANCEL, (_, payload) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
    const request = waveformBlockRequests.get(requestId);
    if (!request) return createSuccessResponse({ cancelled: false });
    request.cancelled = true;
    let cancelled = false;
    for (const key of request.jobKeys) cancelled = cancelHeavyMediaJob(key) || cancelled;
    return createSuccessResponse({ cancelled: cancelled || request.jobKeys.size === 0 });
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE, async (event, payload) => {
    const playbackActive = payload?.playbackActive;
    logger.info('waveform:generate', payload?.assetId, payload?.trackIndex, { playbackActive });
    try {
      const parsed = waveformGenerateSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid waveform payload', IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
      }
      const { assetId, trackIndex } = parsed.data;

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

      return createSuccessResponse({
        assetId: result.assetId,
        trackIndex: result.trackIndex,
        tiers: result.tiers.map((tier) => ({
          level: tier.level,
          peakCount: tier.peaks.length,
          sampleRate: tier.sampleRate,
          duration: tier.duration,
        })),
      });
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

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GET, async (_, payload) => {
    logger.info('waveform:get', payload?.assetId, payload?.trackIndex, payload?.tierLevel);
    try {
      const parsed = waveformGetSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid waveform payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const { assetId, trackIndex, tierLevel } = parsed.data;

      if (!assetId || tierLevel === undefined) {
        return createErrorResponse('Asset ID and tier level are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(await getWaveform(assetId, trackIndex ?? 0, tierLevel as 1 | 2 | 3));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE_TIER, async (event, payload) => {
    logger.info('waveform:generate-tier', payload?.assetId, payload?.trackIndex, payload?.tierLevel);
    try {
      const parsed = waveformGenerateTierSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid waveform payload', IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
      }
      const { assetId, trackIndex, tierLevel } = parsed.data;

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
        await saveWaveform(assetId, trackIndex ?? 0, tierLevel as 1 | 2 | 3, tier.peaks, tier.sampleRate, tier.duration);
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

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_BLOCKS_REQUEST, async (event, payload) => {
    logger.info(
      'waveform:blocks-request',
      payload?.assetId,
      payload?.trackIndex,
      payload?.startTime,
      payload?.endTime
    );
    try {
      const parsed = waveformBlocksRequestSchema.safeParse(payload);
      if (!parsed.success || parsed.data.endTime <= parsed.data.startTime) {
        return createErrorResponse('Invalid waveform block range', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const { requestId, assetId, trackIndex, startTime, endTime, pixelsPerSecond, requestMode } = parsed.data;
      const requestState: WaveformBlockRequestState = { cancelled: false, jobKeys: new Set() };
      waveformBlockRequests.set(requestId, requestState);
      const asset = await getAsset(assetId);
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (!fs.existsSync(asset.file_path)) {
        return createErrorResponse('Asset file not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }
      if (asset.duration !== null && startTime >= asset.duration) {
        return createErrorResponse('Waveform range starts after the asset ends', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const ffmpeg = getFFmpegPath();
      if (!ffmpeg) {
        return createErrorResponse('FFmpeg not found for waveform generation', IPC_ERROR_CODES.FFMPEG_NOT_FOUND);
      }

      const result = await requestProgressiveWaveformBlocks({
        sourcePath: asset.file_path,
        sourceDuration: asset.duration,
        cacheRoot: getWaveformCacheDirectoryPath(),
        trackIndex,
        startTime,
        endTime,
        pixelsPerSecond,
        ffmpegPath: ffmpeg.path,
        ffprobePath: getFFprobePath(ffmpeg.path),
        audiowaveform: getAudiowaveformPath(),
        scheduleBlock: (key, run) => {
          if (requestState.cancelled) {
            return Promise.reject(new Error('Waveform block generation cancelled'));
          }
          const requestJobKey = `${key}:request:${requestId}`;
          requestState.jobKeys.add(requestJobKey);
          return enqueueHeavyMediaJob(
            requestJobKey,
            'waveformBlock',
            requestMode ?? 'interactive',
            run,
            { resourceClass: 'cpu' }
          );
        },
        onProgress: (progress) => {
          event.sender.send(IPC_CHANNELS.WAVEFORM_BLOCK_PROGRESS, {
            assetId,
            trackIndex,
            ...progress,
          });
        },
      });

      return createSuccessResponse({
        assetId,
        trackIndex,
        ...result,
        status: 'ready' as const,
      });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
    } finally {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
      waveformBlockRequests.delete(requestId);
    }
  });
}
