import { describe, expect, it } from 'vitest';

import type { WaveformBlock } from '../../src/shared/contracts/electron-api.js';
import { getWaveformBlockKey } from '../../src/shared/utils/waveform-blocks.js';
import {
  countWaveformBlocksAtResolution,
  getWaveformPeakForTimeRange,
} from '../../src/renderer/lib/utils/progressive-waveform.js';

function createBlock(
  pixelsPerSecond: number,
  peaks: number[],
  index = 0,
  startTime = 0
): WaveformBlock {
  return {
    index,
    startTime,
    duration: peaks.length / 2 / pixelsPerSecond,
    pixelsPerSecond,
    peakCount: peaks.length / 2,
    encoding: 'int8-min-max',
    peaks: Int8Array.from(peaks),
  };
}

describe('progressive waveform rendering', () => {
  it('aggregates every peak covered by a screen pixel', () => {
    const block = createBlock(4, [-10, 10, -80, 70, -20, 30, -40, 100]);
    const blocks = new Map([[getWaveformBlockKey(0, 4), block]]);

    expect(getWaveformPeakForTimeRange(blocks, 0, 1, 4)).toEqual({
      min: -80 / 128,
      max: 100 / 128,
    });
  });

  it('uses coarse data as a fallback and replaces it with the closest detailed tier', () => {
    const coarse = createBlock(1, [-100, 100]);
    const detailed = createBlock(16, [-32, 64]);
    const blocks = new Map<string, WaveformBlock>([
      [getWaveformBlockKey(0, 1), coarse],
      [getWaveformBlockKey(0, 16), detailed],
    ]);

    expect(getWaveformPeakForTimeRange(blocks, 0, 0.01, 1)).toEqual({
      min: -100 / 128,
      max: 100 / 128,
    });
    expect(getWaveformPeakForTimeRange(blocks, 0, 0.01, 64)).toEqual({
      min: -32 / 128,
      max: 64 / 128,
    });
    expect(countWaveformBlocksAtResolution(blocks, 1)).toBe(1);
    expect(countWaveformBlocksAtResolution(blocks, 16)).toBe(1);
  });
});
