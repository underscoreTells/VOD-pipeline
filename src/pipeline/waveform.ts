import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getFFmpegPath } from '../electron/ffmpegDetector.js';
import { saveWaveform } from '../electron/database/db.js';
import type {
  WaveformPeak,
  WaveformTier,
  WaveformProgress,
  WaveformProgressCallback,
  WaveformGenerationResult,
} from '../shared/types/pipeline.js';
import { WAVEFORM_TIERS } from '../shared/types/pipeline.js';

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

    const result = {
      assetId,
      trackIndex,
      tiers,
    };

    // Save generated waveforms to database
    for (const tier of tiers) {
      await saveWaveform(assetId, trackIndex, tier.level, tier.peaks, tier.sampleRate, tier.duration);
    }

    return result;
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
 * Stream PCM data and calculate waveform peaks
 * Processes data incrementally without loading entire file into memory
 */
async function streamPcmPeaks(
  pcmPath: string,
  windowSize: number
): Promise<{ peaks: WaveformPeak[]; sampleCount: number }> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(pcmPath);
    const peaks: WaveformPeak[] = [];

    // Buffer to accumulate bytes across chunk boundaries
    let byteBuffer = Buffer.alloc(0);
    let sampleCount = 0;
    let windowMin = 32767;
    let windowMax = -32768;
    let windowSampleCount = 0;

    stream.on('data', (chunk: Buffer) => {
      // Append new chunk to buffer
      byteBuffer = Buffer.concat([byteBuffer, chunk]);

      // Process complete 16-bit samples (2 bytes each)
      const samplesToProcess = Math.floor(byteBuffer.length / 2);

      for (let i = 0; i < samplesToProcess; i++) {
        // Read 16-bit signed integer (little-endian)
        const sample = byteBuffer.readInt16LE(i * 2);
        sampleCount++;

        // Update window min/max
        if (sample < windowMin) windowMin = sample;
        if (sample > windowMax) windowMax = sample;
        windowSampleCount++;

        // When window is full, save peak and reset
        if (windowSampleCount >= windowSize) {
          peaks.push({
            min: windowMin / 32768,
            max: windowMax / 32768,
          });
          windowMin = 32767;
          windowMax = -32768;
          windowSampleCount = 0;
        }
      }

      // Keep remaining bytes (incomplete sample) for next chunk
      const remainingBytes = byteBuffer.length % 2;
      if (remainingBytes > 0) {
        byteBuffer = byteBuffer.subarray(byteBuffer.length - remainingBytes);
      } else {
        byteBuffer = Buffer.alloc(0);
      }
    });

    stream.on('end', () => {
      // Process any remaining samples in the buffer
      const samplesToProcess = Math.floor(byteBuffer.length / 2);
      for (let i = 0; i < samplesToProcess; i++) {
        const sample = byteBuffer.readInt16LE(i * 2);
        sampleCount++;

        if (sample < windowMin) windowMin = sample;
        if (sample > windowMax) windowMax = sample;
        windowSampleCount++;
      }

      // Save final partial window if any
      if (windowSampleCount > 0) {
        peaks.push({
          min: windowMin / 32768,
          max: windowMax / 32768,
        });
      }

      resolve({ peaks, sampleCount });
    });

    stream.on('error', (error) => {
      reject(new WaveformError(
        `Failed to stream PCM data: ${error.message}`,
        'STREAM_ERROR',
        error
      ));
    });
  });
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

  // Calculate sample rate based on FFmpeg output (assuming 44.1kHz default)
  const sampleRate = 44100;

  try {
    // Stream PCM data and calculate peaks
    const { peaks, sampleCount } = await streamPcmPeaks(pcmPath, windowSize);
    const duration = sampleCount / sampleRate;

    return { peaks, sampleRate, duration };
  } catch (error) {
    throw new WaveformError(
      `Failed to generate tier ${tierLevel}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'TIER_GENERATION_ERROR',
      error
    );
  }
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
