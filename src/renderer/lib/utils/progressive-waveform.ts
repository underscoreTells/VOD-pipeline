import type { WaveformBlock } from '$shared/contracts/electron-api';
import {
  getWaveformBlockKey,
  getWaveformBlockIndexes,
  getWaveformResolutionForZoom,
  WAVEFORM_RESOLUTION_TIERS,
  WAVEFORM_BLOCK_DURATION_SECONDS,
} from '$shared/utils/waveform-blocks';

import { requestWaveformBlocks } from '../api/waveforms.js';

interface LoadProgressiveWaveformOptions {
  assetId: number;
  trackIndex: number;
  startTime: number;
  endTime: number;
  sourceDuration: number;
  pixelsPerSecond: number;
  requestMode: 'background' | 'interactive';
  loadedBlockKeys: ReadonlySet<string>;
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
  pixelsPerSecond,
  requestMode,
  loadedBlockKeys,
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
    .filter((index) => !loadedBlockKeys.has(getWaveformBlockKey(index, pixelsPerSecond)));
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
          pixelsPerSecond,
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

function getPreferredBlock(
  blocks: ReadonlyMap<string, WaveformBlock>,
  blockIndex: number,
  targetPixelsPerSecond: number
): WaveformBlock | null {
  const targetResolution = getWaveformResolutionForZoom(targetPixelsPerSecond);
  const higherOrEqual = WAVEFORM_RESOLUTION_TIERS.filter((tier) => tier >= targetResolution);
  const lower = WAVEFORM_RESOLUTION_TIERS.filter((tier) => tier < targetResolution).reverse();
  for (const resolution of [...higherOrEqual, ...lower]) {
    const block = blocks.get(getWaveformBlockKey(blockIndex, resolution));
    if (block) return block;
  }
  return null;
}

export function getWaveformPeakForTimeRange(
  blocks: ReadonlyMap<string, WaveformBlock>,
  sourceStartTime: number,
  sourceEndTime: number,
  targetPixelsPerSecond: number
): { min: number; max: number } | null {
  const boundedStart = Math.max(0, Math.min(sourceStartTime, sourceEndTime));
  const boundedEnd = Math.max(boundedStart, Math.max(sourceStartTime, sourceEndTime));
  const firstBlockIndex = Math.floor(boundedStart / WAVEFORM_BLOCK_DURATION_SECONDS);
  const lastBlockIndex = Math.floor(
    Math.max(boundedStart, boundedEnd - Number.EPSILON) / WAVEFORM_BLOCK_DURATION_SECONDS
  );
  let minimum = 1;
  let maximum = -1;
  let found = false;

  for (let blockIndex = firstBlockIndex; blockIndex <= lastBlockIndex; blockIndex += 1) {
    const block = getPreferredBlock(blocks, blockIndex, targetPixelsPerSecond);
    if (!block || block.peakCount <= 0) continue;
    const rangeStart = Math.max(boundedStart, block.startTime);
    const rangeEnd = Math.min(
      Math.max(boundedEnd, rangeStart + (1 / Math.max(1, targetPixelsPerSecond))),
      block.startTime + block.duration
    );
    if (rangeEnd <= rangeStart) continue;
    const firstPeakIndex = Math.max(
      0,
      Math.floor((rangeStart - block.startTime) * block.pixelsPerSecond)
    );
    const lastPeakIndex = Math.min(
      block.peakCount - 1,
      Math.max(firstPeakIndex, Math.ceil((rangeEnd - block.startTime) * block.pixelsPerSecond) - 1)
    );
    for (let peakIndex = firstPeakIndex; peakIndex <= lastPeakIndex; peakIndex += 1) {
      minimum = Math.min(minimum, block.peaks[peakIndex * 2] / 128);
      maximum = Math.max(maximum, block.peaks[peakIndex * 2 + 1] / 128);
      found = true;
    }
  }

  return found ? { min: minimum, max: maximum } : null;
}

export function countWaveformBlocksAtResolution(
  blocks: ReadonlyMap<string, WaveformBlock>,
  pixelsPerSecond: number
): number {
  let count = 0;
  for (const block of blocks.values()) {
    if (block.pixelsPerSecond === pixelsPerSecond) count += 1;
  }
  return count;
}
