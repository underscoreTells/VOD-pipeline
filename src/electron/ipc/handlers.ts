import { ipcMain, safeStorage } from 'electron';
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
  replaceTranscripts,
  createClip,
  getClip,
  getClipsByProject,
  getClipsByAsset,
  updateClip,
  deleteClip,
  batchUpdateClips,
  saveTimelineState,
  loadTimelineState,
  updateTimelineState,
  saveWaveform,
  getWaveform,
  createProxy,
  updateProxyStatus,
  updateProxyMetadata,
  getProxyByAsset,
  createSuggestion,
  getSuggestionsByChapter,
  applySuggestion,
  applySuggestionWithClip,
  rejectSuggestion,
} from '../database/db.js';
import { generateWaveformTiers, WaveformError } from '../../pipeline/waveform.js';
import { getAgentBridge } from '../agent-bridge.js';
import { getVideoMetadata, isValidVideo, extractAudio, FFmpegError, generateAIProxy } from '../../pipeline/ffmpeg.js';
import { transcribe, WhisperError } from '../../pipeline/whisper.js';
import { app } from 'electron';
import { generateFCPXML, generateJSON, generateEDL } from '../../pipeline/export/index.js';
import type { AssetMetadata, Clip } from '../../shared/types/database.js';
import type { ExportFormat } from '../../pipeline/export/index.js';

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

  // Helper to get proxy storage path
  function getProxyPath(assetId: number): string {
    const userDataPath = app.getPath('userData');
    const proxiesDir = path.join(userDataPath, 'proxies');
    if (!fs.existsSync(proxiesDir)) {
      fs.mkdirSync(proxiesDir, { recursive: true });
    }
    return path.join(proxiesDir, `asset_${assetId}_ai_proxy.mp4`);
  }

  // Background proxy generation
  async function generateProxyAsync(assetId: number, sourcePath: string, mainWindow: any) {
    const proxyPath = getProxyPath(assetId);
    let proxyId: number | null = null;
    
    try {
      // Create proxy record and get its ID
      const proxy = await createProxy({
        asset_id: assetId,
        file_path: proxyPath,
        preset: 'ai_analysis',
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        status: 'generating',
        error_message: null,
      });
      proxyId = proxy.id;

      console.log(`[Proxy] Starting generation for asset ${assetId} (proxy ${proxyId})`);
      
      // Generate proxy with progress
      const proxyMetadata = await generateAIProxy(sourcePath, proxyPath, (progress) => {
        // Send progress to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('proxy:progress', { assetId, progress });
        }
      });

      // Update proxy record with metadata using the proxy ID
      await updateProxyMetadata(proxyId, {
        width: proxyMetadata.width,
        height: proxyMetadata.height,
        framerate: proxyMetadata.framerate,
        file_size: proxyMetadata.fileSize,
        duration: proxyMetadata.duration,
      });
      await updateProxyStatus(proxyId, 'ready');

      console.log(`[Proxy] Generation complete for asset ${assetId}: ${proxyPath}`);
      
      // Notify renderer of completion
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxy:complete', { assetId, proxyPath });
      }
    } catch (error) {
      console.error(`[Proxy] Generation failed for asset ${assetId}:`, error);
      // Try to update status using the proxy ID if we have it, otherwise fall back to finding it
      if (proxyId) {
        await updateProxyStatus(proxyId, 'error', error instanceof Error ? error.message : 'Unknown error');
      } else {
        // Try to find the proxy by asset ID and update it
        const existingProxy = await getProxyByAsset(assetId);
        if (existingProxy) {
          await updateProxyStatus(existingProxy.id, 'error', error instanceof Error ? error.message : 'Unknown error');
        }
      }
      
      // Notify renderer of error
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxy:error', { 
          assetId, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
  }

  // Asset handlers
  ipcMain.handle(IPC_CHANNELS.ASSET_ADD, async (event, { projectId, filePath }) => {
    console.log('IPC: asset:add', projectId, filePath);

    try {
      if (!fs.existsSync(filePath)) {
        return createErrorResponse('File not found', IPC_ERROR_CODES.FILE_NOT_FOUND);
      }

      // Determine file type from extension first
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

      // Only validate video files with FFmpeg
      let metadata: AssetMetadata = {};
      let duration: number | null = null;
      
      if (fileType === 'video') {
        if (!await isValidVideo(filePath)) {
          return createErrorResponse('Invalid or unsupported video format', IPC_ERROR_CODES.INVALID_FORMAT);
        }

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
            duration: videoMetadata.duration,
          };
          duration = videoMetadata.duration;
        } catch (error) {
          console.warn('[Asset Add] Failed to extract video metadata:', error);
        }
      }

      const asset = await createAsset({
        project_id: projectId,
        file_path: filePath,
        file_type: fileType,
        duration,
        metadata,
      });

      // Start proxy generation in background for video assets
      if (fileType === 'video') {
        const { getMainWindow } = await import('../main.js');
        const mainWindow = getMainWindow();
        // Don't await - run in background
        generateProxyAsync(asset.id!, filePath, mainWindow);
      }

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
        // Preserve FFmpegError to allow proper error code mapping
        if (error instanceof FFmpegError) {
          throw error;
        }
        throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : String(error)}`);
      }

      event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
        chapterId,
        progress: { percent: 10, status: 'Starting transcription...' },
      });

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

      // Atomically replace transcripts (delete old + insert new in transaction)
      await replaceTranscripts(chapterId, transcriptInputs);

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
      
      if (error instanceof FFmpegError) {
        // Map FFmpegError codes to appropriate IPC error codes
        const validCodes = Object.values(IPC_ERROR_CODES);
        let errorCode: IPCErrorCode;
        
        if (error.code === 'TIMEOUT') {
          errorCode = IPC_ERROR_CODES.TRANSCRIPTION_FAILED;
        } else if (error.code === 'FFMPEG_NOT_FOUND') {
          errorCode = IPC_ERROR_CODES.FFMPEG_NOT_FOUND;
        } else {
          errorCode = validCodes.includes(error.code as IPCErrorCode) 
            ? error.code as IPCErrorCode 
            : IPC_ERROR_CODES.TRANSCRIPTION_FAILED;
        }
        
        return createErrorResponse(error.message, errorCode);
      }
      
      return createErrorResponse(error, IPC_ERROR_CODES.TRANSCRIPTION_FAILED);
    }
  });

  // Agent handler
  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_, { projectId, message, provider, chapterId }) => {
    console.log('IPC: agent:chat', projectId, provider, chapterId, message);
    try {
      const agentBridge = getAgentBridge();
      const response = await agentBridge.send({
        type: 'chat',
        messages: [{ role: 'user', content: message }],
        metadata: { projectId, provider, chapterId },
      });
      return createSuccessResponse(response);
    } catch (error) {
      console.error('[IPC] agent:chat error:', error);
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Clip handlers
  ipcMain.handle(IPC_CHANNELS.CLIP_CREATE, async (_, { projectId, assetId, trackIndex, startTime, inPoint, outPoint, role, description, isEssential }) => {
    console.log('IPC: clip:create', projectId, assetId);
    try {
      if (!projectId || !assetId) {
        return createErrorResponse('Project ID and Asset ID are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (startTime < 0) {
        return createErrorResponse('Start time must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (inPoint < 0) {
        return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (outPoint <= inPoint) {
        return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const clip = await createClip({
        project_id: projectId,
        asset_id: assetId,
        track_index: trackIndex ?? 0,
        start_time: startTime,
        in_point: inPoint,
        out_point: outPoint,
        role: role ?? null,
        description: description ?? null,
        is_essential: isEssential ?? false,
      });

      return createSuccessResponse(clip);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET, async (_, { id }) => {
    console.log('IPC: clip:get', id);
    try {
      const clip = await getClip(id);
      if (clip) {
        return createSuccessResponse(clip);
      } else {
        return createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_PROJECT, async (_, { projectId }) => {
    console.log('IPC: clip:get-by-project', projectId);
    try {
      const clips = await getClipsByProject(projectId);
      return createSuccessResponse(clips);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_GET_BY_ASSET, async (_, { assetId }) => {
    console.log('IPC: clip:get-by-asset', assetId);
    try {
      const clips = await getClipsByAsset(assetId);
      return createSuccessResponse(clips);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_UPDATE, async (_, { id, updates }) => {
    console.log('IPC: clip:update', id, updates);
    try {
      const success = await updateClip(id, updates);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_DELETE, async (_, { id }) => {
    console.log('IPC: clip:delete', id);
    try {
      const success = await deleteClip(id);
      if (success) {
        return createSuccessResponse(null);
      } else {
        return createErrorResponse('Clip not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLIP_BATCH_UPDATE, async (_, { updates }) => {
    console.log('IPC: clip:batch-update', updates?.length);
    try {
      if (!Array.isArray(updates) || updates.length === 0) {
        return createErrorResponse('Updates array is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const updatedCount = await batchUpdateClips(updates);
      return createSuccessResponse({ updatedCount });
    } catch (error) {
      if (error instanceof Error && (error.message.includes('time') || error.message.includes('point'))) {
        return createErrorResponse(error.message, IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Timeline state handlers
  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_SAVE, async (_, { projectId, zoomLevel, scrollPosition, playheadTime, selectedClipIds }) => {
    console.log('IPC: timeline:state-save', projectId);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const state = await saveTimelineState({
        project_id: projectId,
        zoom_level: zoomLevel ?? 100.0,
        scroll_position: scrollPosition ?? 0.0,
        playhead_time: playheadTime ?? 0.0,
        selected_clip_ids: selectedClipIds ?? [],
      });

      return createSuccessResponse(state);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_LOAD, async (_, { projectId }) => {
    console.log('IPC: timeline:state-load', projectId);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const state = await loadTimelineState(projectId);
      if (state) {
        return createSuccessResponse(state);
      } else {
        return createSuccessResponse(null);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TIMELINE_STATE_UPDATE, async (_, { projectId, updates }) => {
    console.log('IPC: timeline:state-update', projectId, updates);
    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const success = await updateTimelineState(projectId, updates);
      return createSuccessResponse({ success });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Waveform handlers
  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE, async (event, { assetId, trackIndex }) => {
    console.log('IPC: waveform:generate', assetId, trackIndex);
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

      const result = await generateWaveformTiers(
        asset.file_path,
        assetId,
        trackIndex ?? 0,
        (progress) => {
          event.sender.send(IPC_CHANNELS.WAVEFORM_PROGRESS, { assetId, progress });
        }
      );

      // Note: Waveforms are now saved to database by the generateWaveformTiers function
      // to avoid redundant writes and race conditions

      return createSuccessResponse(result);
    } catch (error) {
      if (error instanceof WaveformError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? error.code as IPCErrorCode
          : IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
    }
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GET, async (_, { assetId, trackIndex, tierLevel }) => {
    console.log('IPC: waveform:get', assetId, trackIndex, tierLevel);
    try {
      if (!assetId || tierLevel === undefined) {
        return createErrorResponse('Asset ID and tier level are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const waveform = await getWaveform(assetId, trackIndex ?? 0, tierLevel);
      if (waveform) {
        return createSuccessResponse(waveform);
      } else {
        return createSuccessResponse(null);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.WAVEFORM_GENERATE_TIER, async (event, { assetId, trackIndex, tierLevel }) => {
    console.log('IPC: waveform:generate-tier', assetId, trackIndex, tierLevel);
    try {
      if (!assetId || !tierLevel) {
        return createErrorResponse('Asset ID and tier level are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Generate specific tier - reuses full generation but we could optimize this later
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
          event.sender.send(IPC_CHANNELS.WAVEFORM_PROGRESS, { assetId, tierLevel, progress });
        }
      );

      // Save the specific tier
      const tier = result.tiers.find(t => t.level === tierLevel);
      if (tier) {
        await saveWaveform(assetId, trackIndex ?? 0, tierLevel, tier.peaks, tier.sampleRate, tier.duration);
      }

      return createSuccessResponse({ assetId, tierLevel, generated: !!tier });
    } catch (error) {
      if (error instanceof WaveformError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? error.code as IPCErrorCode
          : IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED;
        return createErrorResponse(error.message, errorCode);
      }
      return createErrorResponse(error, IPC_ERROR_CODES.WAVEFORM_GENERATION_FAILED);
    }
  });

  // Export handlers
  ipcMain.handle(IPC_CHANNELS.EXPORT_GENERATE, async (event, { projectId, format, options, filePath }: { projectId: number; format: ExportFormat; options?: { frameRate?: number; includeAudio?: boolean }; filePath: string }) => {
    console.log('IPC: export:generate', projectId, format, filePath);
    try {
      if (!projectId || !format || !filePath) {
        return createErrorResponse('Project ID, format, and file path are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Get project data
      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      // Get clips for project
      const clips = await getClipsByProject(projectId);
      if (clips.length === 0) {
        return createErrorResponse('No clips in project to export', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Get asset paths and durations
      const uniqueAssetIds = [...new Set(clips.map(c => c.asset_id))];
      const assetPaths = new Map<number, string>();
      const assetDurations = new Map<number, number>();
      const assetTrackIndices = new Map<number, number>();

      for (const assetId of uniqueAssetIds) {
        const asset = await getAsset(assetId);
        if (asset) {
          assetPaths.set(assetId, asset.file_path);
          assetDurations.set(assetId, asset.duration ?? 0);
          // Track index is per clip, but we can use the first clip's track index as reference
          const clipWithAsset = clips.find(c => c.asset_id === assetId);
          if (clipWithAsset) {
            assetTrackIndices.set(assetId, clipWithAsset.track_index);
          }
        }
      }

      // Calculate total duration
      const totalDuration = Math.max(...clips.map(c => c.start_time + (c.out_point - c.in_point)));

      // Generate export content based on format
      let content: string;
      const frameRate = options?.frameRate ?? 30;

      switch (format) {
        case 'fcpxml':
          content = generateFCPXML({
            projectName: project.name,
            projectId,
            frameRate,
            clips,
            assetPaths,
            assetDurations,
          });
          break;

        case 'json':
          content = generateJSON({
            projectId,
            projectName: project.name,
            frameRate,
            totalDuration,
            clips,
            assetPaths,
            audioTracks: Array.from(assetTrackIndices.entries()).map(([assetId, trackIndex]) => ({
              index: trackIndex,
              sourceFile: assetPaths.get(assetId) ?? '',
            })),
          });
          break;

        case 'edl':
          content = generateEDL({
            title: project.name,
            frameRate,
            clips,
            reelNames: new Map(Array.from(assetPaths.entries()).map(([id, path]) => [id, `REEL${id}`])),
          });
          break;

        default:
          return createErrorResponse(`Unsupported export format: ${format}`, IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      // Write to file
      await fs.promises.writeFile(filePath, content, 'utf-8');
      console.log(`[Export] Successfully exported ${format} to ${filePath}`);

      return createSuccessResponse({ filePath, format, clipCount: clips.length });
    } catch (error) {
      console.error('[Export] Generation failed:', error);
      return createErrorResponse(error instanceof Error ? error.message : String(error), IPC_ERROR_CODES.EXPORT_GENERATION_FAILED);
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_GET_FORMATS, async () => {
    console.log('IPC: export:get-formats');
    try {
      const formats = [
        { id: 'xml', name: 'FCPXML', description: 'Final Cut Pro XML format', extensions: ['.fcpxml'] },
        { id: 'edl', name: 'EDL', description: 'Edit Decision List (CMX3600)', extensions: ['.edl'] },
        { id: 'aaf', name: 'AAF', description: 'Advanced Authoring Format', extensions: ['.aaf'] },
      ];
      return createSuccessResponse(formats);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Dialog handler for save dialogs
  ipcMain.handle('dialog:showSaveDialog', async (event, options) => {
    const { dialog } = await import('electron');
    try {
      const result = await dialog.showSaveDialog(options);
      return result;
    } catch (error) {
      console.error('IPC dialog:showSaveDialog error', error);
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  // Suggestion handlers (Phase 4: Visual AI)
  ipcMain.handle(IPC_CHANNELS.SUGGESTION_CREATE, async (_, { chapterId, inPoint, outPoint, description, reasoning, provider }) => {
    console.log('IPC: suggestion:create', chapterId, inPoint, outPoint);
    try {
      if (!chapterId || inPoint === undefined || outPoint === undefined) {
        return createErrorResponse('Chapter ID, in_point, and out_point are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (inPoint < 0) {
        return createErrorResponse('In point must be >= 0', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (outPoint <= inPoint) {
        return createErrorResponse('Out point must be greater than in point', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const suggestion = await createSuggestion({
        chapter_id: chapterId,
        in_point: inPoint,
        out_point: outPoint,
        description: description ?? null,
        reasoning: reasoning ?? null,
        provider: provider ?? null,
        status: 'pending',
        display_order: 0,
      });

      return createSuccessResponse(suggestion);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_GET_BY_CHAPTER, async (_, { chapterId, status }) => {
    console.log('IPC: suggestion:get-by-chapter', chapterId, status);
    try {
      if (!chapterId) {
        return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const suggestions = await getSuggestionsByChapter(chapterId, status);
      return createSuccessResponse(suggestions);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY, async (_, { id }) => {
    console.log('IPC: suggestion:apply', id);
    try {
      if (!id) {
        return createErrorResponse('Suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await applySuggestionWithClip(id);
      if (result.success) {
        return createSuccessResponse({ 
          applied: true, 
          clip: result.clip 
        });
      } else {
        return createErrorResponse(result.error || 'Failed to apply suggestion', IPC_ERROR_CODES.DATABASE_ERROR);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_REJECT, async (_, { id }) => {
    console.log('IPC: suggestion:reject', id);
    try {
      if (!id) {
        return createErrorResponse('Suggestion ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const success = await rejectSuggestion(id);
      if (success) {
        return createSuccessResponse({ rejected: true });
      } else {
        return createErrorResponse('Suggestion not found', IPC_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY_ALL, async (_, { chapterId }) => {
    console.log('IPC: suggestion:apply-all', chapterId);
    try {
      if (!chapterId) {
        return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const pendingSuggestions = await getSuggestionsByChapter(chapterId, 'pending');
      const results: Array<{ suggestionId: number; success: boolean; clip?: Clip; error?: string }> = [];

      for (const suggestion of pendingSuggestions) {
        const result = await applySuggestionWithClip(suggestion.id);
        results.push({
          suggestionId: suggestion.id,
          success: result.success,
          clip: result.clip,
          error: result.error,
        });
      }

      const appliedCount = results.filter(r => r.success).length;
      const createdClips = results.filter(r => r.success && r.clip).map(r => r.clip!);

      return createSuccessResponse({ 
        appliedCount, 
        total: pendingSuggestions.length,
        clips: createdClips,
        results,
      });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  // Settings encryption handlers
  ipcMain.handle(IPC_CHANNELS.SETTINGS_ENCRYPT, async (_, { text }) => {
    console.log('IPC: settings:encrypt');
    try {
      if (!text) {
        return createErrorResponse('Text to encrypt is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      if (!safeStorage.isEncryptionAvailable()) {
        return createErrorResponse('System encryption is not available', IPC_ERROR_CODES.UNKNOWN_ERROR);
      }

      const encrypted = safeStorage.encryptString(text);
      return createSuccessResponse(encrypted.toString('base64'));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_DECRYPT, async (_, { encrypted }) => {
    console.log('IPC: settings:decrypt');
    try {
      if (!encrypted) {
        return createErrorResponse('Encrypted text is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      if (!safeStorage.isEncryptionAvailable()) {
        return createErrorResponse('System encryption is not available', IPC_ERROR_CODES.UNKNOWN_ERROR);
      }

      const buffer = Buffer.from(encrypted, 'base64');
      const decrypted = safeStorage.decryptString(buffer);
      return createSuccessResponse(decrypted);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
