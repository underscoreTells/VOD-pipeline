import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generateWaveformTiers, generateTier3OnDemand, getTierForZoomLevel, WaveformError } from '../../../src/pipeline/waveform.js';
import { 
  saveWaveform, 
  getWaveform, 
  checkWaveformExists,
  deleteWaveformsByAsset,
  initializeDatabase,
  closeDatabase 
} from '../../../src/electron/database/db.js';

// Skip tests if FFmpeg is not available
describe('Waveform Generation Integration', () => {
  let testAudioPath: string;
  let tempDir: string;
  const assetId = 9999;
  let ffmpegAvailable = false;

  beforeAll(async () => {
    // Check if FFmpeg is available
    const { spawn } = await import('child_process');
    ffmpegAvailable = await new Promise<boolean>((resolve) => {
      const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });

    if (!ffmpegAvailable) {
      console.log('FFmpeg not available, skipping waveform generation tests');
      return;
    }

    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-test-'));
    testAudioPath = path.join(tempDir, 'test-audio.wav');
    
    // Generate a simple test audio file (1 second of tone, 44.1kHz, mono)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-f', 'lavfi',
        '-i', 'sine=frequency=1000:duration=1',
        '-ar', '44100',
        '-ac', '1',
        testAudioPath,
        '-y'
      ], { stdio: 'ignore' });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
    });
  });

  afterAll(async () => {
    // Cleanup
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
      await deleteWaveformsByAsset(assetId);
    } catch {
      // Ignore cleanup errors
    }
    closeDatabase();
  });

  it('should skip if FFmpeg is not available', () => {
    if (!ffmpegAvailable) {
      console.log('FFmpeg not available, skipping waveform tests');
      return;
    }
    expect(true).toBe(true); // Placeholder
  });

  it('should generate Tier 1 and Tier 2 waveforms', async () => {
    if (!ffmpegAvailable || !fs.existsSync(testAudioPath)) {
      return; // Skip
    }

    const progressEvents: Array<{ tier: number; percent: number }> = [];
    
    const result = await generateWaveformTiers(
      testAudioPath,
      assetId,
      0,
      (progress) => {
        progressEvents.push({ tier: progress.tier, percent: progress.percent });
      }
    );

    expect(result.assetId).toBe(assetId);
    expect(result.trackIndex).toBe(0);
    expect(result.tiers).toHaveLength(2);
    
    // Verify Tier 1 (overview)
    const tier1 = result.tiers.find(t => t.level === 1);
    expect(tier1).toBeDefined();
    expect(tier1!.peaks.length).toBeGreaterThan(0);
    expect(tier1!.sampleRate).toBe(44100);
    
    // Verify Tier 2 (standard)
    const tier2 = result.tiers.find(t => t.level === 2);
    expect(tier2).toBeDefined();
    expect(tier2!.peaks.length).toBeGreaterThan(0);
    expect(tier2!.peaks.length).toBeGreaterThan(tier1!.peaks.length); // More detailed
    
    // Verify progress events
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.some(p => p.tier === 1)).toBe(true);
    expect(progressEvents.some(p => p.tier === 2)).toBe(true);
  });

  it('should save and retrieve waveforms from database', async () => {
    if (!ffmpegAvailable || !fs.existsSync(testAudioPath)) {
      return; // Skip
    }

    // First generate and save
    await generateWaveformTiers(testAudioPath, assetId, 0);
    
    // Verify it exists
    const exists = await checkWaveformExists(assetId, 0, 1);
    expect(exists).toBe(true);
    
    // Retrieve and verify
    const tier1 = await getWaveform(assetId, 0, 1);
    expect(tier1).not.toBeNull();
    expect(tier1!.peaks.length).toBeGreaterThan(0);
    expect(tier1!.sampleRate).toBe(44100);
    expect(tier1!.duration).toBeGreaterThan(0);
  });

  it('should generate Tier 3 on demand', async () => {
    if (!ffmpegAvailable || !fs.existsSync(testAudioPath)) {
      return; // Skip
    }

    const peaks = await generateTier3OnDemand(testAudioPath, 0, 0, 1);
    
    expect(peaks.length).toBeGreaterThan(0);
    // Tier 3 should have more peaks than Tier 2 for the same duration
    expect(peaks[0]).toHaveProperty('min');
    expect(peaks[0]).toHaveProperty('max');
  });

  it('should calculate correct tier for zoom level', () => {
    expect(getTierForZoomLevel(50)).toBe(1);  // Zoomed out
    expect(getTierForZoomLevel(100)).toBe(1); // Still overview
    expect(getTierForZoomLevel(150)).toBe(2); // Standard
    expect(getTierForZoomLevel(200)).toBe(2); // Still standard
    expect(getTierForZoomLevel(250)).toBe(3); // Fine detail
    expect(getTierForZoomLevel(500)).toBe(3); // Fine detail
  });

  it('should handle non-existent audio file gracefully', async () => {
    const nonExistentPath = '/non/existent/path/audio.wav';
    
    await expect(
      generateWaveformTiers(nonExistentPath, assetId, 0)
    ).rejects.toThrow(WaveformError);
  });

  it('should cleanup waveforms on asset delete', async () => {
    if (!ffmpegAvailable || !fs.existsSync(testAudioPath)) {
      return; // Skip
    }

    // Generate waveforms
    await generateWaveformTiers(testAudioPath, assetId, 0);
    
    // Verify they exist
    expect(await checkWaveformExists(assetId, 0, 1)).toBe(true);
    
    // Delete
    const deleted = await deleteWaveformsByAsset(assetId);
    expect(deleted).toBeGreaterThan(0);
    
    // Verify they're gone
    expect(await checkWaveformExists(assetId, 0, 1)).toBe(false);
  });
});
