import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import type { AudiowaveformPathResult } from '../electron/audiowaveformDetector.js';
import type { WaveformBlock, WaveformBlockStatus } from '../shared/contracts/electron-api.js';
import {
  DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
  getWaveformBlockIndexes,
  STANDARD_WAVEFORM_PIXELS_PER_SECOND,
  WAVEFORM_BLOCK_DURATION_SECONDS,
} from '../shared/utils/waveform-blocks.js';

export const PROGRESSIVE_WAVEFORM_CACHE_VERSION = 2;
export { DEFAULT_WAVEFORM_PIXELS_PER_SECOND, WAVEFORM_BLOCK_DURATION_SECONDS };
export const WAVEFORM_PCM_SAMPLE_RATE = 11_025;

const CACHE_MAGIC = Buffer.from('VWF2', 'ascii');
const CACHE_HEADER_BYTES = 40;
const blockGenerationInFlight = new Map<string, Promise<GeneratedWaveformBlock>>();

export interface ProgressiveWaveformProgress {
  blockIndex: number;
  completedBlocks: number;
  totalBlocks: number;
  percent: number;
  status: WaveformBlockStatus;
  backend?: 'audiowaveform' | 'typescript';
  message?: string;
}

export interface ProgressiveWaveformRequest {
  sourcePath: string;
  cacheRoot: string;
  trackIndex: number;
  startTime: number;
  endTime: number;
  pixelsPerSecond?: number;
  sourceDuration?: number | null;
  ffmpegPath: string;
  ffprobePath: string;
  audiowaveform?: AudiowaveformPathResult | null;
  onProgress?: (progress: ProgressiveWaveformProgress) => void;
  scheduleBlock?: <T>(key: string, run: (signal: AbortSignal) => Promise<T>) => Promise<T>;
}

export interface ProgressiveWaveformResult {
  sourceFingerprint: string;
  cacheVersion: number;
  blockDuration: number;
  pixelsPerSecond: number;
  blocks: WaveformBlock[];
}

interface GeneratedWaveformBlock {
  duration: number;
  peaks: Int8Array;
  backend: 'audiowaveform' | 'typescript';
}

interface CachedWaveformBlockMetadata {
  index: number;
  trackIndex: number;
  startTime: number;
  duration: number;
  pixelsPerSecond: number;
  sampleRate: number;
}

export async function createWaveformSourceFingerprint(sourcePath: string): Promise<string> {
  const stats = await fs.promises.stat(sourcePath);
  const identity = [
    path.resolve(sourcePath),
    stats.size.toString(),
    stats.mtimeMs.toString(),
  ].join('\0');
  return createHash('sha256').update(identity).digest('hex').slice(0, 32);
}

export function getVisibleWaveformBlockIndexes(
  startTime: number,
  endTime: number,
  blockDuration = WAVEFORM_BLOCK_DURATION_SECONDS
): number[] {
  return getWaveformBlockIndexes(startTime, endTime, blockDuration);
}

export function reducePcmS16leChunks(
  chunks: Iterable<Uint8Array>,
  sampleRate: number,
  pixelsPerSecond: number
): { peaks: Int8Array; duration: number } {
  const reducer = createPcmS16leReducer(sampleRate, pixelsPerSecond);
  for (const chunk of chunks) reducer.push(chunk);
  return reducer.finish();
}

export function downsampleWaveformPeaks(
  source: Int8Array,
  sourcePixelsPerSecond: number,
  targetPixelsPerSecond: number
): Int8Array {
  if (source.length % 2 !== 0) throw new Error('Waveform peak data must contain min/max pairs');
  if (!Number.isFinite(sourcePixelsPerSecond) || sourcePixelsPerSecond <= 0) {
    throw new Error('Source waveform resolution must be positive');
  }
  if (!Number.isFinite(targetPixelsPerSecond) || targetPixelsPerSecond <= 0) {
    throw new Error('Target waveform resolution must be positive');
  }
  if (targetPixelsPerSecond >= sourcePixelsPerSecond || source.length === 0) {
    return new Int8Array(source);
  }

  const sourcePairCount = source.length / 2;
  const targetPairCount = Math.max(
    1,
    Math.ceil(sourcePairCount * targetPixelsPerSecond / sourcePixelsPerSecond)
  );
  const output = new Int8Array(targetPairCount * 2);
  for (let targetIndex = 0; targetIndex < targetPairCount; targetIndex += 1) {
    const sourceStart = Math.floor(targetIndex * sourcePixelsPerSecond / targetPixelsPerSecond);
    const sourceEnd = Math.min(
      sourcePairCount,
      Math.max(sourceStart + 1, Math.ceil((targetIndex + 1) * sourcePixelsPerSecond / targetPixelsPerSecond))
    );
    let minimum = 127;
    let maximum = -128;
    for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex += 1) {
      minimum = Math.min(minimum, source[sourceIndex * 2]);
      maximum = Math.max(maximum, source[sourceIndex * 2 + 1]);
    }
    output[targetIndex * 2] = minimum;
    output[targetIndex * 2 + 1] = maximum;
  }
  return output;
}

function createPcmS16leReducer(sampleRate: number, pixelsPerSecond: number): {
  push: (chunk: Uint8Array) => void;
  finish: () => { peaks: Int8Array; duration: number };
} {
  const peaks: number[] = [];
  let pendingByte: number | null = null;
  let sampleIndex = 0;
  let currentPixel = -1;
  let minimum = 32_767;
  let maximum = -32_768;

  const addSample = (sample: number): void => {
    const pixel = Math.floor((sampleIndex * pixelsPerSecond) / sampleRate);
    if (currentPixel !== -1 && pixel !== currentPixel) {
      peaks.push(minimum, maximum);
      minimum = 32_767;
      maximum = -32_768;
    }
    currentPixel = pixel;
    minimum = Math.min(minimum, sample);
    maximum = Math.max(maximum, sample);
    sampleIndex += 1;
  };

  const push = (chunk: Uint8Array): void => {
    let offset = 0;
    if (pendingByte !== null && chunk.length > 0) {
      addSample((pendingByte | (chunk[0] << 8)) << 16 >> 16);
      pendingByte = null;
      offset = 1;
    }
    const view = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (; offset + 1 < view.length; offset += 2) {
      addSample(view.readInt16LE(offset));
    }
    if (offset < view.length) pendingByte = view[offset];
  };

  return {
    push,
    finish: () => {
      if (currentPixel !== -1) peaks.push(minimum, maximum);
      return {
        peaks: Int8Array.from(peaks, (sample) => Math.max(-128, Math.min(127, Math.round(sample / 256)))),
        duration: sampleIndex / sampleRate,
      };
    },
  };
}

export function encodeWaveformBlock(
  metadata: CachedWaveformBlockMetadata,
  peaks: Int8Array
): Buffer {
  if (peaks.length % 2 !== 0) throw new Error('Waveform peak data must contain min/max pairs');
  const output = Buffer.allocUnsafe(CACHE_HEADER_BYTES + peaks.byteLength);
  CACHE_MAGIC.copy(output, 0);
  output.writeUInt16LE(PROGRESSIVE_WAVEFORM_CACHE_VERSION, 4);
  output.writeUInt16LE(CACHE_HEADER_BYTES, 6);
  output.writeUInt32LE(metadata.index, 8);
  output.writeInt32LE(metadata.trackIndex, 12);
  output.writeUInt32LE(metadata.pixelsPerSecond, 16);
  output.writeUInt32LE(metadata.sampleRate, 20);
  output.writeDoubleLE(metadata.startTime, 24);
  output.writeFloatLE(metadata.duration, 32);
  output.writeUInt32LE(peaks.length / 2, 36);
  Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength).copy(output, CACHE_HEADER_BYTES);
  return output;
}

export function decodeWaveformBlock(
  input: Uint8Array,
  expected?: Partial<CachedWaveformBlockMetadata>
): { metadata: CachedWaveformBlockMetadata; peaks: Int8Array } {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length < CACHE_HEADER_BYTES || !buffer.subarray(0, 4).equals(CACHE_MAGIC)) {
    throw new Error('Invalid waveform block cache header');
  }
  const version = buffer.readUInt16LE(4);
  const headerBytes = buffer.readUInt16LE(6);
  const peakCount = buffer.readUInt32LE(36);
  if (version !== PROGRESSIVE_WAVEFORM_CACHE_VERSION || headerBytes !== CACHE_HEADER_BYTES) {
    throw new Error(`Unsupported waveform block cache version: ${version}`);
  }
  if (buffer.length !== CACHE_HEADER_BYTES + (peakCount * 2)) {
    throw new Error('Truncated waveform block cache data');
  }
  const metadata: CachedWaveformBlockMetadata = {
    index: buffer.readUInt32LE(8),
    trackIndex: buffer.readInt32LE(12),
    pixelsPerSecond: buffer.readUInt32LE(16),
    sampleRate: buffer.readUInt32LE(20),
    startTime: buffer.readDoubleLE(24),
    duration: buffer.readFloatLE(32),
  };
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (value !== undefined && metadata[key as keyof CachedWaveformBlockMetadata] !== value) {
      throw new Error(`Waveform block metadata mismatch: ${key}`);
    }
  }
  const peaks = new Int8Array(peakCount * 2);
  for (let index = 0; index < peaks.length; index += 1) {
    peaks[index] = buffer.readInt8(CACHE_HEADER_BYTES + index);
  }
  return { metadata, peaks };
}

export async function writeWaveformBlockAtomic(filePath: string, data: Uint8Array): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.partial-${process.pid}-${randomUUID()}`;
  try {
    await fs.promises.writeFile(temporaryPath, data, { flag: 'wx' });
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function getWaveformBlockCachePath(
  cacheRoot: string,
  sourceFingerprint: string,
  trackIndex: number,
  pixelsPerSecond: number,
  blockIndex: number
): string {
  return path.join(
    cacheRoot,
    `v${PROGRESSIVE_WAVEFORM_CACHE_VERSION}`,
    sourceFingerprint,
    `track-${trackIndex}`,
    `pps-${pixelsPerSecond}`,
    `${blockIndex.toString().padStart(8, '0')}.vwf`
  );
}

export async function requestProgressiveWaveformBlocks(
  request: ProgressiveWaveformRequest
): Promise<ProgressiveWaveformResult> {
  const pixelsPerSecond = request.pixelsPerSecond ?? DEFAULT_WAVEFORM_PIXELS_PER_SECOND;
  const sourceFingerprint = await createWaveformSourceFingerprint(request.sourcePath);
  const boundedEnd = request.sourceDuration && request.sourceDuration > 0
    ? Math.min(request.endTime, request.sourceDuration)
    : request.endTime;
  const indexes = getVisibleWaveformBlockIndexes(request.startTime, boundedEnd);
  let completedBlocks = 0;

  const report = (
    blockIndex: number,
    status: WaveformBlockStatus,
    backend?: 'audiowaveform' | 'typescript',
    message?: string
  ): void => {
    request.onProgress?.({
      blockIndex,
      completedBlocks,
      totalBlocks: indexes.length,
      percent: Math.round((completedBlocks / indexes.length) * 100),
      status,
      backend,
      message,
    });
  };

  const blocks = await Promise.all(indexes.map(async (blockIndex): Promise<WaveformBlock> => {
    const startTime = blockIndex * WAVEFORM_BLOCK_DURATION_SECONDS;
    const expectedDuration = request.sourceDuration && request.sourceDuration > 0
      ? Math.min(WAVEFORM_BLOCK_DURATION_SECONDS, request.sourceDuration - startTime)
      : WAVEFORM_BLOCK_DURATION_SECONDS;
    const cachePath = getWaveformBlockCachePath(
      request.cacheRoot,
      sourceFingerprint,
      request.trackIndex,
      pixelsPerSecond,
      blockIndex
    );
    const expected = {
      index: blockIndex,
      trackIndex: request.trackIndex,
      startTime,
      pixelsPerSecond,
      sampleRate: WAVEFORM_PCM_SAMPLE_RATE,
    };
    const cached = await readCachedBlock(cachePath, expected);
    if (cached) {
      completedBlocks += 1;
      report(blockIndex, 'cached');
      return toPublicBlock(cached.metadata, cached.peaks);
    }

    report(blockIndex, 'queued');
    const generationPixelsPerSecond = Math.max(
      pixelsPerSecond,
      STANDARD_WAVEFORM_PIXELS_PER_SECOND
    );
    const generationCachePath = getWaveformBlockCachePath(
      request.cacheRoot,
      sourceFingerprint,
      request.trackIndex,
      generationPixelsPerSecond,
      blockIndex
    );
    const generationMetadata = {
      ...expected,
      pixelsPerSecond: generationPixelsPerSecond,
      duration: expectedDuration,
    };
    const generationKey = `waveform:${sourceFingerprint}:${request.trackIndex}:${generationPixelsPerSecond}:${blockIndex}`;
    const run = (signal: AbortSignal) => generateAndCacheBlock({
      sourcePath: request.sourcePath,
      cachePath: generationCachePath,
      metadata: generationMetadata,
      duration: expectedDuration,
      ffmpegPath: request.ffmpegPath,
      ffprobePath: request.ffprobePath,
      audiowaveform: request.audiowaveform,
      signal,
      onBackend: (status, backend, message) => report(blockIndex, status, backend, message),
    });
    try {
      const generated = request.scheduleBlock
        ? await request.scheduleBlock(generationKey, run)
        : await runDeduplicated(generationKey, run);
      const targetPeaks = generationPixelsPerSecond === pixelsPerSecond
        ? generated.peaks
        : downsampleWaveformPeaks(
            generated.peaks,
            generationPixelsPerSecond,
            pixelsPerSecond
          );
      const targetMetadata = { ...expected, duration: generated.duration };
      if (generationPixelsPerSecond !== pixelsPerSecond) {
        const existingTarget = await readCachedBlock(cachePath, expected);
        if (!existingTarget) {
          try {
            await writeWaveformBlockAtomic(
              cachePath,
              encodeWaveformBlock(targetMetadata, targetPeaks)
            );
          } catch (error) {
            // A renderer request and background prewarm may derive the same
            // tier together. Treat the winning atomic write as success.
            if (!(await readCachedBlock(cachePath, expected))) throw error;
          }
        }
      }
      completedBlocks += 1;
      report(blockIndex, 'ready', generated.backend);
      return toPublicBlock(
        targetMetadata,
        targetPeaks
      );
    } catch (error) {
      report(blockIndex, 'error', undefined, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }));

  return {
    sourceFingerprint,
    cacheVersion: PROGRESSIVE_WAVEFORM_CACHE_VERSION,
    blockDuration: WAVEFORM_BLOCK_DURATION_SECONDS,
    pixelsPerSecond,
    blocks,
  };
}

function toPublicBlock(metadata: CachedWaveformBlockMetadata, peaks: Int8Array): WaveformBlock {
  return {
    index: metadata.index,
    startTime: metadata.startTime,
    duration: metadata.duration,
    pixelsPerSecond: metadata.pixelsPerSecond,
    peakCount: peaks.length / 2,
    encoding: 'int8-min-max',
    peaks,
  };
}

async function readCachedBlock(
  cachePath: string,
  expected: Partial<CachedWaveformBlockMetadata>
): Promise<{ metadata: CachedWaveformBlockMetadata; peaks: Int8Array } | null> {
  try {
    return decodeWaveformBlock(await fs.promises.readFile(cachePath), expected);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await fs.promises.rm(cachePath, { force: true }).catch(() => undefined);
    }
    return null;
  }
}

async function runDeduplicated(
  key: string,
  run: (signal: AbortSignal) => Promise<GeneratedWaveformBlock>
): Promise<GeneratedWaveformBlock> {
  const existing = blockGenerationInFlight.get(key);
  if (existing) return existing;
  const generation = run(new AbortController().signal);
  blockGenerationInFlight.set(key, generation);
  try {
    return await generation;
  } finally {
    if (blockGenerationInFlight.get(key) === generation) blockGenerationInFlight.delete(key);
  }
}

async function generateAndCacheBlock(options: {
  sourcePath: string;
  cachePath: string;
  metadata: CachedWaveformBlockMetadata;
  duration: number;
  ffmpegPath: string;
  ffprobePath: string;
  audiowaveform?: AudiowaveformPathResult | null;
  signal: AbortSignal;
  onBackend: (
    status: Extract<WaveformBlockStatus, 'generating' | 'fallback'>,
    backend: 'audiowaveform' | 'typescript',
    message?: string
  ) => void;
}): Promise<GeneratedWaveformBlock> {
  const cacheIdentity = {
    index: options.metadata.index,
    trackIndex: options.metadata.trackIndex,
    startTime: options.metadata.startTime,
    pixelsPerSecond: options.metadata.pixelsPerSecond,
    sampleRate: options.metadata.sampleRate,
  };
  const existing = await readCachedBlock(options.cachePath, cacheIdentity);
  if (existing) {
    return { duration: existing.metadata.duration, peaks: existing.peaks, backend: 'typescript' };
  }

  let generated: GeneratedWaveformBlock;
  if (options.audiowaveform) {
    options.onBackend('generating', 'audiowaveform');
    try {
      generated = await generateWithAudiowaveform(options);
    } catch (error) {
      if (options.signal.aborted) throw new Error('Waveform block generation cancelled');
      options.onBackend(
        'fallback',
        'typescript',
        `audiowaveform unavailable for streamed input: ${error instanceof Error ? error.message : String(error)}`
      );
      generated = await generateWithTypescript(options);
    }
  } else {
    options.onBackend('generating', 'typescript');
    generated = await generateWithTypescript(options);
  }

  const metadata = { ...options.metadata, duration: generated.duration };
  await writeWaveformBlockAtomic(options.cachePath, encodeWaveformBlock(metadata, generated.peaks));
  return generated;
}

async function generateWithTypescript(options: {
  sourcePath: string;
  duration: number;
  metadata: CachedWaveformBlockMetadata;
  ffmpegPath: string;
  ffprobePath: string;
  signal: AbortSignal;
}): Promise<GeneratedWaveformBlock> {
  const reducer = createPcmS16leReducer(
    WAVEFORM_PCM_SAMPLE_RATE,
    options.metadata.pixelsPerSecond
  );
  await consumeFfmpegPcm(options, reducer.push);
  const reduced = reducer.finish();
  return { ...reduced, backend: 'typescript' };
}

async function generateWithAudiowaveform(options: {
  sourcePath: string;
  duration: number;
  metadata: CachedWaveformBlockMetadata;
  ffmpegPath: string;
  ffprobePath: string;
  audiowaveform?: AudiowaveformPathResult | null;
  signal: AbortSignal;
}): Promise<GeneratedWaveformBlock> {
  const binaryPath = options.audiowaveform?.path;
  if (!binaryPath) throw new Error('audiowaveform path is missing');
  const audioStreamCount = await getAudioStreamCount(options.ffprobePath, options.sourcePath, options.signal);
  const ffmpeg = spawn(options.ffmpegPath, buildFfmpegPcmArgs(options, audioStreamCount), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const audiowaveform = spawn(binaryPath, [
    '--input-filename', '-',
    '--input-format', 'raw',
    '--raw-samplerate', WAVEFORM_PCM_SAMPLE_RATE.toString(),
    '--raw-channels', '1',
    '--raw-format', 's16le',
    '--output-filename', '-',
    '--output-format', 'json',
    '--pixels-per-second', options.metadata.pixelsPerSecond.toString(),
    '--bits', '8',
    '--quiet',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  ffmpeg.stdout?.pipe(audiowaveform.stdin!);

  const output: Buffer[] = [];
  let ffmpegError = '';
  let audiowaveformError = '';
  audiowaveform.stdout?.on('data', (chunk: Buffer) => output.push(Buffer.from(chunk)));
  ffmpeg.stderr?.on('data', (chunk) => { ffmpegError += chunk.toString(); });
  audiowaveform.stderr?.on('data', (chunk) => { audiowaveformError += chunk.toString(); });
  const removeAbort = installAbortHandler(options.signal, [ffmpeg, audiowaveform]);
  try {
    const [ffmpegCode, audiowaveformCode] = await Promise.all([
      waitForProcess(ffmpeg, 'FFmpeg'),
      waitForProcess(audiowaveform, 'audiowaveform'),
    ]);
    if (options.signal.aborted) throw new Error('Waveform block generation cancelled');
    if (ffmpegCode !== 0) throw new Error(`FFmpeg exited with ${ffmpegCode}: ${ffmpegError.trim()}`);
    if (audiowaveformCode !== 0) {
      throw new Error(`audiowaveform exited with ${audiowaveformCode}: ${audiowaveformError.trim()}`);
    }
    const parsed = JSON.parse(Buffer.concat(output).toString('utf8')) as {
      data?: number[];
      sample_rate?: number;
      samples_per_pixel?: number;
    };
    if (!Array.isArray(parsed.data) || parsed.data.length % 2 !== 0) {
      throw new Error('audiowaveform returned invalid min/max data');
    }
    const peaks = Int8Array.from(parsed.data.map((value) => Math.max(-128, Math.min(127, value))));
    const sampleRate = parsed.sample_rate ?? WAVEFORM_PCM_SAMPLE_RATE;
    const samplesPerPixel = parsed.samples_per_pixel ?? (sampleRate / options.metadata.pixelsPerSecond);
    return {
      peaks,
      duration: Math.min(options.duration, (peaks.length / 2) * samplesPerPixel / sampleRate),
      backend: 'audiowaveform',
    };
  } finally {
    removeAbort();
  }
}

async function consumeFfmpegPcm(
  options: {
    sourcePath: string;
    duration: number;
    metadata: CachedWaveformBlockMetadata;
    ffmpegPath: string;
    ffprobePath: string;
    signal: AbortSignal;
  },
  consume: (chunk: Buffer) => void
): Promise<void> {
  const audioStreamCount = await getAudioStreamCount(options.ffprobePath, options.sourcePath, options.signal);
  const process = spawn(options.ffmpegPath, buildFfmpegPcmArgs(options, audioStreamCount), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errorOutput = '';
  process.stdout?.on('data', consume);
  process.stderr?.on('data', (chunk) => { errorOutput += chunk.toString(); });
  const removeAbort = installAbortHandler(options.signal, [process]);
  try {
    const code = await waitForProcess(process, 'FFmpeg');
    if (options.signal.aborted) throw new Error('Waveform block generation cancelled');
    if (code !== 0) throw new Error(`FFmpeg exited with ${code}: ${errorOutput.trim()}`);
  } finally {
    removeAbort();
  }
}

function buildFfmpegPcmArgs(
  options: { sourcePath: string; duration: number; metadata: CachedWaveformBlockMetadata },
  audioStreamCount: number
): string[] {
  if (audioStreamCount < 1) throw new Error('Source contains no audio streams');
  return [
    '-v', 'error',
    '-ss', options.metadata.startTime.toFixed(6),
    '-t', options.duration.toFixed(6),
    '-i', options.sourcePath,
    ...buildTrackSelectionArgs(options.metadata.trackIndex, audioStreamCount),
    '-vn',
    '-ac', '1',
    '-ar', WAVEFORM_PCM_SAMPLE_RATE.toString(),
    '-c:a', 'pcm_s16le',
    '-f', 's16le',
    'pipe:1',
  ];
}

function buildTrackSelectionArgs(trackIndex: number, audioStreamCount: number): string[] {
  if (trackIndex === -1 && audioStreamCount > 1) {
    const inputs = Array.from({ length: audioStreamCount }, (_, index) => `[0:a:${index}]`).join('');
    return ['-filter_complex', `${inputs}amix=inputs=${audioStreamCount}:dropout_transition=0:normalize=0[aout]`, '-map', '[aout]'];
  }
  const normalized = trackIndex >= 0 && trackIndex < audioStreamCount ? trackIndex : 0;
  return ['-map', `0:a:${normalized}`];
}

async function getAudioStreamCount(
  ffprobePath: string,
  sourcePath: string,
  signal: AbortSignal
): Promise<number> {
  const process = spawn(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    sourcePath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errorOutput = '';
  process.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  process.stderr?.on('data', (chunk) => { errorOutput += chunk.toString(); });
  const removeAbort = installAbortHandler(signal, [process]);
  try {
    const code = await waitForProcess(process, 'ffprobe');
    if (signal.aborted) throw new Error('Waveform block generation cancelled');
    if (code !== 0) throw new Error(`ffprobe exited with ${code}: ${errorOutput.trim()}`);
    return output.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  } finally {
    removeAbort();
  }
}

function waitForProcess(process: ChildProcess, label: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    process.once('error', (error) => reject(new Error(`Failed to start ${label}: ${error.message}`)));
    process.once('close', (code) => resolve(code));
  });
}

function installAbortHandler(signal: AbortSignal, processes: ChildProcess[]): () => void {
  const abort = (): void => {
    for (const process of processes) process.kill('SIGKILL');
  };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}
