import type { WaveformBlock } from '$shared/contracts/electron-api';
import {
  DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
  getWaveformBlockIndexes,
  WAVEFORM_BLOCK_DURATION_SECONDS,
} from '$shared/utils/waveform-blocks';

import { requestWaveformBlocks } from '../api/waveforms.js';

interface LoadProgressiveWaveformOptions {
  assetId: number;
  trackIndex: number;
  startTime: number;
  endTime: number;
  sourceDuration: number;
  requestMode: 'background' | 'interactive';
  loadedIndexes: ReadonlySet<number>;
  signal?: AbortSignal;
  concurrency?: number;
  onBlock: (block: WaveformBlock) => void;
}

export interface ProgressiveWaveformLoadResult {
  requested: number;
  loaded: number;
  failed: number;
}

export async function loadProgressiveWaveformRange({
  assetId,
  trackIndex,
  startTime,
  endTime,
  sourceDuration,
  requestMode,
  loadedIndexes,
  signal,
  concurrency = requestMode === 'interactive' ? 2 : 1,
  onBlock,
}: LoadProgressiveWaveformOptions): Promise<ProgressiveWaveformLoadResult> {
  const boundedStart = Math.max(0, Math.min(sourceDuration, startTime));
  const boundedEnd = Math.max(boundedStart, Math.min(sourceDuration, endTime));
  if (boundedEnd <= boundedStart || signal?.aborted) {
    return { requested: 0, loaded: 0, failed: 0 };
  }

  const indexes = getWaveformBlockIndexes(boundedStart, boundedEnd)
    .filter((index) => !loadedIndexes.has(index));
  let cursor = 0;
  let loaded = 0;
  let failed = 0;

  const worker = async (): Promise<void> => {
    while (!signal?.aborted) {
      const index = indexes[cursor];
      cursor += 1;
      if (index === undefined) return;
      const blockStart = index * WAVEFORM_BLOCK_DURATION_SECONDS;
      const blockEnd = Math.min(sourceDuration, blockStart + WAVEFORM_BLOCK_DURATION_SECONDS);
      try {
        const result = await requestWaveformBlocks({
          assetId,
          trackIndex,
          startTime: blockStart,
          endTime: blockEnd,
          pixelsPerSecond: DEFAULT_WAVEFORM_PIXELS_PER_SECOND,
          requestMode,
        });
        if (signal?.aborted) return;
        if (!result.success || !result.data) throw new Error(result.error || 'Waveform block request failed');
        for (const block of result.data.blocks) onBlock(block);
        loaded += result.data.blocks.length;
      } catch (error) {
        if (!signal?.aborted) {
          failed += 1;
          console.warn(`[Waveform] Block ${index} unavailable`, error);
        }
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), indexes.length) },
    () => worker()
  ));
  return { requested: indexes.length, loaded, failed };
}

export function getWaveformPeakAtTime(
  blocks: ReadonlyMap<number, WaveformBlock>,
  sourceTime: number
): { min: number; max: number } | null {
  const blockIndex = Math.floor(sourceTime / WAVEFORM_BLOCK_DURATION_SECONDS);
  const block = blocks.get(blockIndex);
  if (!block || sourceTime < block.startTime || sourceTime > block.startTime + block.duration) return null;
  const pairIndex = Math.min(
    block.peakCount - 1,
    Math.max(0, Math.floor((sourceTime - block.startTime) * block.pixelsPerSecond))
  ) * 2;
  return {
    min: block.peaks[pairIndex] / 128,
    max: block.peaks[pairIndex + 1] / 128,
  };
}
