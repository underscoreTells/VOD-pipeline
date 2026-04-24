import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getFFmpegPath, getFFprobePath } from '../electron/ffmpegDetector.js';
import { detectGPUEncoders, getGPUFFmpegPath, getProxyEncoderArgs, type GPUEncoderBackend } from '../electron/gpuDetector.js';
import type {
  VideoMetadata,
  AudioTrackMetadata,
  ScaleOptions,
  FramerateOptions,
  ProxyOptions,
  CutOptions,
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
 * Get video duration in seconds
 */
export async function getDuration(filePath: string): Promise<number> {
  const metadata = await getVideoMetadata(filePath);
  return metadata.duration;
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

  return runFFmpeg(ffmpegPath.path, args);
}

/**
 * Cut video segment
 */
export async function cutVideo(
  inputPath: string,
  outputPath: string,
  options: CutOptions
): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const args: string[] = [
    '-ss', options.startTime.toString(),
    '-to', options.endTime.toString(),
    '-i', inputPath,
  ];

  if (options.reencode) {
    // Re-encode for precise cuts
    args.push('-c:v', 'libx264', '-c:a', 'aac');
  } else {
    // Copy codec for fast cuts (may have keyframe issues)
    args.push('-c', 'copy');
  }

  args.push('-y', outputPath);

  return runFFmpeg(ffmpegPath.path, args);
}

/**
 * Scale video while maintaining aspect ratio
 */
export async function scaleVideo(
  inputPath: string,
  outputPath: string,
  options: ScaleOptions
): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  let scaleFilter: string;

  if (options.maintainAspectRatio !== false) {
    // Maintain aspect ratio, scale to fit within dimensions
    if (options.width && options.height) {
      scaleFilter = `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:round((ow-iw)/2):round((oh-ih)/2)`;
    } else if (options.width) {
      scaleFilter = `scale=${options.width}:-2`;
    } else if (options.height) {
      scaleFilter = `scale=-2:${options.height}`;
    } else {
      throw new FFmpegError('Either width or height must be specified', 'INVALID_OPTIONS');
    }
  } else {
    // Stretch to exact dimensions
    if (options.width && options.height) {
      scaleFilter = `scale=${options.width}:${options.height}`;
    } else {
      throw new FFmpegError('Both width and height required when not maintaining aspect ratio', 'INVALID_OPTIONS');
    }
  }

  const args: string[] = [
    '-i', inputPath,
    '-vf', scaleFilter,
    '-c:v', 'libx264',
    '-c:a', 'copy',
    '-y', outputPath,
  ];

  return runFFmpeg(ffmpegPath.path, args);
}

/**
 * Change video framerate
 */
export async function setFramerate(
  inputPath: string,
  outputPath: string,
  options: FramerateOptions
): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const args: string[] = ['-i', inputPath];

  if (options.method === 'interpolate') {
    // Use motion interpolation for smoother results
    args.push(
      '-vf', `minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=${options.fps}'`,
      '-r', options.fps.toString()
    );
  } else {
    // Simple frame drop/duplicate
    args.push('-r', options.fps.toString());
  }

  args.push(
    '-c:v', 'libx264',
    '-c:a', 'copy',
    '-y', outputPath
  );

  return runFFmpeg(ffmpegPath.path, args);
}

/**
 * Generate proxy video with combined scale + framerate + codec settings
 */
export async function generateProxy(
  inputPath: string,
  outputPath: string,
  options: ProxyOptions
): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const args: string[] = ['-i', inputPath];

  // Build video filter
  const filters: string[] = [];

  // Scale
  filters.push(`scale=${options.width}:-2`);

  // Framerate
  filters.push(`fps=${options.fps}`);

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  // Video codec
  args.push('-c:v', options.videoCodec);

  if (options.videoBitrate) {
    args.push('-b:v', options.videoBitrate);
  }

  // Audio
  if (options.audioCodec) {
    args.push('-c:a', options.audioCodec);
  } else {
    args.push('-an'); // No audio by default for proxies
  }

  args.push('-y', outputPath);

  return runFFmpeg(ffmpegPath.path, args);
}

/**
 * Generate multiple resolution proxies
 */
export async function generateMultiResolutionProxies(
  inputPath: string,
  outputDir: string,
  resolutions: Array<{ width: number; suffix: string }>
): Promise<string[]> {
  const outputs: string[] = [];

  for (const { width, suffix } of resolutions) {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${baseName}_${suffix}.mp4`);

    await generateProxy(inputPath, outputPath, {
      width,
      fps: 24,
      videoCodec: 'libx264',
      videoBitrate: '1M',
    });

    outputs.push(outputPath);
  }

  return outputs;
}

/**
 * Run FFmpeg command and handle errors
 */
function runFFmpeg(
  executablePath: string,
  args: string[],
  timeoutMs: number = 30 * 60 * 1000,
  options?: { logCommand?: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options?.logCommand !== false) {
      console.log(`[FFmpeg] Running: ${executablePath} ${args.join(' ')}`);
    }

    const proc = spawn(executablePath, args);
    let errorOutput = '';
    let timeoutId: NodeJS.Timeout | null = null;

    // Set timeout
    timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new FFmpegError(
        `FFmpeg operation timed out after ${timeoutMs}ms`,
        'TIMEOUT',
        { timeout: timeoutMs }
      ));
    }, timeoutMs);

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new FFmpegError(
        `Failed to run FFmpeg: ${error.message}`,
        'FFMPEG_ERROR',
        error
      ));
    });

    proc.on('exit', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new FFmpegError(
          `FFmpeg failed with code ${code}`,
          'FFMPEG_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      resolve();
    });
  });
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
    console.log(`[FFmpeg] Validating video: ${filePath}`);

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      console.log(`[FFmpeg] Validation failed: not a file`);
      return false;
    }
    console.log(`[FFmpeg] File exists, size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    const ext = path.extname(filePath).toLowerCase();
    console.log(`[FFmpeg] Extension: ${ext}`);

    const validExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts', '.m2ts', '.mts'];

    if (!validExtensions.includes(ext)) {
      console.log(`[FFmpeg] Validation failed: extension ${ext} not in valid list`);
      return false;
    }

    // Try to get metadata with short timeout for quick validation
    console.log(`[FFmpeg] Attempting metadata extraction with 5s timeout...`);
    await getVideoMetadata(filePath, 5000);
    console.log(`[FFmpeg] Validation successful`);
    return true;
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
  trimOptions?: { startTime: number; endTime: number }
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
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
      trimRange
    );
  } catch (error) {
    if (!initialPlan.useGPU) {
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
      trimRange
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
  trimRange?: { startTime: number; endTime: number }
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const useCudaDecode = encodingPlan.backend === 'nvenc';

  if (encodingPlan.useGPU && useCudaDecode) {
    console.log('[Proxy] Enabling CUDA decode + scale for proxy generation');
  }

  const args: string[] = [
    ...(useCudaDecode ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'] : []),
    '-i', inputPath,
    ...(trimRange ? ['-ss', trimRange.startTime.toString(), '-to', trimRange.endTime.toString()] : []),
    ...(useCudaDecode ? ['-vf', 'scale_cuda=640:-2', '-r', '5'] : ['-vf', 'scale=640:-2,fps=5']),
    ...encodingPlan.videoArgs,
    '-c:a', 'aac',
    '-b:a', '64k', // Low bitrate audio is fine for analysis
    '-movflags', '+faststart', // Web-optimized
    '-y', outputPath,
  ];

  console.log(`[Proxy] FFmpeg args: ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(encodingPlan.ffmpegBinaryPath, args);
    let errorOutput = '';
    let lastProgress = 0;
    let timeoutTimer: NodeJS.Timeout | null = null;

    // Set up timeout if specified
    if (timeoutMs && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new FFmpegError(
          `AI proxy generation timed out after ${timeoutMs}ms`,
          'TIMEOUT',
          { timeout: timeoutMs }
        ));
      }, timeoutMs);
    }

    // Clear timeout helper
    const clearTimer = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;

      // Parse progress from FFmpeg output
      const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && metadata.duration > 0) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        const progress = Math.min(100, Math.round((currentTime / metadata.duration) * 100));
        
        if (progress > lastProgress) {
          lastProgress = progress;
          onProgress?.(progress);
        }
      }
    });

    proc.on('error', (error) => {
      clearTimer();
      reject(new FFmpegError(
        `Failed to generate AI proxy: ${error.message}`,
        'FFMPEG_ERROR',
        error
      ));
    });

    proc.on('close', async (code) => {
      // Clear timeout timer
      clearTimer();

      if (code !== 0) {
        // Check if this was a timeout kill (SIGTERM)
        if (code === null || code === 143) {
          reject(new FFmpegError(
            `AI proxy generation was terminated`,
            'TIMEOUT',
            { code }
          ));
          return;
        }
        
        reject(new FFmpegError(
          `AI proxy generation failed with code ${code}`,
          'FFMPEG_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      try {
        // Get proxy metadata
        const proxyMetadata = await getVideoMetadata(outputPath);
        const stats = fs.statSync(outputPath);

        resolve({
          width: proxyMetadata.width,
          height: proxyMetadata.height,
          framerate: Math.round(proxyMetadata.fps),
          fileSize: stats.size,
          duration: proxyMetadata.duration,
        });
      } catch (error) {
        reject(new FFmpegError(
          'Failed to read generated proxy metadata',
          'METADATA_ERROR',
          error
        ));
      }
    });
  });
}

/**
 * Generate proxy with progress streaming and timeout
 * Wrapper around generateAIProxy that sets default timeout
 */
export async function generateAIProxyWithProgress(
  inputPath: string,
  outputPath: string,
  options: {
    onProgress?: (percent: number) => void;
    timeoutMs?: number;
  } = {}
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const timeoutMs = options.timeoutMs || 30 * 60 * 1000; // 30 minutes default
  
  // Delegate to generateAIProxy with timeout built-in
  return generateAIProxy(inputPath, outputPath, options.onProgress, timeoutMs);
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
  chunkDurationSec: number;
  maxParallelChunks: number;
  timeoutMs: number;
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
    chunkDurationSec,
    maxParallelChunks,
    timeoutMs,
  } = params;

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
      const chunk = chunkRanges[index];
      const chunkPath = path.join(tempDir, `chunk_${String(index).padStart(4, '0')}.mp4`);
      chunkPaths[index] = chunkPath;

      const args: string[] = [
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
        '-movflags', '+faststart',
        '-y', chunkPath
      );

      await runFFmpeg(ffmpegBinaryPath, args, timeoutMs, { logCommand: false });

      completedChunks += 1;
      if (completedChunks === 1 || completedChunks === totalChunks || completedChunks % logStep === 0) {
        console.log(`[ReverseProxy] Chunk progress ${completedChunks}/${totalChunks}`);
      }
    };

    let nextChunkIndex = 0;
    let shouldStop = false;
    const workers = Array.from({ length: workerCount }, async () => {
      while (!shouldStop) {
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

    const concatListPath = path.join(tempDir, 'concat-list.txt');
    const concatList = chunkPaths.map((chunkPath) => toConcatFileEntry(chunkPath)).join('\n');
    fs.writeFileSync(concatListPath, `${concatList}\n`, 'utf-8');

    const concatArgs: string[] = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:v', 'copy',
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      '-movflags', '+faststart',
      '-y', outputPath,
    ];

    await runFFmpeg(ffmpegBinaryPath, concatArgs, timeoutMs);
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
  }
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const startTime = options.startTime;
  const endTime = options.endTime;
  const fps = options.fps ?? 15;
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
  const encodingMode = options.encodingMode ?? 'auto';
  const quality = options.quality ?? 'high';

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

  const inputMetadata = await getVideoMetadata(inputPath);
  const hasAudio = Array.isArray(inputMetadata.audioTracks) && inputMetadata.audioTracks.length > 0;
  const recommendedChunkDuration = getRecommendedReverseChunkDuration(inputMetadata.width, inputMetadata.height, fps);
  const chunkDurationSec = options.chunkDurationSec ?? recommendedChunkDuration;
  if (!Number.isFinite(chunkDurationSec) || chunkDurationSec <= 0) {
    throw new FFmpegError('Reverse proxy chunkDurationSec must be a finite number > 0', 'INVALID_OPTIONS');
  }

  const generateWithPlan = async (encodingPlan: ProxyEncodingPlan): Promise<void> => {
    const cpuCount = Math.max(1, os.cpus().length);
    const defaultParallelism = encodingPlan.useGPU
      ? Math.max(1, Math.min(4, Math.floor(cpuCount / 4) || 1))
      : Math.max(1, Math.min(8, Math.floor(cpuCount / 2) || 1));
    const maxParallelChunks = Math.max(1, Math.floor(options.maxParallelChunks ?? defaultParallelism));
    console.log(
      `[ReverseProxy] Generating reverse proxy with backend=${encodingPlan.backend}, chunk=${chunkDurationSec}s, workers=${maxParallelChunks}`
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
      chunkDurationSec,
      maxParallelChunks,
      timeoutMs,
    });
  };

  const initialPlan = await resolveProxyEncodingPlan(ffmpegPath.path, encodingMode, quality, 'ReverseProxy');
  try {
    await generateWithPlan(initialPlan);
  } catch (error) {
    if (!initialPlan.useGPU) {
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
