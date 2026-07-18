import { describe, expect, it } from 'vitest';
import {
  calculateZoomAroundPointer,
  clampNumber,
  clampRangeAgainstNeighbors,
  getAdaptiveRulerStep,
  mergeRanges,
  normalizeRange,
  pointerToTime,
  rangesOverlap,
  snapRangeToFrames,
  snapTimeToFrame,
  timeToPixels,
  toLocalTime,
  toSourceTime,
} from '../../src/renderer/lib/utils/timeline-geometry.js';

describe('timeline-geometry general exports', () => {
  it('timeToPixels converts seconds to pixels and guards invalid input', () => {
    expect(timeToPixels(10, 10)).toBe(100);
    expect(timeToPixels(10, 0)).toBe(0);
    expect(timeToPixels(Number.NaN, 10)).toBe(0);
  });

  it('pointerToTime maps a pointer to a time and clamps to duration', () => {
    expect(
      pointerToTime({
        clientX: 150,
        viewportLeft: 100,
        scrollLeft: 200,
        pixelsPerSecond: 10,
        duration: 100,
      })
    ).toBe(25);
    expect(
      pointerToTime({
        clientX: 100000,
        viewportLeft: 0,
        scrollLeft: 0,
        pixelsPerSecond: 10,
        duration: 100,
      })
    ).toBe(100);
  });

  it('clampNumber, rangesOverlap, normalizeRange, clampRangeAgainstNeighbors, getAdaptiveRulerStep, calculateZoomAroundPointer behave as expected', () => {
    expect(clampNumber(15, 0, 10)).toBe(10);
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 4, end: 10 })).toBe(true);
    expect(normalizeRange(20, 10, 100, 5)).toEqual({ start: 10, end: 20 });
    expect(
      clampRangeAgainstNeighbors({
        start: 10,
        end: 20,
        duration: 100,
        previousEnd: 5,
        nextStart: 25,
        minDuration: 2,
      })
    ).toEqual({ start: 10, end: 20 });
    expect(getAdaptiveRulerStep(10)).toBe(10);
    expect(
      calculateZoomAroundPointer({
        pointerX: 500,
        viewportLeft: 0,
        currentScrollLeft: 0,
        currentPixelsPerSecond: 10,
        nextPixelsPerSecond: 20,
        duration: 100,
        viewportWidth: 1000,
      })
    ).toBe(500);
  });
});

describe('mergeRanges', () => {
  it('returns an empty array for empty input', () => {
    expect(mergeRanges([])).toEqual([]);
  });

  it('returns an empty array for non-array input', () => {
    expect(mergeRanges(null as unknown as never[])).toEqual([]);
  });

  it('returns a copy of a single valid range', () => {
    expect(mergeRanges([{ start: 5, end: 10 }])).toEqual([{ start: 5, end: 10 }]);
  });

  it('merges overlapping ranges', () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 4, end: 10 }])).toEqual([
      { start: 0, end: 10 },
    ]);
  });

  it('merges exactly touching ranges with default epsilon 0', () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 5, end: 10 }])).toEqual([
      { start: 0, end: 10 },
    ]);
  });

  it('keeps adjacent ranges separate when the gap exceeds epsilon', () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 7, end: 10 }])).toEqual([
      { start: 0, end: 5 },
      { start: 7, end: 10 },
    ]);
  });

  it('merges ranges separated by a gap within epsilon', () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 6, end: 10 }], 1)).toEqual([
      { start: 0, end: 10 },
    ]);
  });

  it('keeps touching ranges separate with negative epsilon (strict overlap only)', () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 5, end: 10 }], -0.0001)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]);
  });

  it('sorts unsorted input before merging', () => {
    expect(
      mergeRanges([{ start: 30, end: 40 }, { start: 0, end: 10 }, { start: 5, end: 15 }])
    ).toEqual([
      { start: 0, end: 15 },
      { start: 30, end: 40 },
    ]);
  });

  it('normalizes reversed ranges before merging', () => {
    expect(mergeRanges([{ start: 10, end: 0 }, { start: 5, end: 20 }])).toEqual([
      { start: 0, end: 20 },
    ]);
  });

  it('skips degenerate and invalid ranges', () => {
    expect(
      mergeRanges([
        { start: 5, end: 5 },
        { start: Number.NaN, end: 10 },
        { start: 0, end: 10 },
        { start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY },
      ])
    ).toEqual([{ start: 0, end: 10 }]);
  });

  it('extends the running range when a later range is contained', () => {
    expect(
      mergeRanges([
        { start: 0, end: 20 },
        { start: 5, end: 10 },
        { start: 15, end: 25 },
      ])
    ).toEqual([{ start: 0, end: 25 }]);
  });

  it('does not mutate the input array elements', () => {
    const input = [{ start: 0, end: 5 }, { start: 4, end: 10 }];
    const snapshot = input.map((r) => ({ ...r }));
    mergeRanges(input);
    expect(input.map((r) => ({ ...r }))).toEqual(snapshot);
  });
});

describe('toLocalTime / toSourceTime', () => {
  it('converts source time to local time using an offset', () => {
    expect(toLocalTime(105, 100)).toBe(5);
    expect(toLocalTime(100, 100)).toBe(0);
  });

  it('converts local time back to source time using an offset', () => {
    expect(toSourceTime(5, 100)).toBe(105);
    expect(toSourceTime(0, 100)).toBe(100);
  });

  it('is symmetric for valid inputs', () => {
    expect(toSourceTime(toLocalTime(73, 30), 30)).toBe(73);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(toLocalTime(Number.NaN, 100)).toBe(0);
    expect(toLocalTime(50, Number.NaN)).toBe(0);
    expect(toSourceTime(Number.NaN, 100)).toBe(0);
    expect(toSourceTime(50, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('supports negative offsets', () => {
    expect(toLocalTime(-5, -10)).toBe(5);
    expect(toSourceTime(5, -10)).toBe(-5);
  });
});

describe('snapTimeToFrame', () => {
  it('snaps a time down to the previous frame boundary when closer to it', () => {
    expect(snapTimeToFrame(0.99, 30)).toBeCloseTo(1.0, 6);
    expect(snapTimeToFrame(1.01, 30)).toBeCloseTo(1.0, 6);
  });

  it('snaps a time up to the next frame boundary when closer to it', () => {
    expect(snapTimeToFrame(1.02, 30)).toBeCloseTo(31 / 30, 6);
    expect(snapTimeToFrame(2.04, 30)).toBeCloseTo(61 / 30, 6);
  });

  it('returns the exact frame time when already aligned', () => {
    expect(snapTimeToFrame(2, 30)).toBe(2);
    expect(snapTimeToFrame(1 / 30, 30)).toBeCloseTo(1 / 30, 6);
  });

  it('passes the time through when fps is invalid', () => {
    expect(snapTimeToFrame(5, 0)).toBe(5);
    expect(snapTimeToFrame(5, -1)).toBe(5);
    expect(snapTimeToFrame(5, Number.NaN)).toBe(5);
  });

  it('returns 0 for non-finite time', () => {
    expect(snapTimeToFrame(Number.NaN, 30)).toBe(0);
    expect(snapTimeToFrame(Number.POSITIVE_INFINITY, 30)).toBe(0);
  });
});

describe('snapRangeToFrames', () => {
  it('snaps both edges to the nearest frame boundary', () => {
    const snapped = snapRangeToFrames({ start: 1.02, end: 2.04 }, 30);
    expect(snapped.start).toBeCloseTo(31 / 30, 6);
    expect(snapped.end).toBeCloseTo(61 / 30, 6);
  });

  it('returns a normalized range for reversed input', () => {
    const snapped = snapRangeToFrames({ start: 2.04, end: 1.02 }, 30);
    expect(snapped.start).toBeLessThanOrEqual(snapped.end);
    expect(snapped.start).toBeCloseTo(31 / 30, 6);
    expect(snapped.end).toBeCloseTo(61 / 30, 6);
  });

  it('returns a zero range for null or undefined input', () => {
    expect(snapRangeToFrames(null, 30)).toEqual({ start: 0, end: 0 });
    expect(snapRangeToFrames(undefined, 30)).toEqual({ start: 0, end: 0 });
  });

  it('passes edges through when fps is invalid', () => {
    expect(snapRangeToFrames({ start: 1.5, end: 2.7 }, 0)).toEqual({ start: 1.5, end: 2.7 });
    expect(snapRangeToFrames({ start: 1.5, end: 2.7 }, Number.NaN)).toEqual({ start: 1.5, end: 2.7 });
  });
});
