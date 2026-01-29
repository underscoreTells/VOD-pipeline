import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getFFmpegPath } from '../electron/ffmpegDetector';
import type {
  WaveformPeak,
  WaveformTier,
  WaveformProgress,
  WaveformProgressCallback,
  WaveformGenerationResult,
} from '../shared/types/pipeline';
import { WAVEFORM_TIERS } from '../shared/types/pipeline';

export class WaveformError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'WaveformError';
  }
}

/**
 * Generate all waveform tiers for an audio file
 * Uses FFmpeg to extract PCM audio and calculate min/max peaks
 */
export async function generateWaveformTiers(
  audioPath: string,
  assetId: number,
  trackIndex: number = 0,
  onProgress?: WaveformProgressCallback
): Promise<WaveformGenerationResult> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new WaveformError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const tempDir = os.tmpdir();
  const tempPcmPath = path.join(tempDir, `waveform_${assetId}_${trackIndex}_${Date.now()}.pcm`);

  try {
    // Extract raw PCM audio first
    await extractPcmAudio(ffmpegPath.path, audioPath, tempPcmPath, trackIndex);

    const tiers: WaveformGenerationResult['tiers'] = [];

    // Generate Tier 1 (Overview - 256:1)
    if (onProgress) {
      onProgress({ tier: 1, percent: 0, status: 'Generating overview waveform...' });
    }
    const tier1 = await generateTier(tempPcmPath, 1);
    if (onProgress) {
      onProgress({ tier: 1, percent: 100, status: 'Overview complete' });
    }
    tiers.push({ ...tier1, level: 1 });

    // Generate Tier 2 (Standard - 16:1)
    if (onProgress) {
      onProgress({ tier: 2, percent: 0, status: 'Generating standard waveform...' });
    }
    const tier2 = await generateTier(tempPcmPath, 2);
    if (onProgress) {
      onProgress({ tier: 2, percent: 100, status: 'Standard complete' });
    }
    tiers.push({ ...tier2, level: 2 });

    // Tier 3 is generated on-demand, not cached

    return {
      assetId,
      trackIndex,
      tiers,
    };
  } finally {
    // Cleanup temp file
    try {
      if (fs.existsSync(tempPcmPath)) {
        fs.unlinkSync(tempPcmPath);
      }
    } catch (error) {
      console.warn('[Waveform] Failed to cleanup temp file:', error);
    }
  }
}

/**
 * Generate a single tier of waveform data
 */
async function generateTier(
  pcmPath: string,
  tierLevel: 1 | 2 | 3
): Promise<{ peaks: WaveformPeak[]; sampleRate: number; duration: number }> {
  const tier = WAVEFORM_TIERS[tierLevel];
  const windowSize = tier.ratio;

  // Read PCM data (16-bit signed integers, mono)
  const buffer = fs.readFileSync(pcmPath);
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);

  // Calculate sample rate based on FFmpeg output (assuming 44.1kHz default)
  const sampleRate = 44100;
  const duration = samples.length / sampleRate;

  // Calculate peaks
  const peaks: WaveformPeak[] = [];

  for (let i = 0; i < samples.length; i += windowSize) {
    let min = 32767;
    let max = -32768;

    for (let j = 0; j < windowSize && i + j < samples.length; j++) {
      const sample = samples[i + j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    // Normalize to -1 to 1 range
    peaks.push({
      min: min / 32768,
      max: max / 32768,
    });
  }

  return { peaks, sampleRate, duration };
}

/**
 * Extract raw PCM audio from video/audio file
 */
async function extractPcmAudio(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  trackIndex: number = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '-i', inputPath,
      '-vn', // No video
      '-map', `0:a:${trackIndex}`,
      '-ar', '44100', // Sample rate
      '-ac', '1', // Mono
      '-f', 's16le', // 16-bit signed little-endian PCM
      '-acodec', 'pcm_s16le',
      '-y', outputPath,
    ];

    const proc = spawn(ffmpegPath, args);
    let errorOutput = '';

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      reject(new WaveformError(
        `Failed to extract audio: ${error.message}`,
        'EXTRACTION_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new WaveformError(
          `Audio extraction failed with code ${code}`,
          'EXTRACTION_ERROR',
          { code, error: errorOutput }
        ));
        return;
      }

      resolve();
    });
  });
}

/**
 * Generate Tier 3 (fine detail) on-demand
 * This is not cached and regenerated as needed
 */
export async function generateTier3OnDemand(
  audioPath: string,
  trackIndex: number = 0,
  startTime: number = 0,
  duration: number = 60 // Generate 60 seconds at a time
): Promise<WaveformPeak[]> {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new WaveformError('FFmpeg not found', 'FFMPEG_NOT_FOUND');
  }

  const tempDir = os.tmpdir();
  const tempPcmPath = path.join(tempDir, `waveform_tier3_${Date.now()}.pcm`);

  try {
    // Extract specific time range
    await extractPcmAudioSegment(ffmpegPath.path, audioPath, tempPcmPath, trackIndex, startTime, duration);

    // Generate Tier 3
    const result = await generateTier(tempPcmPath, 3);
    return result.peaks;
  } finally {
    try {
      if (fs.existsSync(tempPcmPath)) {
        fs.unlinkSync(tempPcmPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract specific segment of PCM audio
 */
async function extractPcmAudioSegment(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  trackIndex: number,
  startTime: number,
  duration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '-ss', startTime.toString(),
      '-t', duration.toString(),
      '-i', inputPath,
      '-vn',
      '-map', `0:a:${trackIndex}`,
      '-ar', '44100',
      '-ac', '1',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-y', outputPath,
    ];

    const proc = spawn(ffmpegPath, args);
    let errorOutput = '';

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      reject(new WaveformError(
        `Failed to extract audio segment: ${error.message}`,
        'EXTRACTION_ERROR',
        error
      ));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new WaveformError(
          `Audio segment extraction failed with code ${code}`,
          'EXTRACTION_ERROR',
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
  if (zoomLevel < 100) return 1;
  if (zoomLevel < 200) return 2;
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
