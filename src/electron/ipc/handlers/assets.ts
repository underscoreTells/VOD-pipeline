import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { FFmpegError, getVideoMetadata, isValidVideo } from '../../../pipeline/ffmpeg.js';
import type { AssetMetadata } from '../../../shared/types/database.js';
import { createAsset, deleteAsset, getAsset, getAssetsByProject } from '../../database/index.js';
import { createLogger } from '../../logger.js';
import { enrichProjectAsset } from '../../services/asset-availability-service.js';
import { IPC_CHANNELS, IPC_ERROR_CODES, type IPCErrorCode } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('AssetHandlers');

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts', '.m2ts', '.mts'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg', '.wma'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];

export const ASSET_HANDLER_CHANNELS = [
  IPC_CHANNELS.ASSET_ADD,
  IPC_CHANNELS.ASSET_GET,
  IPC_CHANNELS.ASSET_GET_BY_PROJECT,
  IPC_CHANNELS.ASSET_DELETE,
];

function determineAssetType(filePath: string): 'video' | 'audio' | 'image' {
  const extension = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTENSIONS.includes(extension)) {
    return 'audio';
  }
  if (IMAGE_EXTENSIONS.includes(extension)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.includes(extension)) {
    return 'video';
  }

  throw new Error(`Unsupported file extension: ${extension}`);
}

export function registerAssetHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ASSET_ADD, async (_, { projectId, filePath }) => {
    logger.info('asset:add', projectId, filePath);

    try {
      if (!fs.existsSync(filePath)) {
        return createErrorResponse('File not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      const fileType = determineAssetType(filePath);
      let metadata: AssetMetadata = {};
      let duration: number | null = null;

      if (fileType === 'video') {
        try {
          const valid = await isValidVideo(filePath);
          if (!valid) {
            return createErrorResponse('Invalid or unsupported video format', IPC_ERROR_CODES.INVALID_FORMAT);
          }
        } catch (error) {
          if (error instanceof FFmpegError && error.code === 'FFPROBE_TIMEOUT') {
            return createErrorResponse(
              'Video validation timed out - file may be too large or corrupted. Try a smaller file or check file integrity.',
              IPC_ERROR_CODES.TIMEOUT
            );
          }

          return createErrorResponse('Failed to validate video file', IPC_ERROR_CODES.INVALID_FORMAT);
        }

        try {
          const videoMetadata = await getVideoMetadata(filePath, 60000);
          metadata = {
            width: videoMetadata.width,
            height: videoMetadata.height,
            fps: videoMetadata.fps,
            videoCodec: videoMetadata.videoCodec,
            audioCodec: videoMetadata.audioCodec,
            audioTracks: videoMetadata.audioTracks,
            bitrate: videoMetadata.bitrate,
            container: videoMetadata.container,
            duration: videoMetadata.duration,
          };
          duration = videoMetadata.duration;
        } catch (error) {
          logger.warn('Failed to extract video metadata:', error);
        }
      }

      const asset = await createAsset({
        project_id: projectId,
        file_path: filePath,
        file_type: fileType,
        duration,
        metadata,
      });

      return createSuccessResponse(asset);
    } catch (error) {
      if (error instanceof FFmpegError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? (error.code as IPCErrorCode)
          : IPC_ERROR_CODES.UNKNOWN_ERROR;
        return createErrorResponse(error.message, errorCode);
      }

      if (error instanceof Error && error.message.startsWith('Unsupported file extension:')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.INVALID_FORMAT);
      }

      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_GET, async (_, { id }) => {
    logger.info('asset:get', id);
    try {
      const asset = await getAsset(id);
      return asset
        ? createSuccessResponse(enrichProjectAsset(asset))
        : createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_GET_BY_PROJECT, async (_, { projectId }) => {
    logger.info('asset:get-by-project', projectId);
    try {
      const assets = await getAssetsByProject(projectId);
      return createSuccessResponse(assets.map(enrichProjectAsset));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_DELETE, async (_, { id }) => {
    logger.info('asset:delete', id);
    try {
      const deleted = await deleteAsset(id);
      return deleted
        ? createSuccessResponse(null)
        : createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });
}
