import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getFFmpegPath, getFFprobePath } from '../electron/ffmpegDetector.js';
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

/**
 * Get video metadata using ffprobe
 */
export async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
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

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      reject(new FFmpegError(
        `Failed to run ffprobe: ${error.message}`,
        'FFPROBE_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
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

  const args: string[] = [
    '-i', videoPath,
    '-vn', // No video
  ];

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
function runFFmpeg(executablePath: string, args: string[], timeoutMs: number = 30 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[FFmpeg] Running: ${executablePath} ${args.join(' ')}`);

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
 */
export async function isValidVideo(filePath: string): Promise<boolean> {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return false;

    const ext = path.extname(filePath).toLowerCase();
    const validExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts'];

    if (!validExtensions.includes(ext)) return false;

    // Try to get metadata
    await getVideoMetadata(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate AI analysis proxy (640px, 5fps, H.264, AAC)
 * Optimized for AI video analysis - small file size, adequate quality
 */
export async function generateAIProxy(
  inputPath: string,
  outputPath: string,
  onProgress?: (percent: number) => void,
  timeoutMs?: number
): Promise<{ width: number; height: number; framerate: number; fileSize: number; duration: number }> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new FFmpegError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  // Get source metadata first
  const metadata = await getVideoMetadata(inputPath);

  const args: string[] = [
    '-i', inputPath,
    '-vf', 'scale=640:-2,fps=5', // 640px width, maintain aspect, 5fps
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '28', // Good quality, smaller file size
    '-c:a', 'aac',
    '-b:a', '64k', // Low bitrate audio is fine for analysis
    '-movflags', '+faststart', // Web-optimized
    '-y', outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath.path, args);
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
