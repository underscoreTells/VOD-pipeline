import { describe, expect, it } from 'vitest';

import {
  getWaveformBlockKey,
  getWaveformResolutionForZoom,
} from '../../src/shared/utils/waveform-blocks.js';

describe('waveform resolution tiers', () => {
  it('selects the smallest tier that can represent the current zoom', () => {
    expect(getWaveformResolutionForZoom(0.1)).toBe(1);
    expect(getWaveformResolutionForZoom(4)).toBe(4);
    expect(getWaveformResolutionForZoom(4.1)).toBe(16);
    expect(getWaveformResolutionForZoom(400)).toBe(500);
    expect(getWaveformResolutionForZoom(2_000)).toBe(500);
  });

  it('keys the same time block independently at each resolution', () => {
    expect(getWaveformBlockKey(3, 1)).toBe('1:3');
    expect(getWaveformBlockKey(3, 16)).toBe('16:3');
  });
});
