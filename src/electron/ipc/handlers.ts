import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IPC_CHANNELS, IPC_ERROR_CODES, type IPCErrorCode } from './channels.js';
import {
  createProject,
  getProject,
  listProjects,
  deleteProject,
  updateProject,
  createAsset,
  getAsset,
  getAssetsByProject,
  deleteAsset,
  createChapter,
  getChapter,
  getChaptersByProject,
  updateChapter,
  deleteChapter,
  addAssetToChapter,
  removeAssetFromChapter,
  getAssetsForChapter,
  batchInsertTranscripts,
  deleteTranscriptsByChapter,
} from '../database/db.js';
import { getAgentBridge } from '../agent-bridge.js';
import { getVideoMetadata, isValidVideo, extractAudio, FFmpegError } from '../../pipeline/ffmpeg.js';
import { transcribe, WhisperError } from '../../pipeline/whisper.js';
import type { AssetMetadata } from '../../shared/types/database.js';

// Helper to create consistent error responses
function createErrorResponse(error: unknown, code: IPCErrorCode = IPC_ERROR_CODES.UNKNOWN_ERROR) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[IPC Error] ${code}: ${message}`, error);
  return {
    success: false as const,
    error: message,
    code,
  };
}

// Helper to create success responses
function createSuccessResponse<T>(data: T) {
  return {
    success: true as const,
    data,
  };
}

export function registerIpcHandlers() {
  console.log('Registering IPC handlers...');

  // Project handlers
  ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE, async (_, { name }) => {
    console.log('IPC: project:create', name);
    try {
      const project = await createProject(name);
      return createSuccessResponse(project);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_ALL, async () => {
    console.log('IPC: project:get-all');
    try {
      const projects = await listProjects();
      return createSuccessResponse(projects);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET, async (_, { id }) => {
    console.log('IPC: project:get', id);
    try {
      const project = await getProject(id);
      if (project) {
        return createSuccessResponse(project);
      } else {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_UPDATE, async (_, { id, name }) => {
    console.log('IPC: project:update', id, name);
    try {
      const success = await updateProject(id, name);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_DELETE, async (_, { id }) => {
    console.log('IPC: project:delete', id);
    try {
      const success = await deleteProject(id);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Asset handlers
  ipcMain.handle(IPC_CHANNELS.ASSET_ADD, async (event, { projectId, filePath }) => {
    console.log('IPC: asset:add', projectId, filePath);

    try {
      if (!fs.existsSync(filePath)) {
        return createErrorResponse('File not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      if (!await isValidVideo(filePath)) {
        return createErrorResponse('Invalid or unsupported video format', IPC_ERROR_CODES.INVALID_FORMAT);
      }

      let metadata: AssetMetadata;
      let duration: number | null = null;
      try {
        const videoMetadata = await getVideoMetadata(filePath);
        metadata = {
          width: videoMetadata.width,
          height: videoMetadata.height,
          fps: videoMetadata.fps,
          videoCodec: videoMetadata.videoCodec,
          audioCodec: videoMetadata.audioCodec,
          audioTracks: videoMetadata.audioTracks,
          bitrate: videoMetadata.bitrate,
          container: videoMetadata.container,
        };
        duration = videoMetadata.duration;
      } catch (error) {
        console.warn('[Asset Add] Failed to extract metadata:', error);
        metadata = {};
      }

      const ext = path.extname(filePath).toLowerCase();
      const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts', '.m2ts', '.mts'];
      const audioExtensions = ['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg', '.wma'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
      
      let fileType: 'video' | 'audio' | 'image';
      if (audioExtensions.includes(ext)) {
        fileType = 'audio';
      } else if (imageExtensions.includes(ext)) {
        fileType = 'image';
      } else if (videoExtensions.includes(ext)) {
        fileType = 'video';
      } else {
        return createErrorResponse(`Unsupported file extension: ${ext}`, IPC_ERROR_CODES.INVALID_FORMAT);
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
        // Validate error code is a known IPC error code
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode) 
          ? error.code as IPCErrorCode 
          : IPC_ERROR_CODES.UNKNOWN_ERROR;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_GET, async (_, { id }) => {
    console.log('IPC: asset:get', id);
    try {
      const asset = await getAsset(id);
      if (asset) {
        return createSuccessResponse(asset);
      } else {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_GET_BY_PROJECT, async (_, { projectId }) => {
    console.log('IPC: asset:get-by-project', projectId);
    try {
      const assets = await getAssetsByProject(projectId);
      return createSuccessResponse(assets);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_DELETE, async (_, { id }) => {
    console.log('IPC: asset:delete', id);
    try {
      const success = await deleteAsset(id);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Chapter handlers
  ipcMain.handle(IPC_CHANNELS.CHAPTER_CREATE, async (_, { projectId, title, startTime, endTime }) => {
    console.log('IPC: chapter:create', projectId, title, startTime, endTime);
    try {
      if (startTime < 0) {
        return createErrorResponse('Start time must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (endTime <= startTime) {
        return createErrorResponse('End time must be greater than start time', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const chapter = await createChapter({
        project_id: projectId,
        title,
        start_time: startTime,
        end_time: endTime,
      });

      return createSuccessResponse(chapter);
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET, async (_, { id }) => {
    console.log('IPC: chapter:get', id);
    try {
      const chapter = await getChapter(id);
      if (chapter) {
        return createSuccessResponse(chapter);
      } else {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_BY_PROJECT, async (_, { projectId }) => {
    console.log('IPC: chapter:get-by-project', projectId);
    try {
      const chapters = await getChaptersByProject(projectId);
      return createSuccessResponse(chapters);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_UPDATE, async (_, { id, updates }) => {
    console.log('IPC: chapter:update', id, updates);
    try {
      const success = await updateChapter(id, updates);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('time')) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_DELETE, async (_, { id }) => {
    console.log('IPC: chapter:delete', id);
    try {
      const success = await deleteChapter(id);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Chapter-Asset linking handlers
  ipcMain.handle(IPC_CHANNELS.CHAPTER_ADD_ASSET, async (_, { chapterId, assetId }) => {
    console.log('IPC: chapter:add-asset', chapterId, assetId);
    try {
      await addAssetToChapter(chapterId, assetId);
      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_REMOVE_ASSET, async (_, { chapterId, assetId }) => {
    console.log('IPC: chapter:remove-asset', chapterId, assetId);
    try {
      const success = await removeAssetFromChapter(chapterId, assetId);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Link not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_GET_ASSETS, async (_, { chapterId }) => {
    console.log('IPC: chapter:get-assets', chapterId);
    try {
      const assetIds = await getAssetsForChapter(chapterId);
      return createSuccessResponse(assetIds);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Transcription handler
  ipcMain.handle(IPC_CHANNELS.TRANSCRIBE_CHAPTER, async (event, { chapterId, options = {} }) => {
    console.log('IPC: transcribe:chapter', chapterId);
    let tempAudioPath: string | null = null;

    try {
      const chapter = await getChapter(chapterId);
      if (!chapter) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const assetIds = await getAssetsForChapter(chapterId);
      if (assetIds.length === 0) {
        return createErrorResponse('No assets linked to chapter', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const asset = await getAsset(assetIds[0]);
      if (!asset) {
        return createErrorResponse('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const tempDir = os.tmpdir();
      tempAudioPath = path.join(tempDir, `vod-pipeline-${chapterId}-${Date.now()}.wav`);

      event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
        chapterId,
        progress: { percent: 0, status: 'Extracting audio...' },
      });

      try {
        await extractAudio(asset.file_path, tempAudioPath, {
          trackIndex: 0,
          sampleRate: 16000,
          channels: 1,
        });
      } catch (error) {
        throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : String(error)}`);
      }

      event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
        chapterId,
        progress: { percent: 10, status: 'Starting transcription...' },
      });

      await deleteTranscriptsByChapter(chapterId);

      const result = await transcribe(
        {
          audioPath: tempAudioPath,
          model: options.model || 'base',
          language: options.language,
          computeType: options.computeType || 'int8',
        },
        (progress) => {
          event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
            chapterId,
            progress,
          });
        }
      );

      const transcriptInputs = result.segments.map(segment => ({
        text: segment.text,
        start_time: segment.start,
        end_time: segment.end,
      }));

      await batchInsertTranscripts(chapterId, transcriptInputs);

      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
      }

      return createSuccessResponse({
        chapterId,
        language: result.language,
        duration: result.duration,
        segmentCount: result.segments.length,
      });
    } catch (error) {
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', cleanupError);
        }
      }

      if (error instanceof WhisperError) {
        // Validate error code is a known IPC error code
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode) 
          ? error.code as IPCErrorCode 
          : IPC_ERROR_CODES.UNKNOWN_ERROR;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.TRANSCRIPTION_FAILED);
    }
  });

  // Agent handler
  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_, { projectId, message }) => {
    console.log('IPC: agent:chat', projectId, message);
    try {
      const agentBridge = getAgentBridge();
      const response = await agentBridge.send({
        type: 'chat',
        messages: [{ role: 'user', content: message }],
        metadata: { projectId },
      });
      return createSuccessResponse(response);
    } catch (error) {
      console.error('[IPC] agent:chat error:', error);
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
