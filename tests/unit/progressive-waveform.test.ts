import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PROGRESSIVE_WAVEFORM_CACHE_VERSION,
  DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
  WAVEFORM_BLOCK_DURATION_SECONDS,
  WAVEFORM_PCM_SAMPLE_RATE,
  createWaveformSourceFingerprint,
  decodeWaveformBlock,
  encodeWaveformBlock,
  getVisibleWaveformBlockIndexes,
  getWaveformBlockCachePath,
  reducePcmS16leChunks,
  requestProgressiveWaveformBlocks,
  writeWaveformBlockAtomic,
} from '../../src/pipeline/progressive-waveform.js';

describe('progressive waveform blocks', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progressive-waveform-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('selects only fixed-duration blocks intersecting the visible range', () => {
    expect(getVisibleWaveformBlockIndexes(0, 1)).toEqual([0]);
    expect(getVisibleWaveformBlockIndexes(299.5, 300.5)).toEqual([0, 1]);
    expect(getVisibleWaveformBlockIndexes(600, 900)).toEqual([2]);
  });

  it('reduces streamed PCM across odd chunk boundaries into compact int8 min/max pairs', () => {
    const pcm = Buffer.alloc(12);
    [-1000, 2000, -3000, 4000, -5000, 6000].forEach((sample, index) => {
      pcm.writeInt16LE(sample, index * 2);
    });

    const result = reducePcmS16leChunks(
      [pcm.subarray(0, 3), pcm.subarray(3, 7), pcm.subarray(7)],
      6,
      2
    );

    expect(Array.from(result.peaks)).toEqual([-12, 8, -20, 23]);
    expect(result.duration).toBe(1);
  });

  it('round-trips compact binary blocks and rejects mismatched metadata', () => {
    const metadata = {
      index: 3,
      trackIndex: -1,
      startTime: WAVEFORM_BLOCK_DURATION_SECONDS * 3,
      duration: WAVEFORM_BLOCK_DURATION_SECONDS,
      pixelsPerSecond: DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
      sampleRate: WAVEFORM_PCM_SAMPLE_RATE,
    };
    const peaks = Int8Array.from([-128, 127, -12, 42]);
    const encoded = encodeWaveformBlock(metadata, peaks);
    const decoded = decodeWaveformBlock(encoded, metadata);

    expect(encoded.byteLength).toBe(40 + peaks.byteLength);
    expect(decoded.metadata).toEqual(metadata);
    expect(Array.from(decoded.peaks)).toEqual(Array.from(peaks));
    expect(() => decodeWaveformBlock(encoded, { index: 4 })).toThrow(/metadata mismatch/);
  });

  it('fingerprints source identity and stores versioned blocks atomically', async () => {
    const sourcePath = path.join(tempDir, 'source.mp4');
    fs.writeFileSync(sourcePath, 'source-a');
    const firstFingerprint = await createWaveformSourceFingerprint(sourcePath);
    fs.writeFileSync(sourcePath, 'source-b-with-a-different-size');
    const secondFingerprint = await createWaveformSourceFingerprint(sourcePath);
    expect(secondFingerprint).not.toBe(firstFingerprint);

    const cachePath = getWaveformBlockCachePath(tempDir, secondFingerprint, -1, DEFAULT_WAVEFORM_PIXELS_PER_SECOND, 2);
    const encoded = encodeWaveformBlock({
      index: 2,
      trackIndex: -1,
      startTime: WAVEFORM_BLOCK_DURATION_SECONDS * 2,
      duration: WAVEFORM_BLOCK_DURATION_SECONDS,
      pixelsPerSecond: DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
      sampleRate: WAVEFORM_PCM_SAMPLE_RATE,
    }, Int8Array.from([-1, 1]));
    await writeWaveformBlockAtomic(cachePath, encoded);

    expect(fs.existsSync(cachePath)).toBe(true);
    expect(cachePath).toContain(`${path.sep}v${PROGRESSIVE_WAVEFORM_CACHE_VERSION}${path.sep}`);
    expect(fs.readdirSync(path.dirname(cachePath)).filter((name) => name.includes('.partial-'))).toEqual([]);
  });

  it('serves a visible cached block without starting FFmpeg', async () => {
    const sourcePath = path.join(tempDir, 'cached-source.mp4');
    fs.writeFileSync(sourcePath, 'source');
    const fingerprint = await createWaveformSourceFingerprint(sourcePath);
    const cachePath = getWaveformBlockCachePath(tempDir, fingerprint, -1, DEFAULT_WAVEFORM_PIXELS_PER_SECOND, 2);
    await writeWaveformBlockAtomic(cachePath, encodeWaveformBlock({
      index: 2,
      trackIndex: -1,
      startTime: WAVEFORM_BLOCK_DURATION_SECONDS * 2,
      duration: WAVEFORM_BLOCK_DURATION_SECONDS,
      pixelsPerSecond: DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
      sampleRate: WAVEFORM_PCM_SAMPLE_RATE,
    }, Int8Array.from([-100, 100])));
    const statuses: string[] = [];

    const result = await requestProgressiveWaveformBlocks({
      sourcePath,
      sourceDuration: WAVEFORM_BLOCK_DURATION_SECONDS * 4,
      cacheRoot: tempDir,
      trackIndex: -1,
      startTime: WAVEFORM_BLOCK_DURATION_SECONDS * 2 + 1,
      endTime: WAVEFORM_BLOCK_DURATION_SECONDS * 3 - 1,
      pixelsPerSecond: DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
      ffmpegPath: '/must/not/run/ffmpeg',
      ffprobePath: '/must/not/run/ffprobe',
      onProgress: (progress) => statuses.push(progress.status),
    });

    expect(result.blocks).toHaveLength(1);
    expect(Array.from(result.blocks[0].peaks)).toEqual([-100, 100]);
    expect(statuses).toEqual(['cached']);
  });
});
