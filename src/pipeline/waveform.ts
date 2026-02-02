import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getAudiowaveformPath } from '../electron/audiowaveformDetector.js';
import { getFFmpegPath } from '../electron/ffmpegDetector.js';
import { saveWaveform } from '../electron/database/db.js';
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

/**
 * Generate all waveform tiers for an audio file using audiowaveform
 * Falls back gracefully if audiowaveform is not available
 */
export async function generateWaveformTiers(
  audioPath: string,
  assetId: number,
  trackIndex: number = 0,
  onProgress?: WaveformProgressCallback
): Promise<WaveformGenerationResult | null> {
  const audiowaveformPath = getAudiowaveformPath();
  
  if (!audiowaveformPath) {
    console.warn('[Waveform] audiowaveform not found. Waveform generation disabled.');
    console.warn('[Waveform] Install audiowaveform for waveform visualization.');
    return null;
  }

  const tempDir = os.tmpdir();
  const tiers: WaveformGenerationResult['tiers'] = [];
  let waveformInputPath: string = audioPath;
  let tempAudioPath: string | null = null;

  try {
    if (onProgress) {
      onProgress({ tier: 1, percent: 0, status: 'Preparing audio for waveform...' });
    }

    const preparedInput = await prepareWaveformInput(audioPath, tempDir);
    waveformInputPath = preparedInput.path;
    tempAudioPath = preparedInput.tempPath;

    if (onProgress) {
      onProgress({ tier: 1, percent: 10, status: 'Audio preparation complete' });
    }

    // Generate Tier 1 (Overview - 256:1 zoom)
    if (onProgress) {
      onProgress({ tier: 1, percent: 20, status: 'Generating overview waveform...' });
    }
    
    const tier1Result = await generateTierWithAudiowaveform(
      audiowaveformPath.path,
      waveformInputPath,
      tempDir,
      1,
      256,
      8
    );
    
    if (tier1Result) {
      if (onProgress) {
        onProgress({ tier: 1, percent: 60, status: 'Overview complete' });
      }
      tiers.push({ level: 1, ...tier1Result });
      
      // Save to database
      await saveWaveform(assetId, trackIndex, 1, tier1Result.peaks, tier1Result.sampleRate, tier1Result.duration);
    }

    // Generate Tier 2 (Standard - 16:1 zoom)
    if (onProgress) {
      onProgress({ tier: 2, percent: 70, status: 'Generating standard waveform...' });
    }
    
    const tier2Result = await generateTierWithAudiowaveform(
      audiowaveformPath.path,
      waveformInputPath,
      tempDir,
      2,
      16,
      16
    );
    
    if (tier2Result) {
      if (onProgress) {
        onProgress({ tier: 2, percent: 100, status: 'Standard complete' });
      }
      tiers.push({ level: 2, ...tier2Result });
      
      // Save to database
      await saveWaveform(assetId, trackIndex, 2, tier2Result.peaks, tier2Result.sampleRate, tier2Result.duration);
    }

    // Tier 3 is generated on-demand, not cached

    return {
      assetId,
      trackIndex,
      tiers,
    };
  } catch (error) {
    console.error('[Waveform] Generation failed:', error);
    
    // Return partial results if we have any
    if (tiers.length > 0) {
      console.warn('[Waveform] Returning partial results');
      return {
        assetId,
        trackIndex,
        tiers,
      };
    }
    
    return null;
  } finally {
    if (tempAudioPath) {
      try {
        if (fs.existsSync(tempAudioPath)) {
          fs.unlinkSync(tempAudioPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

async function prepareWaveformInput(
  inputPath: string,
  tempDir: string
): Promise<{ path: string; tempPath: string | null }> {
  const extension = path.extname(inputPath).toLowerCase();
  const supportedExtensions = new Set([
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

  if (supportedExtensions.has(extension)) {
    return { path: inputPath, tempPath: null };
  }

  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new WaveformError('FFmpeg not found for waveform generation', 'GENERATION_ERROR');
  }

  const tempWavPath = path.join(tempDir, `waveform_${Date.now()}.wav`);
  await transcodeToWaveformAudio(ffmpegPath.path, inputPath, tempWavPath);

  return { path: tempWavPath, tempPath: tempWavPath };
}

async function transcodeToWaveformAudio(
  ffmpegBinaryPath: string,
  inputPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '11025',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      outputPath,
    ];

    const proc = spawn(ffmpegBinaryPath, args);
    let errorOutput = '';

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

      resolve();
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
  const tempJsonPath = path.join(tempDir, `waveform_${Date.now()}_tier${tierLevel}.json`);

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
): Promise<WaveformPeak[] | null> {
  const audiowaveformPath = getAudiowaveformPath();
  
  if (!audiowaveformPath) {
    console.warn('[Waveform] audiowaveform not found. Cannot generate fine detail waveform.');
    return null;
  }

  const tempDir = os.tmpdir();
  const tempJsonPath = path.join(tempDir, `waveform_tier3_${Date.now()}.json`);

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
    return null;
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

/**
 * Check if waveform generation is available
 */
export function isWaveformGenerationAvailable(): boolean {
  return getAudiowaveformPath() !== null;
}
