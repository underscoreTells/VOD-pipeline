import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { getAudiowaveformPath } from '../electron/audiowaveformDetector.js';
import { getFFmpegPath, getFFprobePath } from '../electron/ffmpegDetector.js';
import { checkWaveformExists, saveWaveform } from '../electron/database/index.js';
import type {
  WaveformPeak,
  WaveformProgress,
  WaveformProgressCallback,
  WaveformGenerationResult,
} from '../shared/types/pipeline.js';
import { WAVEFORM_TIERS } from '../shared/types/pipeline.js';

export class WaveformError extends Error {
  constructor(
    message: string,
    public code: 
      | 'AUDIOWAVEFORM_NOT_FOUND' 
      | 'GENERATION_ERROR'
      | 'JSON_PARSE_ERROR'
      | 'TIER_GENERATION_ERROR',
    public details?: unknown
  ) {
    super(message);
    this.name = 'WaveformError';
  }
}

const MIX_WAVEFORM_TRACK_INDEX = -1;
const MIN_PARALLEL_TRACK_GENERATION = 1;
const MAX_PARALLEL_TRACK_GENERATION = 4;
const PLAYBACK_PARALLEL_TRACK_GENERATION = 1;
const MAX_TIER2_PEAKS = 1_000_000;

const SUPPORTED_WAVEFORM_AUDIO_EXTENSIONS = new Set([
  '.wav',
  '.wave',
  '.flac',
  '.aiff',
  '.aif',
  '.aifc',
  '.mp3',
  '.ogg',
  '.oga',
  '.opus',
]);

interface WaveformGenerationOptions {
  includeTier2?: boolean;
}

interface MkvWaveformGenerationOptions {
  includeTier2?: boolean;
  maxParallelTracks?: number;
  playbackActive?: boolean;
  trackIndices?: number[];
}

/**
 * Generate all waveform tiers for an audio file using audiowaveform
 * Falls back gracefully if audiowaveform is not available
 */
export async function generateWaveformTiers(
  audioPath: string,
  assetId: number,
  trackIndex: number = 0,
  onProgress?: WaveformProgressCallback,
  options: WaveformGenerationOptions = {}
): Promise<WaveformGenerationResult> {
  const audiowaveformPath = getAudiowaveformPath();

  if (!audiowaveformPath) {
    throw new WaveformError(
      'audiowaveform not found. Install audiowaveform for waveform visualization.',
      'AUDIOWAVEFORM_NOT_FOUND'
    );
  }

  const includeTier2 = options.includeTier2 ?? true;
  const tempDir = os.tmpdir();
  let waveformInputPath: string = audioPath;
  let tempAudioPath: string | null = null;

  try {
    if (onProgress) {
      onProgress({ tier: 1, percent: 0, status: 'Preparing audio for waveform...', trackIndex });
    }

    const preparedInput = await prepareWaveformInput(
      audioPath,
      tempDir,
      trackIndex,
      (percent, status) => {
        if (onProgress) {
          onProgress({ tier: 1, percent, status, trackIndex });
        }
      }
    );
    waveformInputPath = preparedInput.path;
    tempAudioPath = preparedInput.tempPath;

    return await generateAndPersistWaveformTiers({
      audiowaveformBinaryPath: audiowaveformPath.path,
      waveformInputPath,
      tempDir,
      assetId,
      trackIndex,
      includeTier2,
      onProgress,
    });
  } catch (error) {
    console.error('[Waveform] Generation failed:', error);
    if (error instanceof WaveformError) {
      throw error;
    }
    throw new WaveformError(
      `Waveform generation failed: ${error instanceof Error ? error.message : String(error)}`,
      'GENERATION_ERROR',
      error
    );
  } finally {
    if (tempAudioPath) {
      cleanupTempFiles([tempAudioPath]);
    }
  }
}

/**
 * Optimized waveform generation path for multi-track MKV assets.
 *
 * Phase 1: Track-level parallelism with a configurable worker limit.
 * Phase 2: Single FFmpeg pass that extracts mix + source tracks at once.
 */
export async function generateWaveformTiersForMkvTracks(
  inputPath: string,
  assetId: number,
  onProgress?: WaveformProgressCallback,
  options: MkvWaveformGenerationOptions = {}
): Promise<WaveformGenerationResult[]> {
  if (path.extname(inputPath).toLowerCase() !== '.mkv') {
    return [];
  }

  const audiowaveformPath = getAudiowaveformPath();
  if (!audiowaveformPath) {
    throw new WaveformError(
      'audiowaveform not found. Install audiowaveform for waveform visualization.',
      'AUDIOWAVEFORM_NOT_FOUND'
    );
  }

  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new WaveformError('FFmpeg not found for waveform generation', 'GENERATION_ERROR');
  }

  const ffprobePath = getFFprobePath(ffmpegPath.path);
  const audioStreamCount = await getAudioStreamCount(ffprobePath, inputPath);

  if (audioStreamCount <= 1) {
    return [];
  }

  const includeTier2 = options.includeTier2 ?? false;
  const requestedTrackIndices = resolveRequestedTrackIndices(
    audioStreamCount,
    options.trackIndices
  );

  if (requestedTrackIndices.length === 0) {
    return [];
  }

  const generationPlans = await Promise.all(
    requestedTrackIndices.map(async (currentTrackIndex) => {
      const tier1Exists = await checkWaveformExists(assetId, currentTrackIndex, 1);
      const tier2Exists = includeTier2
        ? await checkWaveformExists(assetId, currentTrackIndex, 2)
        : false;

      return {
        trackIndex: currentTrackIndex,
        skipTier1: tier1Exists,
        skipTier2: includeTier2 ? tier2Exists : true,
      };
    })
  );

  const results = new Map<number, WaveformGenerationResult>();
  const tracksToGenerate = generationPlans.filter((plan) => !plan.skipTier1 || !plan.skipTier2);

  for (const plan of generationPlans) {
    if (plan.skipTier1 && plan.skipTier2) {
      results.set(plan.trackIndex, {
        assetId,
        trackIndex: plan.trackIndex,
        tiers: [],
      });
      onProgress?.({
        tier: 1,
        percent: 100,
        status: `${formatTrackLabel(plan.trackIndex)} waveform cache hit`,
        trackIndex: plan.trackIndex,
      });
    }
  }

  if (tracksToGenerate.length === 0) {
    return requestedTrackIndices.map((currentTrackIndex) => results.get(currentTrackIndex) ?? {
      assetId,
      trackIndex: currentTrackIndex,
      tiers: [],
    });
  }

  const tempDir = os.tmpdir();
  const durationSeconds = await getMediaDurationSeconds(ffmpegPath.path, inputPath);
  const preparedInputs = await transcodeToWaveformAudioBatch(
    ffmpegPath.path,
    inputPath,
    tracksToGenerate.map((plan) => plan.trackIndex),
    audioStreamCount,
    tempDir,
    durationSeconds,
    (percent, status) => {
      onProgress?.({ tier: 1, percent, status });
    }
  );

  const tempAudioPaths = Array.from(preparedInputs.values());

  try {
    const maxParallelTracks = resolveParallelTrackGeneration(
      options.maxParallelTracks,
      options.playbackActive
    );

    await runWithConcurrency(tracksToGenerate, maxParallelTracks, async (plan) => {
      const waveformInputPath = preparedInputs.get(plan.trackIndex);
      if (!waveformInputPath) {
        throw new WaveformError(
          `Missing prepared audio for track ${plan.trackIndex}`,
          'GENERATION_ERROR'
        );
      }

      const trackResult = await generateAndPersistWaveformTiers({
        audiowaveformBinaryPath: audiowaveformPath.path,
        waveformInputPath,
        tempDir,
        assetId,
        trackIndex: plan.trackIndex,
        includeTier2,
        skipTier1: plan.skipTier1,
        skipTier2: plan.skipTier2,
        onProgress,
      });

      results.set(plan.trackIndex, trackResult);
    });
  } catch (error) {
    console.error('[Waveform] MKV batch generation failed:', error);
    if (results.size === 0) {
      if (error instanceof WaveformError) {
        throw error;
      }
      throw new WaveformError(
        `MKV waveform generation failed: ${error instanceof Error ? error.message : String(error)}`,
        'GENERATION_ERROR',
        error
      );
    }
  } finally {
    cleanupTempFiles(tempAudioPaths);
  }

  return requestedTrackIndices.map((currentTrackIndex) => results.get(currentTrackIndex) ?? {
    assetId,
    trackIndex: currentTrackIndex,
    tiers: [],
  });
}

interface GenerateWaveformTiersFromPreparedInputArgs {
  audiowaveformBinaryPath: string;
  waveformInputPath: string;
  tempDir: string;
  assetId: number;
  trackIndex: number;
  includeTier2: boolean;
  skipTier1?: boolean;
  skipTier2?: boolean;
  onProgress?: WaveformProgressCallback;
}

async function generateAndPersistWaveformTiers({
  audiowaveformBinaryPath,
  waveformInputPath,
  tempDir,
  assetId,
  trackIndex,
  includeTier2,
  skipTier1 = false,
  skipTier2 = false,
  onProgress,
}: GenerateWaveformTiersFromPreparedInputArgs): Promise<WaveformGenerationResult> {
  const tiers: WaveformGenerationResult['tiers'] = [];
  let tier1Result: { peaks: WaveformPeak[]; sampleRate: number; duration: number } | null = null;

  try {
    if (!skipTier1) {
      onProgress?.({
        tier: 1,
        percent: 20,
        status: `Generating overview waveform (${formatTrackLabel(trackIndex)})...`,
        trackIndex,
      });

      tier1Result = await generateTierWithAudiowaveform(
        audiowaveformBinaryPath,
        waveformInputPath,
        tempDir,
        1,
        256,
        8
      );

      if (tier1Result) {
        tiers.push({ level: 1, ...tier1Result });
        await saveWaveform(assetId, trackIndex, 1, tier1Result.peaks, tier1Result.sampleRate, tier1Result.duration);
      }

      onProgress?.({
        tier: 1,
        percent: 100,
        status: `${formatTrackLabel(trackIndex)} overview complete`,
        trackIndex,
      });
    }

    if (!includeTier2 || skipTier2) {
      if (!includeTier2) {
        onProgress?.({
          tier: 2,
          percent: 100,
          status: `${formatTrackLabel(trackIndex)} standard deferred`,
          trackIndex,
        });
      }

      return {
        assetId,
        trackIndex,
        tiers,
      };
    }

    let skipTier2ForLength = false;
    if (tier1Result) {
      const tier1Ratio = WAVEFORM_TIERS[1].ratio;
      const tier2Ratio = WAVEFORM_TIERS[2].ratio;
      const estimatedTier2Peaks = Math.round(tier1Result.peaks.length * (tier1Ratio / tier2Ratio));
      skipTier2ForLength = estimatedTier2Peaks > MAX_TIER2_PEAKS;
    }

    if (skipTier2ForLength) {
      onProgress?.({
        tier: 2,
        percent: 100,
        status: `${formatTrackLabel(trackIndex)} standard skipped (asset too long)`,
        trackIndex,
      });

      return {
        assetId,
        trackIndex,
        tiers,
      };
    }

    onProgress?.({
      tier: 2,
      percent: 70,
      status: `Generating standard waveform (${formatTrackLabel(trackIndex)})...`,
      trackIndex,
    });

    const tier2Result = await generateTierWithAudiowaveform(
      audiowaveformBinaryPath,
      waveformInputPath,
      tempDir,
      2,
      16,
      16
    );

    if (tier2Result) {
      tiers.push({ level: 2, ...tier2Result });
      await saveWaveform(assetId, trackIndex, 2, tier2Result.peaks, tier2Result.sampleRate, tier2Result.duration);
    }

    onProgress?.({
      tier: 2,
      percent: 100,
      status: `${formatTrackLabel(trackIndex)} standard complete`,
      trackIndex,
    });

    return {
      assetId,
      trackIndex,
      tiers,
    };
  } catch (error) {
    console.error(`[Waveform] Failed generating tiers for track ${trackIndex}:`, error);
    if (tiers.length > 0) {
      return {
        assetId,
        trackIndex,
        tiers,
      };
    }
    throw error;
  }
}

function formatTrackLabel(trackIndex: number): string {
  if (trackIndex === MIX_WAVEFORM_TRACK_INDEX) {
    return 'Mix';
  }
  return `A${trackIndex + 1}`;
}

function resolveRequestedTrackIndices(
  audioStreamCount: number,
  requestedTrackIndices?: number[]
): number[] {
  if (!requestedTrackIndices || requestedTrackIndices.length === 0) {
    return [
      MIX_WAVEFORM_TRACK_INDEX,
      ...Array.from({ length: audioStreamCount }, (_, index) => index),
    ];
  }

  const normalized: number[] = [];

  for (const trackIndex of requestedTrackIndices) {
    if (trackIndex === MIX_WAVEFORM_TRACK_INDEX) {
      normalized.push(MIX_WAVEFORM_TRACK_INDEX);
      continue;
    }

    if (Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < audioStreamCount) {
      normalized.push(trackIndex);
    }
  }

  const deduped = Array.from(new Set(normalized));

  if (deduped.length === 0) {
    return [MIX_WAVEFORM_TRACK_INDEX];
  }

  deduped.sort((a, b) => {
    if (a === MIX_WAVEFORM_TRACK_INDEX) return -1;
    if (b === MIX_WAVEFORM_TRACK_INDEX) return 1;
    return a - b;
  });

  return deduped;
}

function resolveParallelTrackGeneration(
  requestedConcurrency?: number,
  playbackActive?: boolean
): number {
  if (playbackActive) {
    return PLAYBACK_PARALLEL_TRACK_GENERATION;
  }

  if (typeof requestedConcurrency === 'number' && Number.isFinite(requestedConcurrency)) {
    return Math.max(
      MIN_PARALLEL_TRACK_GENERATION,
      Math.min(MAX_PARALLEL_TRACK_GENERATION, Math.floor(requestedConcurrency))
    );
  }

  const cpuCount = Math.max(1, os.cpus().length);
  const adaptiveConcurrency = Math.floor(cpuCount / 2);

  return Math.max(
    MIN_PARALLEL_TRACK_GENERATION,
    Math.min(MAX_PARALLEL_TRACK_GENERATION, adaptiveConcurrency)
  );
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  });

  const settled = await Promise.allSettled(runners);
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) {
    throw rejected.reason;
  }
}

function cleanupTempFiles(paths: string[]) {
  for (const currentPath of paths) {
    try {
      if (fs.existsSync(currentPath)) {
        fs.unlinkSync(currentPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function prepareWaveformInput(
  inputPath: string,
  tempDir: string,
  trackIndex: number,
  onProgress?: (percent: number, status: string) => void
): Promise<{ path: string; tempPath: string | null }> {
  const extension = path.extname(inputPath).toLowerCase();

  if (SUPPORTED_WAVEFORM_AUDIO_EXTENSIONS.has(extension)) {
    return { path: inputPath, tempPath: null };
  }

  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new WaveformError('FFmpeg not found for waveform generation', 'GENERATION_ERROR');
  }

  const tempWavPath = path.join(tempDir, `waveform_${randomUUID()}.wav`);
  const durationSeconds = await getMediaDurationSeconds(ffmpegPath.path, inputPath);
  await transcodeToWaveformAudio(
    ffmpegPath.path,
    getFFprobePath(ffmpegPath.path),
    inputPath,
    tempWavPath,
    trackIndex,
    durationSeconds,
    onProgress
  );

  return { path: tempWavPath, tempPath: tempWavPath };
}

async function transcodeToWaveformAudio(
  ffmpegBinaryPath: string,
  ffprobeBinaryPath: string,
  inputPath: string,
  outputPath: string,
  trackIndex: number,
  durationSeconds: number | null,
  onProgress?: (percent: number, status: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const audioStreamCount = await getAudioStreamCount(ffprobeBinaryPath, inputPath);
      const args = [
        '-y',
        '-i', inputPath,
        ...buildTrackSelectionArgs(trackIndex, audioStreamCount),
        '-vn',
        '-ac', '1',
        '-ar', '11025',
        '-c:a', 'pcm_s16le',
        '-f', 'wav',
        '-progress', 'pipe:1',
        '-nostats',
        outputPath,
      ];

      const proc = spawn(ffmpegBinaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let errorOutput = '';
      let progressBuffer = '';
      let lastReportedPercent = -1;

      const reportProgressSeconds = (outTimeSeconds: number) => {
        if (!durationSeconds || !onProgress) return;
        const rawPercent = Math.min(100, Math.max(0, (outTimeSeconds / durationSeconds) * 100));
        const mappedPercent = Math.min(10, Math.max(0, Math.round(rawPercent / 10)));
        if (mappedPercent !== lastReportedPercent) {
          lastReportedPercent = mappedPercent;
          onProgress(mappedPercent, 'Preparing audio for waveform...');
        }
      };

      const parseOutTimeSeconds = (value: string): number | null => {
        const parts = value.trim().split(':');
        if (parts.length !== 3) return null;
        const hours = Number.parseFloat(parts[0]);
        const minutes = Number.parseFloat(parts[1]);
        const seconds = Number.parseFloat(parts[2]);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
          return null;
        }
        return (hours * 3600) + (minutes * 60) + seconds;
      };

      proc.stdout.on('data', (data) => {
        if (!durationSeconds || !onProgress) return;
        progressBuffer += data.toString();
        let newlineIndex = progressBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = progressBuffer.slice(0, newlineIndex).trim();
          progressBuffer = progressBuffer.slice(newlineIndex + 1);
          const [key, value] = line.split('=');
          if (key === 'out_time') {
            const outTimeSeconds = parseOutTimeSeconds(value);
            if (outTimeSeconds !== null) {
              reportProgressSeconds(outTimeSeconds);
            }
          } else if (key === 'out_time_ms' || key === 'out_time_us') {
            const outTimeRaw = Number(value);
            const outTimeSeconds = Number.isFinite(outTimeRaw)
              ? outTimeRaw / 1_000_000
              : null;
            if (outTimeSeconds !== null) {
              reportProgressSeconds(outTimeSeconds);
            }
          }
          newlineIndex = progressBuffer.indexOf('\n');
        }
      });

      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('error', (error) => {
        reject(new WaveformError(
          `Failed to run FFmpeg for waveform input: ${error.message}`,
          'GENERATION_ERROR',
          error
        ));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new WaveformError(
            `FFmpeg failed to prepare waveform input with code ${code}`,
            'GENERATION_ERROR',
            { code, error: errorOutput }
          ));
          return;
        }

        if (onProgress) {
          onProgress(10, 'Audio preparation complete');
        }
        resolve();
      });
    })().catch((error) => {
      reject(new WaveformError(
        `Failed to prepare waveform input: ${error instanceof Error ? error.message : String(error)}`,
        'GENERATION_ERROR',
        error
      ));
    });
  });
}

async function transcodeToWaveformAudioBatch(
  ffmpegBinaryPath: string,
  inputPath: string,
  trackIndices: number[],
  audioStreamCount: number,
  tempDir: string,
  durationSeconds: number | null,
  onProgress?: (percent: number, status: string) => void
): Promise<Map<number, string>> {
  return new Promise((resolve, reject) => {
    const outputPaths = new Map<number, string>();
    const args: string[] = [
      '-y',
      '-i', inputPath,
    ];

    if (trackIndices.includes(MIX_WAVEFORM_TRACK_INDEX) && audioStreamCount > 1) {
      const labels = Array.from({ length: audioStreamCount }, (_, index) => `[0:a:${index}]`).join('');
      const filter = `${labels}amix=inputs=${audioStreamCount}:dropout_transition=0:normalize=0[aout]`;
      args.push('-filter_complex', filter);
    }

    args.push('-progress', 'pipe:1', '-nostats');

    for (const trackIndex of trackIndices) {
      const outputPath = path.join(tempDir, `waveform_${randomUUID()}_track${trackIndex}.wav`);
      outputPaths.set(trackIndex, outputPath);

      if (trackIndex === MIX_WAVEFORM_TRACK_INDEX && audioStreamCount > 1) {
        args.push('-map', '[aout]');
      } else {
        const normalizedTrackIndex =
          Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < audioStreamCount
            ? trackIndex
            : 0;
        args.push('-map', `0:a:${normalizedTrackIndex}`);
      }

      args.push(
        '-vn',
        '-ac', '1',
        '-ar', '11025',
        '-c:a', 'pcm_s16le',
        '-f', 'wav',
        outputPath
      );
    }

    const proc = spawn(ffmpegBinaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errorOutput = '';
    let progressBuffer = '';
    let lastReportedPercent = -1;

    const reportProgressSeconds = (outTimeSeconds: number) => {
      if (!durationSeconds || !onProgress) return;
      const rawPercent = Math.min(100, Math.max(0, (outTimeSeconds / durationSeconds) * 100));
      const mappedPercent = Math.min(10, Math.max(0, Math.round(rawPercent / 10)));
      if (mappedPercent !== lastReportedPercent) {
        lastReportedPercent = mappedPercent;
        onProgress(mappedPercent, 'Preparing audio for waveform...');
      }
    };

    const parseOutTimeSeconds = (value: string): number | null => {
      const parts = value.trim().split(':');
      if (parts.length !== 3) return null;
      const hours = Number.parseFloat(parts[0]);
      const minutes = Number.parseFloat(parts[1]);
      const seconds = Number.parseFloat(parts[2]);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
        return null;
      }
      return (hours * 3600) + (minutes * 60) + seconds;
    };

    proc.stdout.on('data', (data) => {
      if (!durationSeconds || !onProgress) return;
      progressBuffer += data.toString();
      let newlineIndex = progressBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = progressBuffer.slice(0, newlineIndex).trim();
        progressBuffer = progressBuffer.slice(newlineIndex + 1);
        const [key, value] = line.split('=');

        if (key === 'out_time') {
          const outTimeSeconds = parseOutTimeSeconds(value);
          if (outTimeSeconds !== null) {
            reportProgressSeconds(outTimeSeconds);
          }
        } else if (key === 'out_time_ms' || key === 'out_time_us') {
          const outTimeRaw = Number(value);
          const outTimeSeconds = Number.isFinite(outTimeRaw)
            ? outTimeRaw / 1_000_000
            : null;
          if (outTimeSeconds !== null) {
            reportProgressSeconds(outTimeSeconds);
          }
        }

        newlineIndex = progressBuffer.indexOf('\n');
      }
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      cleanupTempFiles(Array.from(outputPaths.values()));
      reject(new WaveformError(
        `Failed to run FFmpeg for waveform input: ${error.message}`,
        'GENERATION_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        cleanupTempFiles(Array.from(outputPaths.values()));
        reject(new WaveformError(
          `FFmpeg failed to prepare waveform inputs with code ${code}`,
          'GENERATION_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      onProgress?.(10, 'Audio preparation complete');
      resolve(outputPaths);
    });
  });
}

function buildTrackSelectionArgs(trackIndex: number, audioStreamCount: number): string[] {
  if (audioStreamCount <= 0) {
    return [];
  }

  if (trackIndex === MIX_WAVEFORM_TRACK_INDEX && audioStreamCount > 1) {
    const labels = Array.from({ length: audioStreamCount }, (_, index) => `[0:a:${index}]`).join('');
    const filter = `${labels}amix=inputs=${audioStreamCount}:dropout_transition=0:normalize=0[aout]`;
    return ['-filter_complex', filter, '-map', '[aout]'];
  }

  const normalizedTrackIndex =
    Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < audioStreamCount
      ? trackIndex
      : 0;

  return ['-map', `0:a:${normalizedTrackIndex}`];
}

async function getAudioStreamCount(ffprobePath: string, inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      inputPath,
    ];

    const proc = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to run ffprobe: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed with code ${code}: ${errorOutput}`));
        return;
      }

      const count = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .length;

      resolve(count);
    });
  });
}

async function getMediaDurationSeconds(ffmpegPath: string, inputPath: string): Promise<number | null> {
  const ffprobePath = getFFprobePath(ffmpegPath);
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ];
    const proc = spawn(ffprobePath, args);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('error', () => resolve(null));

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const duration = Number.parseFloat(output.trim());
      resolve(Number.isFinite(duration) ? duration : null);
    });
  });
}

/**
 * Generate a single tier using audiowaveform
 * Uses JSON output format for easy parsing
 */
async function generateTierWithAudiowaveform(
  binaryPath: string,
  audioPath: string,
  tempDir: string,
  tierLevel: 1 | 2 | 3,
  zoom: number,
  bits: 8 | 16
): Promise<{ peaks: WaveformPeak[]; sampleRate: number; duration: number } | null> {
  const tempJsonPath = path.join(tempDir, `waveform_${randomUUID()}_tier${tierLevel}.json`);

  try {
    // Run audiowaveform with JSON output
    await executeAudiowaveform(binaryPath, audioPath, tempJsonPath, zoom, bits);

    // Parse JSON output
    const jsonContent = await fs.promises.readFile(tempJsonPath, 'utf-8');
    const waveformData = JSON.parse(jsonContent);

    // Convert to our peak format
    const peaks = convertJsonToPeaks(waveformData, bits);
    
    // Calculate duration from sample rate and data length
    const sampleRate = waveformData.sample_rate || 44100;
    const samplesPerPixel = waveformData.samples_per_pixel || zoom;
    const duration = (peaks.length * samplesPerPixel) / sampleRate;

    return { peaks, sampleRate, duration };
  } catch (error) {
    console.error(`[Waveform] Failed to generate tier ${tierLevel}:`, error);
    
    if (error instanceof WaveformError) {
      throw error;
    }
    
    throw new WaveformError(
      `Tier ${tierLevel} generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'TIER_GENERATION_ERROR',
      error
    );
  } finally {
    // Cleanup temp file
    try {
      if (fs.existsSync(tempJsonPath)) {
        fs.unlinkSync(tempJsonPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Execute audiowaveform CLI
 */
async function executeAudiowaveform(
  binaryPath: string,
  inputPath: string,
  outputPath: string,
  zoom: number,
  bits: 8 | 16
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-z', zoom.toString(),
      '-b', bits.toString(),
    ];

    const proc = spawn(binaryPath, args);
    let errorOutput = '';

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      reject(new WaveformError(
        `Failed to run audiowaveform: ${error.message}`,
        'GENERATION_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new WaveformError(
          `audiowaveform failed with code ${code}`,
          'GENERATION_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      resolve();
    });
  });
}

/**
 * Convert audiowaveform JSON data to WaveformPeak array
 * 
 * audiowaveform JSON format:
 * {
 *   "sample_rate": 44100,
 *   "samples_per_pixel": 256,
 *   "bits": 8,
 *   "length": 1234,
 *   "data": [min1, max1, min2, max2, ...]  // min/max pairs
 * }
 */
function convertJsonToPeaks(
  waveformData: { data: number[]; bits?: number },
  bits: number
): WaveformPeak[] {
  const peaks: WaveformPeak[] = [];
  const data = waveformData.data;
  
  if (!data || !Array.isArray(data)) {
    throw new WaveformError(
      'Invalid JSON data format: missing data array',
      'JSON_PARSE_ERROR'
    );
  }

  // Process min/max pairs
  for (let i = 0; i < data.length; i += 2) {
    const min = data[i];
    const max = data[i + 1];
    
    // Normalize to -1.0 to 1.0 range
    if (bits === 8) {
      peaks.push({
        min: min / 128,
        max: max / 128,
      });
    } else {
      // 16-bit
      peaks.push({
        min: min / 32768,
        max: max / 32768,
      });
    }
  }

  return peaks;
}

/**
 * Generate Tier 3 (fine detail) on-demand
 * This is not cached and regenerated as needed
 */
export async function generateTier3OnDemand(
  audioPath: string,
  trackIndex: number = 0,
  startTime: number = 0,
  duration: number = 60
): Promise<WaveformPeak[]> {
  const audiowaveformPath = getAudiowaveformPath();
  
  if (!audiowaveformPath) {
    throw new WaveformError(
      'audiowaveform not found. Cannot generate fine detail waveform.',
      'AUDIOWAVEFORM_NOT_FOUND'
    );
  }

  const tempDir = os.tmpdir();
  const tempJsonPath = path.join(tempDir, `waveform_tier3_${randomUUID()}.json`);

  try {
    // Run audiowaveform with time range options
    await executeAudiowaveformWithTimeRange(
      audiowaveformPath.path,
      audioPath,
      tempJsonPath,
      startTime,
      duration
    );

    // Parse JSON output
    const jsonContent = await fs.promises.readFile(tempJsonPath, 'utf-8');
    const waveformData = JSON.parse(jsonContent);

    // Convert to peaks
    return convertJsonToPeaks(waveformData, 16);
  } catch (error) {
    console.error('[Waveform] Tier 3 generation failed:', error);
    if (error instanceof WaveformError) {
      throw error;
    }
    throw new WaveformError(
      `Tier 3 generation failed: ${error instanceof Error ? error.message : String(error)}`,
      'TIER_GENERATION_ERROR',
      error
    );
  } finally {
    try {
      if (fs.existsSync(tempJsonPath)) {
        fs.unlinkSync(tempJsonPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Execute audiowaveform with time range options
 * Note: audiowaveform supports --start and --end flags
 */
async function executeAudiowaveformWithTimeRange(
  binaryPath: string,
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-z', '4',  // Fine zoom level
      '-b', '16', // 16-bit for better precision
      '--start', startTime.toString(),
      '--end', (startTime + duration).toString(),
    ];

    const proc = spawn(binaryPath, args);
    let errorOutput = '';

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      reject(new WaveformError(
        `Failed to run audiowaveform: ${error.message}`,
        'GENERATION_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new WaveformError(
          `audiowaveform failed with code ${code}`,
          'GENERATION_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      resolve();
    });
  });
}

/**
 * Calculate target zoom level for switching between tiers
 */
export function getTierForZoomLevel(zoomLevel: number): 1 | 2 | 3 {
  if (zoomLevel <= 100) return 1;
  if (zoomLevel < 250) return 2;
  return 3;
}

/**
 * Get appropriate pixel per second for a tier
 */
export function getPixelsPerSecondForTier(tier: 1 | 2 | 3): number {
  switch (tier) {
    case 1: return 50;   // Overview: 50 px/sec
    case 2: return 200;  // Standard: 200 px/sec
    case 3: return 500;  // Fine: 500 px/sec
  }
}

/**
 * Check if waveform generation is available
 */
export function isWaveformGenerationAvailable(): boolean {
  return getAudiowaveformPath() !== null;
}
