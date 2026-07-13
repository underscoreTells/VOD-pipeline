import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getFFmpegPath, getFFprobePath } from '../electron/ffmpegDetector.js';
import { detectGPUEncoders, getGPUFFmpegPath, getProxyEncoderArgs, getHwaccelDecodeArgs, type GPUEncoderBackend } from '../electron/gpuDetector.js';
import type {
  VideoMetadata,
  AudioTrackMetadata,
  AudioExtractOptions,
  FFprobeOutput,
} from '../shared/types/pipeline.js';

export class FFmpegError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'FFmpegError';
  }
}

type ProxyGenerationMode = 'cpu' | 'gpu' | 'auto';
type ProxyGenerationQuality = 'high' | 'balanced' | 'fast';

interface ProxyEncodingPlan {
  requestedMode: ProxyGenerationMode;
  useGPU: boolean;
  backend: GPUEncoderBackend | 'cpu';
  ffmpegBinaryPath: string;
  videoCodec: string;
  videoArgs: string[];
  fallbackReason?: string;
}

export async function validateVideoFile(
  filePath: string,
  timeoutMs: number = 5000
): Promise<VideoMetadata | null> {
  console.log(`[FFmpeg] Validating video: ${filePath}`);

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    console.log(`[FFmpeg] Validation failed: not a file`);
    return null;
  }
  console.log(`[FFmpeg] File exists, size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  const ext = path.extname(filePath).toLowerCase();
  console.log(`[FFmpeg] Extension: ${ext}`);

  const validExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts', '.m2ts', '.mts'];
  if (!validExtensions.includes(ext)) {
    console.log(`[FFmpeg] Validation failed: extension ${ext} not in valid list`);
    return null;
  }

  console.log(`[FFmpeg] Attempting metadata extraction with ${Math.floor(timeoutMs / 1000)}s timeout...`);
  const metadata = await getVideoMetadata(filePath, timeoutMs);
  console.log(`[FFmpeg] Validation successful`);
  return metadata;
}

/**
 * Get video metadata using ffprobe
 * @param filePath Path to video file
 * @param timeoutMs Timeout in milliseconds (default: 60000 for large VODs)
 */
export async function getVideoMetadata(
  filePath: string,
  timeoutMs: number = 60000
): Promise<VideoMetadata> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const ffprobePath = getFFprobePath(ffmpegPath.path);

  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ]);

    let output = '';
    let errorOutput = '';
    let timeoutId: NodeJS.Timeout | null = null;

    // Set timeout for large files
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new FFmpegError(
          `ffprobe timed out after ${timeoutMs}ms - file may be too large or corrupted`,
          'FFPROBE_TIMEOUT'
        ));
      }, timeoutMs);
    }

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new FFmpegError(
        `Failed to run ffprobe: ${error.message}`,
        'FFPROBE_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      if (code !== 0) {
        reject(new FFmpegError(
          `ffprobe failed with code ${code}: ${errorOutput}`,
          'FFPROBE_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      try {
        const data: FFprobeOutput = JSON.parse(output);
        const metadata = parseFFprobeOutput(data);
        resolve(metadata);
      } catch (error) {
        reject(new FFmpegError(
          'Failed to parse ffprobe output',
          'PARSE_ERROR',
          error
        ));
      }
    });
  });
}

/**
 * Extract audio from video to WAV file
 */
export async function extractAudio(
  videoPath: string,
  outputPath: string,
  options: AudioExtractOptions = {}
): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const startTime = options.startTime;
  const endTime = options.endTime;

  if (startTime !== undefined && (!Number.isFinite(startTime) || startTime < 0)) {
    throw new FFmpegError('Audio extract startTime must be a finite number >= 0', 'INVALID_OPTIONS');
  }
  if (endTime !== undefined && (!Number.isFinite(endTime) || endTime <= 0)) {
    throw new FFmpegError('Audio extract endTime must be a finite number > 0', 'INVALID_OPTIONS');
  }
  if (startTime !== undefined && endTime !== undefined && endTime <= startTime) {
    throw new FFmpegError('Audio extract endTime must be greater than startTime', 'INVALID_OPTIONS');
  }

  const args: string[] = [];

  // Seek before input for faster extraction when chapter range is provided.
  if (startTime !== undefined) {
    args.push('-ss', startTime.toString());
  }

  args.push(
    '-i', videoPath,
    '-vn', // No video
  );

  if (startTime !== undefined && endTime !== undefined) {
    args.push('-t', (endTime - startTime).toString());
  } else if (endTime !== undefined) {
    args.push('-to', endTime.toString());
  }

  // Select specific audio track if specified
  if (options.trackIndex !== undefined) {
    args.push('-map', `0:a:${options.trackIndex}`);
  } else {
    args.push('-map', '0:a:0'); // Default to first audio track
  }

  // Set sample rate if specified
  if (options.sampleRate) {
    args.push('-ar', options.sampleRate.toString());
  }

  // Set channels if specified
  if (options.channels) {
    args.push('-ac', options.channels.toString());
  }

  // Output as WAV
  args.push('-acodec', 'pcm_s16le', outputPath);

  return runFFmpeg(ffmpegPath.path, args, 30 * 60 * 1000, { signal: options.signal });
}

/**
 * Shared spawn + AbortController + timeout + stderr capture + exit-code
 * handling for FFmpeg child processes. Used by both the simple `runFFmpeg`
 * wrapper (audio extraction, reverse chunks) and the AI proxy generation path,
 * so progress parsing and cancellation behaviour don't diverge.
 */
interface SpawnFFmpegOptions {
  executablePath: string;
  args: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  logTag: string;
  logCommand?: boolean;
  onProgress?: (percent: number) => void;
  progressDuration?: number;
}

function spawnFFmpeg(options: SpawnFFmpegOptions): Promise<{ stderr: string }> {
  const { executablePath, args, signal, timeoutMs, logTag, onProgress, progressDuration } = options;
  const logCommand = options.logCommand !== false;

  if (logCommand) {
    console.log(`[${logTag}] Running: ${executablePath} ${args.join(' ')}`);
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FFmpegError(`${logTag} operation cancelled before start`, 'cancelled', { reason: 'aborted' }));
      return;
    }

    const proc = spawn(executablePath, args);
    let errorOutput = '';
    let lastProgress = 0;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const clearTimer = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const cleanup = () => {
      clearTimer();
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may have already exited.
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new FFmpegError(`${logTag} cancelled`, 'cancelled', { reason: 'aborted' }));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (timeoutMs && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // Process may have already exited.
        }
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new FFmpegError(
          `${logTag} timed out after ${timeoutMs}ms`,
          'TIMEOUT',
          { timeout: timeoutMs }
        ));
      }, timeoutMs);
    }

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;

      if (onProgress && progressDuration && progressDuration > 0) {
        const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(100, Math.round((currentTime / progressDuration) * 100));
          if (progress > lastProgress) {
            lastProgress = progress;
            onProgress(progress);
          }
        }
      }
    });

    proc.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new FFmpegError(
        `Failed to run ${logTag}: ${error.message}`,
        'FFMPEG_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
      if (settled) {
        return;
      }
      clearTimer();

      if (code !== 0) {
        if (code === null || code === 143) {
          settled = true;
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          reject(new FFmpegError(
            `${logTag} was terminated`,
            'TIMEOUT',
            { code }
          ));
          return;
        }

        settled = true;
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        reject(new FFmpegError(
          `${logTag} failed with code ${code}`,
          'FFMPEG_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      settled = true;
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve({ stderr: errorOutput });
    });
  });
}

/**
 * Run FFmpeg command and handle errors. Thin wrapper around `spawnFFmpeg`
 * for callers that don't need progress reporting.
 */
function runFFmpeg(
  executablePath: string,
  args: string[],
  timeoutMs: number = 30 * 60 * 1000,
  options?: { logCommand?: boolean; signal?: AbortSignal }
): Promise<void> {
  return spawnFFmpeg({
    executablePath,
    args,
    timeoutMs,
    signal: options?.signal,
    logTag: 'FFmpeg',
    logCommand: options?.logCommand,
  }).then(() => undefined);
}

/**
 * Parse ffprobe output into VideoMetadata
 */
function parseFFprobeOutput(data: FFprobeOutput): VideoMetadata {
  const videoStream = data.streams.find(s => s.codec_type === 'video');
  const audioStreams = data.streams.filter(s => s.codec_type === 'audio');

  if (!videoStream) {
    throw new FFmpegError('No video stream found', 'NO_VIDEO_STREAM');
  }

  // Parse frame rate
  let fps = 0;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    fps = den ? num / den : num;
  } else if (videoStream.avg_frame_rate) {
    const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
    fps = den ? num / den : num;
  }

  // Parse audio tracks
  const audioTracks: AudioTrackMetadata[] = audioStreams.map((stream, index) => ({
    index,
    codec: stream.codec_name || 'unknown',
    sampleRate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : 0,
    channels: stream.channels || 0,
    language: stream.tags?.language,
    title: stream.tags?.title,
  }));

  return {
    duration: data.format.duration ? parseFloat(data.format.duration) : 0,
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    fps,
    videoCodec: videoStream.codec_name || 'unknown',
    audioCodec: audioStreams[0]?.codec_name,
    audioTracks,
    bitrate: data.format.bit_rate ? parseInt(data.format.bit_rate, 10) : 0,
    container: data.format.format_name || 'unknown',
  };
}

/**
 * Check if a file is a valid video file
 * Uses a short timeout (5s) to quickly validate without hanging on large files
 */
export async function isValidVideo(filePath: string): Promise<boolean> {
  try {
    return (await validateVideoFile(filePath, 5000)) !== null;
  } catch (error) {
    console.log(`[FFmpeg] Validation failed with error:`, error);
    return false;
  }
}

function buildCpuProxyEncodingPlan(
  ffmpegBinaryPath: string,
  requestedMode: ProxyGenerationMode,
  quality: ProxyGenerationQuality,
  fallbackReason?: string
): ProxyEncodingPlan {
  const cpuEncoder = getProxyEncoderArgs(false, quality);
  return {
    requestedMode,
    useGPU: false,
    backend: cpuEncoder.backend,
    ffmpegBinaryPath,
    videoCodec: cpuEncoder.videoCodec,
    videoArgs: cpuEncoder.videoArgs,
    fallbackReason,
  };
}

function logProxyEncodingPlan(prefix: string, plan: ProxyEncodingPlan): void {
  const requestedMode = `requestedMode=${plan.requestedMode}`;
  const backend = `backend=${plan.backend}`;
  const binary = `ffmpeg=${plan.ffmpegBinaryPath}`;
  const codec = `codec=${plan.videoCodec}`;

  if (plan.fallbackReason) {
    console.warn(`[${prefix}] ${requestedMode} ${backend} ${codec} ${binary} fallback=${plan.fallbackReason}`);
    return;
  }

  console.log(`[${prefix}] ${requestedMode} ${backend} ${codec} ${binary}`);
}

/**
 * Build the proxy scale + framerate filter args for a given backend.
 *
 * AI proxies target 640px wide @ 5fps. GPU backends use their hardware scaler
 * (`scale_cuda`, `scale_qsv`, `scale_amf`, `scale_vt`) so frames stay on the
 * GPU between decode and encode. CPU fallback uses the software `scale` +
 * `fps` filters.
 */
function getProxyScaleFilterArgs(backend: GPUEncoderBackend | 'cpu'): string[] {
  switch (backend) {
    case 'nvenc':
      return ['-vf', 'scale_cuda=640:-2', '-r', '5'];
    case 'qsv':
      return ['-vf', 'scale_qsv=640:-2', '-r', '5'];
    case 'amf':
      return ['-vf', 'scale_amf=640:-2', '-r', '5'];
    case 'videotoolbox':
      return ['-vf', 'scale_vt=640:-2', '-r', '5'];
    default:
      return ['-vf', 'scale=640:-2,fps=5'];
  }
}

async function resolveProxyEncodingPlan(
  ffmpegBinaryPath: string,
  requestedMode: ProxyGenerationMode,
  quality: ProxyGenerationQuality,
  logPrefix: string
): Promise<ProxyEncodingPlan> {
  if (requestedMode === 'cpu') {
    const plan = buildCpuProxyEncodingPlan(ffmpegBinaryPath, requestedMode, quality);
    logProxyEncodingPlan(logPrefix, plan);
    return plan;
  }

  const gpuEncoder = await detectGPUEncoders(ffmpegBinaryPath);
  if (!gpuEncoder) {
    const fallbackReason =
      requestedMode === 'gpu'
        ? 'gpu requested but no supported hardware encoder was available'
        : 'auto mode found no supported hardware encoder';
    const plan = buildCpuProxyEncodingPlan(ffmpegBinaryPath, requestedMode, quality, fallbackReason);
    logProxyEncodingPlan(logPrefix, plan);
    return plan;
  }

  const gpuFFmpegPath = getGPUFFmpegPath() ?? ffmpegBinaryPath;
  const gpuPlan = getProxyEncoderArgs(true, quality);
  const plan: ProxyEncodingPlan = {
    requestedMode,
    useGPU: true,
    backend: gpuPlan.backend,
    ffmpegBinaryPath: gpuFFmpegPath,
    videoCodec: gpuPlan.videoCodec,
    videoArgs: gpuPlan.videoArgs,
  };
  logProxyEncodingPlan(logPrefix, plan);
  return plan;
}

/**
 * Generate AI analysis proxy (640px, 5fps, H.264, AAC)
 * Optimized for AI video analysis - small file size, adequate quality
 */
export async function generateAIProxy(
  inputPath: string,
  outputPath: string,
  onProgress?: (percent: number) => void,
  timeoutMs?: number,
  encodingMode: ProxyGenerationMode = 'auto',
  quality: ProxyGenerationQuality = 'balanced',
  trimOptions?: { startTime: number; endTime: number },
  signal?: AbortSignal
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  if (signal?.aborted) {
    throw new FFmpegError('AI proxy generation cancelled before start', 'cancelled', { reason: 'aborted' });
  }

  // Get source metadata first
  const metadata = await getVideoMetadata(inputPath);
  const trimRange = trimOptions
    ? {
        startTime: Math.max(0, trimOptions.startTime),
        endTime: trimOptions.endTime,
      }
    : undefined;

  if (trimRange) {
    if (!Number.isFinite(trimRange.startTime) || !Number.isFinite(trimRange.endTime)) {
      throw new FFmpegError('Chapter proxy trim range must be finite numbers', 'INVALID_OPTIONS');
    }
    if (trimRange.endTime <= trimRange.startTime) {
      throw new FFmpegError('Chapter proxy trim endTime must be greater than startTime', 'INVALID_OPTIONS');
    }
  }

  const targetDuration = trimRange
    ? Math.max(0.01, trimRange.endTime - trimRange.startTime)
    : metadata.duration;

  const initialPlan = await resolveProxyEncodingPlan(ffmpegPath.path, encodingMode, quality, 'Proxy');
  try {
    return await executeProxyGeneration(
      initialPlan,
      inputPath,
      outputPath,
      { duration: targetDuration },
      onProgress,
      timeoutMs,
      trimRange,
      signal
    );
  } catch (error) {
    const isCancelled = error instanceof FFmpegError && error.code === 'cancelled';
    if (!initialPlan.useGPU || isCancelled) {
      throw error;
    }

    const reason = error instanceof Error ? error.message : 'unknown gpu encoding error';
    console.warn(`[Proxy] GPU proxy generation failed; retrying on CPU. reason=${reason}`);
    const cpuPlan = buildCpuProxyEncodingPlan(ffmpegPath.path, encodingMode, quality, reason);
    logProxyEncodingPlan('Proxy', cpuPlan);
    return await executeProxyGeneration(
      cpuPlan,
      inputPath,
      outputPath,
      { duration: targetDuration },
      onProgress,
      timeoutMs,
      trimRange,
      signal
    );
  }
}

/**
 * Execute proxy generation with specified encoder
 */
async function executeProxyGeneration(
  encodingPlan: ProxyEncodingPlan,
  inputPath: string,
  outputPath: string,
  metadata: { duration: number },
  onProgress?: (percent: number) => void,
  timeoutMs?: number,
  trimRange?: { startTime: number; endTime: number },
  signal?: AbortSignal
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const hwaccelInputArgs = getHwaccelDecodeArgs(encodingPlan.backend);
  const isGpuDecode = hwaccelInputArgs.length > 0;

  if (encodingPlan.useGPU && isGpuDecode) {
    console.log(`[Proxy] Enabling ${encodingPlan.backend} decode hwaccel for proxy generation`);
  } else if (encodingPlan.useGPU) {
    console.log(`[Proxy] GPU encode on ${encodingPlan.backend} without decode hwaccel (CPU decode)`);
  }

  const scaleFilterArgs = getProxyScaleFilterArgs(encodingPlan.backend);

  const args: string[] = [
    ...hwaccelInputArgs,
    ...(trimRange ? [
      '-ss', trimRange.startTime.toString(),
      '-t', (trimRange.endTime - trimRange.startTime).toString(),
    ] : []),
    '-i', inputPath,
    ...scaleFilterArgs,
    ...encodingPlan.videoArgs,
    '-c:a', 'aac',
    '-b:a', '64k', // Low bitrate audio is fine for analysis
    '-movflags', '+faststart', // Web-optimized
    '-y', outputPath,
  ];

  await spawnFFmpeg({
    executablePath: encodingPlan.ffmpegBinaryPath,
    args,
    signal,
    timeoutMs,
    logTag: 'Proxy',
    logCommand: true,
    onProgress,
    progressDuration: metadata.duration,
  });

  // Read proxy metadata after a successful encode.
  const proxyMetadata = await getVideoMetadata(outputPath);
  const stats = fs.statSync(outputPath);
  return {
    width: proxyMetadata.width,
    height: proxyMetadata.height,
    framerate: Math.round(proxyMetadata.fps),
    fileSize: stats.size,
    duration: proxyMetadata.duration,
  };
}

/**
 * Generate chapter-scoped reverse playback preview.
 * Preserves source resolution and downsamples to target FPS.
 */
function getRecommendedReverseChunkDuration(
  width: number,
  height: number,
  fps: number
): number {
  const safeFps = Math.max(1, fps);
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const bytesPerFrame = safeWidth * safeHeight * 1.5;
  const targetFrameBufferBytes = 512 * 1024 * 1024;
  const maxFramesPerChunk = Math.max(60, Math.floor(targetFrameBufferBytes / bytesPerFrame));
  const seconds = maxFramesPerChunk / safeFps;
  return Math.min(30, Math.max(4, Math.floor(seconds)));
}

function buildReverseChunkRanges(
  startTime: number,
  endTime: number,
  chunkDurationSec: number
): Array<{ startTime: number; duration: number }> {
  const ranges: Array<{ startTime: number; duration: number }> = [];
  const epsilon = 0.0001;
  let cursor = startTime;

  while (cursor < endTime - epsilon) {
    const chunkEnd = Math.min(endTime, cursor + chunkDurationSec);
    const duration = chunkEnd - cursor;
    if (duration > epsilon) {
      ranges.push({
        startTime: cursor,
        duration,
      });
    }
    cursor = chunkEnd;
  }

  ranges.reverse();
  return ranges;
}

function toConcatFileEntry(filePath: string): string {
  const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
  const escapedPath = normalizedPath.replace(/'/g, "'\\''");
  return `file '${escapedPath}'`;
}

async function runChunkedChapterReverseGeneration(params: {
  ffmpegBinaryPath: string;
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  fps: number;
  hasAudio: boolean;
  videoArgs: string[];
  hwaccelInputArgs: string[];
  chunkDurationSec: number;
  maxParallelChunks: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<void> {
  const {
    ffmpegBinaryPath,
    inputPath,
    outputPath,
    startTime,
    endTime,
    fps,
    hasAudio,
    videoArgs,
    hwaccelInputArgs,
    chunkDurationSec,
    maxParallelChunks,
    timeoutMs,
    signal,
  } = params;

  if (signal?.aborted) {
    throw new FFmpegError('Reverse proxy chunk rendering cancelled before start', 'cancelled', { reason: 'aborted' });
  }

  const chunkRanges = buildReverseChunkRanges(startTime, endTime, chunkDurationSec);
  if (chunkRanges.length === 0) {
    throw new FFmpegError('Reverse proxy chunk plan is empty', 'INVALID_OPTIONS');
  }

  const outputDir = path.dirname(outputPath);
  const outputBaseName = path.basename(outputPath, path.extname(outputPath));
  const tempDir = fs.mkdtempSync(path.join(outputDir, `${outputBaseName}.chunks-`));
  const totalChunks = chunkRanges.length;
  const chunkPaths = new Array<string>(totalChunks);
  const workerCount = Math.min(totalChunks, Math.max(1, Math.floor(maxParallelChunks)));
  const logStep = Math.max(1, Math.floor(totalChunks / 10));
  let completedChunks = 0;

  console.log(`[ReverseProxy] Rendering ${totalChunks} chunk(s) with ${workerCount} worker(s)`);

  try {
    const renderChunkAtIndex = async (index: number): Promise<void> => {
      if (signal?.aborted) {
        throw new FFmpegError('Reverse proxy chunk rendering cancelled', 'cancelled', { reason: 'aborted' });
      }
      const chunk = chunkRanges[index];
      const chunkPath = path.join(tempDir, `chunk_${String(index).padStart(4, '0')}.mp4`);
      chunkPaths[index] = chunkPath;

      const args: string[] = [
        ...hwaccelInputArgs,
        '-ss', chunk.startTime.toString(),
        '-t', chunk.duration.toString(),
        '-i', inputPath,
        '-map', '0:v:0',
        '-vf', `fps=${fps},reverse`,
        ...videoArgs,
        '-pix_fmt', 'yuv420p',
      ];

      if (hasAudio) {
        args.push(
          '-map', '0:a:0',
          '-af', 'areverse',
          '-c:a', 'aac',
          '-b:a', '128k'
        );
      } else {
        args.push('-an');
      }

      args.push(
        '-f', 'mp4',
        '-y', chunkPath
      );

      await runFFmpeg(ffmpegBinaryPath, args, timeoutMs, { logCommand: false, signal });

      completedChunks += 1;
      if (completedChunks === 1 || completedChunks === totalChunks || completedChunks % logStep === 0) {
        console.log(`[ReverseProxy] Chunk progress ${completedChunks}/${totalChunks}`);
      }
    };

    let nextChunkIndex = 0;
    let shouldStop = false;
    const workers = Array.from({ length: workerCount }, async () => {
      while (!shouldStop) {
        if (signal?.aborted) {
          shouldStop = true;
          return;
        }
        const index = nextChunkIndex;
        nextChunkIndex += 1;
        if (index >= totalChunks) {
          return;
        }

        try {
          await renderChunkAtIndex(index);
        } catch (error) {
          shouldStop = true;
          throw error;
        }
      }
    });

    await Promise.all(workers);

    if (signal?.aborted) {
      throw new FFmpegError('Reverse proxy concat cancelled before start', 'cancelled', { reason: 'aborted' });
    }

    const concatListPath = path.join(tempDir, 'concat-list.txt');
    const concatList = chunkPaths.map((chunkPath) => toConcatFileEntry(chunkPath)).join('\n');
    fs.writeFileSync(concatListPath, `${concatList}\n`, 'utf-8');

    const concatArgs: string[] = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:v', 'copy',
      ...(hasAudio ? ['-c:a', 'copy'] : ['-an']),
      '-f', 'mp4',
      '-movflags', '+faststart',
      '-y', outputPath,
    ];

    await runFFmpeg(ffmpegBinaryPath, concatArgs, timeoutMs, { signal });
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

export async function generateChapterReverseProxy(
  inputPath: string,
  outputPath: string,
  options: {
    startTime: number;
    endTime: number;
    fps?: number;
    timeoutMs?: number;
    encodingMode?: ProxyGenerationMode;
    quality?: ProxyGenerationQuality;
    chunkDurationSec?: number;
    maxParallelChunks?: number;
    executionMode?: 'background' | 'interactive';
    signal?: AbortSignal;
  }
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  if (options.signal?.aborted) {
    throw new FFmpegError('Reverse proxy generation cancelled before start', 'cancelled', { reason: 'aborted' });
  }

  const startTime = options.startTime;
  const endTime = options.endTime;
  const fps = options.fps ?? 15;
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
  const encodingMode = options.encodingMode ?? 'auto';
  const quality = options.quality ?? 'high';
  const executionMode = options.executionMode ?? 'background';
  const signal = options.signal;

  if (!Number.isFinite(startTime) || startTime < 0) {
    throw new FFmpegError('Reverse proxy startTime must be a finite number >= 0', 'INVALID_OPTIONS');
  }
  if (!Number.isFinite(endTime) || endTime <= startTime) {
    throw new FFmpegError('Reverse proxy endTime must be greater than startTime', 'INVALID_OPTIONS');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new FFmpegError('Reverse proxy fps must be a finite number > 0', 'INVALID_OPTIONS');
  }
  if (encodingMode !== 'cpu' && encodingMode !== 'gpu' && encodingMode !== 'auto') {
    throw new FFmpegError('Reverse proxy encodingMode must be cpu, gpu, or auto', 'INVALID_OPTIONS');
  }
  if (quality !== 'high' && quality !== 'balanced' && quality !== 'fast') {
    throw new FFmpegError('Reverse proxy quality must be high, balanced, or fast', 'INVALID_OPTIONS');
  }
  if (executionMode !== 'background' && executionMode !== 'interactive') {
    throw new FFmpegError('Reverse proxy executionMode must be background or interactive', 'INVALID_OPTIONS');
  }

  const inputMetadata = await getVideoMetadata(inputPath);
  const hasAudio = Array.isArray(inputMetadata.audioTracks) && inputMetadata.audioTracks.length > 0;
  const recommendedChunkDuration = getRecommendedReverseChunkDuration(inputMetadata.width, inputMetadata.height, fps);
  const chunkDurationSec = options.chunkDurationSec ?? recommendedChunkDuration;
  if (!Number.isFinite(chunkDurationSec) || chunkDurationSec <= 0) {
    throw new FFmpegError('Reverse proxy chunkDurationSec must be a finite number > 0', 'INVALID_OPTIONS');
  }

  const generateWithPlan = async (encodingPlan: ProxyEncodingPlan): Promise<void> => {
    const cpuCount = Math.max(1, os.cpus().length);
    const defaultParallelism = executionMode === 'background'
      ? 1
      : encodingPlan.useGPU
        ? Math.max(1, Math.min(2, Math.floor(cpuCount / 4) || 1))
        : Math.max(1, Math.min(2, Math.floor(cpuCount / 2) || 1));
    const requestedParallelism = Math.max(1, Math.floor(options.maxParallelChunks ?? defaultParallelism));
    const maxParallelChunks = executionMode === 'background'
      ? 1
      : Math.min(2, requestedParallelism);
    console.log(
      `[ReverseProxy] Generating reverse proxy with backend=${encodingPlan.backend}, chunk=${chunkDurationSec}s, workers=${maxParallelChunks}, mode=${executionMode}`
    );

    await runChunkedChapterReverseGeneration({
      ffmpegBinaryPath: encodingPlan.ffmpegBinaryPath,
      inputPath,
      outputPath,
      startTime,
      endTime,
      fps,
      hasAudio,
      videoArgs: encodingPlan.videoArgs,
      hwaccelInputArgs: getHwaccelDecodeArgs(encodingPlan.backend),
      chunkDurationSec,
      maxParallelChunks,
      timeoutMs,
      signal,
    });
  };

  const initialPlan = await resolveProxyEncodingPlan(ffmpegPath.path, encodingMode, quality, 'ReverseProxy');
  try {
    await generateWithPlan(initialPlan);
  } catch (error) {
    const isCancelled = error instanceof FFmpegError && error.code === 'cancelled';
    if (!initialPlan.useGPU || isCancelled) {
      throw error;
    }

    const reason = error instanceof Error ? error.message : 'unknown gpu reverse generation error';
    console.warn(`[ReverseProxy] GPU reverse generation failed; retrying on CPU. reason=${reason}`);
    const cpuPlan = buildCpuProxyEncodingPlan(ffmpegPath.path, encodingMode, quality, reason);
    logProxyEncodingPlan('ReverseProxy', cpuPlan);
    await generateWithPlan(cpuPlan);
  }

  const outputMetadata = await getVideoMetadata(outputPath, 60000);
  const stats = fs.statSync(outputPath);

  return {
    width: outputMetadata.width,
    height: outputMetadata.height,
    framerate: Math.round(outputMetadata.fps),
    fileSize: stats.size,
    duration: outputMetadata.duration,
  };
}
