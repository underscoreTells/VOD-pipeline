import { describe, expect, it } from 'vitest';
import {
  clampPreviewFps,
  getReversePreviewFps,
  snapToPreviewSample,
} from '../../src/renderer/lib/utils/previewSampling.js';

describe('preview sampling helpers', () => {
  it('falls back to 24 fps when source fps is missing or invalid', () => {
    expect(clampPreviewFps(undefined)).toBe(24);
    expect(clampPreviewFps(null)).toBe(24);
    expect(clampPreviewFps(Number.NaN)).toBe(24);
    expect(clampPreviewFps(Number.POSITIVE_INFINITY)).toBe(24);
  });

  it('clamps preview fps into the supported range', () => {
    expect(clampPreviewFps(2)).toBe(5);
    expect(clampPreviewFps(24)).toBe(24);
    expect(clampPreviewFps(60)).toBe(30);
  });

  it('maps reverse preview quality to the expected sampling fps', () => {
    expect(getReversePreviewFps('quick')).toBe(10);
    expect(getReversePreviewFps('full')).toBe(15);
    expect(getReversePreviewFps(null)).toBe(15);
  });

  it('quantizes preview samples evenly across representative frame rates', () => {
    expect(snapToPreviewSample(0.16, 10)).toBeCloseTo(0.2, 10);
    expect(snapToPreviewSample(0.11, 15)).toBeCloseTo(2 / 15, 10);
    expect(snapToPreviewSample(0.027, 24)).toBeCloseTo(1 / 24, 10);
    expect(snapToPreviewSample(0.051, 30)).toBeCloseTo(2 / 30, 10);
  });
});
