import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ipcMain } from 'electron';
import {
  deleteDetailedTranscriptsByChapter,
  getAsset,
  getAssetsForChapter,
  getChapter,
  getTranscriptsByChapter,
  replaceTranscripts,
} from '../../database/index.js';
import { FFmpegError, extractAudio } from '../../../pipeline/ffmpeg.js';
import { getWhisperRuntimeStatus, transcribe, WhisperError } from '../../../pipeline/whisper.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES, type IPCErrorCode } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import {
  normalizeComputeType,
  normalizeTranscriptionModel,
  buildTranscriptionJobKey,
  cancelHeavyMediaJob,
  queueChapterTranscription,
} from '../handler-support.js';
import { clamp } from '../../../shared/utils/clip-timing.js';
import {
  transcribeCancelSchema,
  transcribeChapterSchema,
  transcriptionStatusSchema,
} from '../schemas.js';

const logger = createLogger('TranscriptionHandlers');

class TranscriptionHandlerError extends Error {
  constructor(
    message: string,
    readonly code: IPCErrorCode
  ) {
    super(message);
    this.name = 'TranscriptionHandlerError';
  }
}

export const TRANSCRIPTION_HANDLER_CHANNELS = [
  IPC_CHANNELS.TRANSCRIPTION_STATUS,
  IPC_CHANNELS.TRANSCRIBE_CHAPTER,
  IPC_CHANNELS.TRANSCRIBE_CANCEL,
];

export function registerTranscriptionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_STATUS, async (_, payload) => {
    logger.info('transcription:status');
    try {
      const parsed = transcriptionStatusSchema.safeParse(payload);
      const autoSetup = Boolean((parsed.success ? parsed.data : payload)?.autoSetup);
      return createSuccessResponse(await getWhisperRuntimeStatus({ autoSetup }));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRANSCRIBE_CHAPTER, async (event, payload) => {
    logger.info('transcribe:chapter', payload?.chapterId);
    let tempAudioPath: string | null = null;

    try {
      const parsed = transcribeChapterSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid transcription payload', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const chapterId = parsed.data.chapterId as number;
      const options = (parsed.data.options === undefined ? {} : parsed.data.options) as Record<string, unknown>;

      const existingChapter = await getChapter(chapterId);
      if (!existingChapter) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const priority = options?.background === true ? 'background' : 'interactive';
      event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
        chapterId,
        progress: {
          percent: 0,
          status: priority === 'background'
            ? 'Queued for background transcription...'
            : 'Queued for transcription...',
        },
      });

      const result = await queueChapterTranscription(chapterId, priority, async (signal) => {
        const chapter = await getChapter(chapterId);
        if (!chapter) {
          throw new TranscriptionHandlerError('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
        }

        const chapterStart = chapter.start_time;
        const chapterEnd = chapter.end_time;
        const chapterDuration = Math.max(0.01, chapterEnd - chapterStart);
        const skipIfExists = options?.skipIfExists === true;

        if (skipIfExists) {
          const existingTranscripts = await getTranscriptsByChapter(chapterId);
          if (existingTranscripts.length > 0) {
            event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
              chapterId,
              progress: { percent: 100, status: 'Using existing transcript' },
            });

            return {
              chapterId,
              language: 'existing',
              duration: chapterDuration,
              segmentCount: existingTranscripts.length,
              skipped: true,
            };
          }
        }

        const assetIds = await getAssetsForChapter(chapterId);
        if (assetIds.length === 0) {
          throw new TranscriptionHandlerError(
            'No assets linked to chapter',
            IPC_ERROR_CODES.VALIDATION_ERROR
          );
        }

        const asset = await getAsset(assetIds[0]);
        if (!asset) {
          throw new TranscriptionHandlerError('Asset not found', IPC_ERROR_CODES.NOT_FOUND);
        }

        const assetDuration =
          typeof asset.duration === 'number' && Number.isFinite(asset.duration) ? asset.duration : null;

        if (assetDuration !== null) {
          if (chapterStart >= assetDuration) {
            throw new TranscriptionHandlerError(
              `Chapter start (${chapterStart.toFixed(2)}s) is outside asset duration (${assetDuration.toFixed(2)}s)`,
              IPC_ERROR_CODES.VALIDATION_ERROR
            );
          }
          if (chapterEnd > assetDuration + 0.25) {
            throw new TranscriptionHandlerError(
              `Chapter end (${chapterEnd.toFixed(2)}s) exceeds asset duration (${assetDuration.toFixed(2)}s)`,
              IPC_ERROR_CODES.VALIDATION_ERROR
            );
          }
        }

        tempAudioPath = path.join(os.tmpdir(), `vod-pipeline-${chapterId}-${Date.now()}.wav`);

        event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
          chapterId,
          progress: { percent: 0, status: 'Extracting audio...' },
        });

        try {
          await extractAudio(asset.file_path, tempAudioPath, {
            trackIndex: 0,
            sampleRate: 16000,
            channels: 1,
            startTime: chapterStart,
            endTime: chapterEnd,
            signal,
          });
        } catch (error) {
          if (error instanceof FFmpegError) {
            throw error;
          }
          throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : String(error)}`);
        }

        event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
          chapterId,
          progress: { percent: 10, status: 'Starting transcription...' },
        });

        const transcriptionResult = await transcribe(
          {
            audioPath: tempAudioPath,
            model: normalizeTranscriptionModel(options?.model),
            language: typeof options?.language === 'string' ? options.language : undefined,
            computeType: normalizeComputeType(options?.computeType),
            wordTimestamps: false,
          },
          (progress) => {
            event.sender.send(IPC_CHANNELS.TRANSCRIBE_PROGRESS, {
              chapterId,
              progress,
            });
          },
          signal
        );

        const transcriptInputs = transcriptionResult.segments
          .map((segment) => {
            const start = clamp(segment.start, 0, chapterDuration);
            const end = clamp(segment.end, start, chapterDuration);
            if (end <= start) {
              return null;
            }

            return {
              text: segment.text,
              start_time: start,
              end_time: end,
            };
          })
          .filter((segment): segment is { text: string; start_time: number; end_time: number } => segment !== null);

        await replaceTranscripts(chapterId, transcriptInputs);
        await deleteDetailedTranscriptsByChapter(chapterId);

        if (tempAudioPath && fs.existsSync(tempAudioPath)) {
          fs.unlinkSync(tempAudioPath);
          tempAudioPath = null;
        }

        return {
          chapterId,
          language: transcriptionResult.language,
          duration: chapterDuration,
          segmentCount: transcriptionResult.segments.length,
        };
      });

      return createSuccessResponse(result);
    } catch (error) {
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', cleanupError);
        }
      }

      if (error instanceof TranscriptionHandlerError) {
        return createErrorResponse(error.message, error.code);
      }

      if (error instanceof WhisperError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        const errorCode = validCodes.includes(error.code as IPCErrorCode)
          ? (error.code as IPCErrorCode)
          : IPC_ERROR_CODES.UNKNOWN_ERROR;
        return createErrorResponse(error.message, errorCode);
      }

      if (error instanceof FFmpegError) {
        const validCodes = Object.values(IPC_ERROR_CODES);
        let errorCode: IPCErrorCode;

        if (error.code === 'TIMEOUT') {
          errorCode = IPC_ERROR_CODES.TRANSCRIPTION_FAILED;
        } else if (error.code === 'FFMPEG_NOT_FOUND') {
          errorCode = IPC_ERROR_CODES.FFMPEG_NOT_FOUND;
        } else {
          errorCode = validCodes.includes(error.code as IPCErrorCode)
            ? (error.code as IPCErrorCode)
            : IPC_ERROR_CODES.TRANSCRIPTION_FAILED;
        }

        return createErrorResponse(error.message, errorCode);
      }

      return createErrorResponse(error, IPC_ERROR_CODES.TRANSCRIPTION_FAILED);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRANSCRIBE_CANCEL, async (_, payload) => {
    logger.info('transcribe:cancel', payload?.chapterId);
    try {
      const parsed = transcribeCancelSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid transcription cancel payload', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const chapterId = parsed.data.chapterId as number;
      const jobKey = buildTranscriptionJobKey(chapterId);
      const cancelled = cancelHeavyMediaJob(jobKey);
      return createSuccessResponse({ cancelled });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
