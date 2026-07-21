import { describe, expect, it } from 'vitest';
import { getTier1PixelsPerSecond } from '../../src/pipeline/waveform.js';

describe('waveform overview resolution', () => {
  it('uses the normal overview resolution for short assets', () => {
    expect(getTier1PixelsPerSecond(60)).toBe(50);
  });

  it('caps the overview payload for long VODs', () => {
    const eightHours = 8 * 60 * 60;
    const pixelsPerSecond = getTier1PixelsPerSecond(eightHours);

    expect(pixelsPerSecond).toBe(3);
    expect(pixelsPerSecond * eightHours).toBeLessThanOrEqual(100_000);
  });

  it('falls back safely when duration is unavailable', () => {
    expect(getTier1PixelsPerSecond(null)).toBe(50);
    expect(getTier1PixelsPerSecond(Number.NaN)).toBe(50);
  });
});
