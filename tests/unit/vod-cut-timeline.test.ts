import { describe, expect, it } from 'vitest';
import {
  calculateZoomAroundPointer,
  clampNumber,
  clampRangeAgainstNeighbors,
  getAdaptiveRulerStep,
  normalizeVodRange,
  pointerToVodTime,
  rangesOverlap,
  vodTimeToPixels,
} from '../../src/renderer/lib/utils/vod-cut-timeline.js';

describe('vod-cut-timeline utils', () => {
  describe('clampNumber', () => {
    it('returns the value when inside the range', () => {
      expect(clampNumber(5, 0, 10)).toBe(5);
    });

    it('clamps below the minimum', () => {
      expect(clampNumber(-3, 0, 10)).toBe(0);
    });

    it('clamps above the maximum', () => {
      expect(clampNumber(15, 0, 10)).toBe(10);
    });

    it('keeps exact boundary values', () => {
      expect(clampNumber(0, 0, 10)).toBe(0);
      expect(clampNumber(10, 0, 10)).toBe(10);
    });
  });

  describe('vodTimeToPixels', () => {
    it('converts seconds to pixels', () => {
      expect(vodTimeToPixels(10, 10)).toBe(100);
    });

    it('returns 0 for zero time', () => {
      expect(vodTimeToPixels(0, 10)).toBe(0);
    });

    it('returns 0 for invalid pixels per second', () => {
      expect(vodTimeToPixels(10, 0)).toBe(0);
      expect(vodTimeToPixels(10, -1)).toBe(0);
      expect(vodTimeToPixels(10, Number.NaN)).toBe(0);
    });

    it('returns 0 for non-finite time', () => {
      expect(vodTimeToPixels(Number.NaN, 10)).toBe(0);
    });
  });

  describe('pointerToVodTime', () => {
    it('maps a pointer to a vod time without scroll', () => {
      const time = pointerToVodTime({
        clientX: 150,
        viewportLeft: 100,
        scrollLeft: 0,
        pixelsPerSecond: 10,
        duration: 100,
      });
      expect(time).toBe(5);
    });

    it('accounts for horizontal scroll by adding scrollLeft', () => {
      const noScroll = pointerToVodTime({
        clientX: 150,
        viewportLeft: 100,
        scrollLeft: 0,
        pixelsPerSecond: 10,
        duration: 100,
      });
      const withScroll = pointerToVodTime({
        clientX: 150,
        viewportLeft: 100,
        scrollLeft: 200,
        pixelsPerSecond: 10,
        duration: 100,
      });
      expect(noScroll).toBe(5);
      expect(withScroll).toBe(25);
    });

    it('clamps the result to the vod duration on the right', () => {
      const time = pointerToVodTime({
        clientX: 100000,
        viewportLeft: 0,
        scrollLeft: 0,
        pixelsPerSecond: 10,
        duration: 100,
      });
      expect(time).toBe(100);
    });

    it('clamps the result to 0 on the left', () => {
      const time = pointerToVodTime({
        clientX: -500,
        viewportLeft: 0,
        scrollLeft: 0,
        pixelsPerSecond: 10,
        duration: 100,
      });
      expect(time).toBe(0);
    });

    it('returns 0 for invalid inputs', () => {
      expect(
        pointerToVodTime({
          clientX: 150,
          viewportLeft: 100,
          scrollLeft: 0,
          pixelsPerSecond: 0,
          duration: 100,
        })
      ).toBe(0);
      expect(
        pointerToVodTime({
          clientX: 150,
          viewportLeft: 100,
          scrollLeft: 0,
          pixelsPerSecond: 10,
          duration: 0,
        })
      ).toBe(0);
    });
  });

  describe('calculateZoomAroundPointer', () => {
    it('preserves the source time under the pointer when zooming in 2x at the middle', () => {
      const scrollLeft = calculateZoomAroundPointer({
        pointerX: 500,
        viewportLeft: 0,
        currentScrollLeft: 0,
        currentPixelsPerSecond: 10,
        nextPixelsPerSecond: 20,
        duration: 100,
        viewportWidth: 1000,
      });
      expect(scrollLeft).toBe(500);
      const timeUnderPointer = (500 + scrollLeft) / 20;
      expect(timeUnderPointer).toBe(50);
    });

    it('keeps scrollLeft at 0 when anchoring the start time', () => {
      const scrollLeft = calculateZoomAroundPointer({
        pointerX: 0,
        viewportLeft: 0,
        currentScrollLeft: 0,
        currentPixelsPerSecond: 10,
        nextPixelsPerSecond: 20,
        duration: 100,
        viewportWidth: 1000,
      });
      expect(scrollLeft).toBe(0);
    });

    it('preserves a near-end source time when there is room to scroll', () => {
      const scrollLeft = calculateZoomAroundPointer({
        pointerX: 900,
        viewportLeft: 0,
        currentScrollLeft: 0,
        currentPixelsPerSecond: 10,
        nextPixelsPerSecond: 20,
        duration: 100,
        viewportWidth: 1000,
      });
      expect(scrollLeft).toBe(900);
      const timeUnderPointer = (900 + scrollLeft) / 20;
      expect(timeUnderPointer).toBe(90);
    });

    it('clamps scrollLeft to maxScrollLeft when the anchor would overflow', () => {
      const scrollLeft = calculateZoomAroundPointer({
        pointerX: 100,
        viewportLeft: 0,
        currentScrollLeft: 800,
        currentPixelsPerSecond: 10,
        nextPixelsPerSecond: 50,
        duration: 100,
        viewportWidth: 1000,
      });
      const maxScrollLeft = 100 * 50 - 1000;
      expect(scrollLeft).toBe(maxScrollLeft);
      const timeUnderPointer = (100 + scrollLeft) / 50;
      expect(timeUnderPointer).toBe(82);
    });

    it('clamps scrollLeft to 0 when zooming out and the anchor would underflow', () => {
      const scrollLeft = calculateZoomAroundPointer({
        pointerX: 450,
        viewportLeft: 0,
        currentScrollLeft: 50,
        currentPixelsPerSecond: 50,
        nextPixelsPerSecond: 20,
        duration: 200,
        viewportWidth: 1000,
      });
      expect(scrollLeft).toBe(0);
      const timeUnderPointer = (450 + scrollLeft) / 20;
      expect(timeUnderPointer).toBe(22.5);
    });

    it('returns 0 for invalid inputs', () => {
      expect(
        calculateZoomAroundPointer({
          pointerX: 500,
          viewportLeft: 0,
          currentScrollLeft: 0,
          currentPixelsPerSecond: 10,
          nextPixelsPerSecond: 0,
          duration: 100,
          viewportWidth: 1000,
        })
      ).toBe(0);
      expect(
        calculateZoomAroundPointer({
          pointerX: 500,
          viewportLeft: 0,
          currentScrollLeft: 0,
          currentPixelsPerSecond: 10,
          nextPixelsPerSecond: 20,
          duration: 0,
          viewportWidth: 1000,
        })
      ).toBe(0);
    });
  });

  describe('normalizeVodRange', () => {
    it('returns a sorted clamped range for valid input', () => {
      expect(normalizeVodRange(10, 20, 100, 5)).toEqual({ start: 10, end: 20 });
    });

    it('sorts start and end when reversed', () => {
      expect(normalizeVodRange(20, 10, 100, 5)).toEqual({ start: 10, end: 20 });
    });

    it('clamps edges to the vod bounds', () => {
      expect(normalizeVodRange(-5, 8, 100, 5)).toEqual({ start: 0, end: 8 });
      expect(normalizeVodRange(95, 150, 100, 5)).toEqual({ start: 95, end: 100 });
    });

    it('rejects ranges shorter than minDuration', () => {
      expect(normalizeVodRange(10, 11, 100, 5)).toBeNull();
    });

    it('rejects ranges that become too short after clamping', () => {
      expect(normalizeVodRange(-5, 3, 100, 5)).toBeNull();
      expect(normalizeVodRange(98, 150, 100, 5)).toBeNull();
    });

    it('accepts a range exactly equal to minDuration', () => {
      expect(normalizeVodRange(10, 15, 100, 5)).toEqual({ start: 10, end: 15 });
    });

    it('returns null for invalid inputs', () => {
      expect(normalizeVodRange(Number.NaN, 20, 100, 5)).toBeNull();
      expect(normalizeVodRange(10, 20, 0, 5)).toBeNull();
      expect(normalizeVodRange(10, 20, -1, 5)).toBeNull();
    });
  });

  describe('rangesOverlap', () => {
    it('returns true for overlapping ranges', () => {
      expect(rangesOverlap({ start: 0, end: 5 }, { start: 4, end: 10 })).toBe(true);
    });

    it('returns false when edges touch exactly', () => {
      expect(rangesOverlap({ start: 0, end: 5 }, { start: 5, end: 10 })).toBe(false);
    });

    it('returns false for ranges separated by a gap', () => {
      expect(rangesOverlap({ start: 0, end: 5 }, { start: 6, end: 10 })).toBe(false);
    });

    it('returns true for identical ranges', () => {
      expect(rangesOverlap({ start: 0, end: 5 }, { start: 0, end: 5 })).toBe(true);
    });

    it('returns true when one range contains the other', () => {
      expect(rangesOverlap({ start: 2, end: 4 }, { start: 0, end: 10 })).toBe(true);
    });

    it('treats near-touch edges within epsilon as non-overlapping', () => {
      expect(rangesOverlap({ start: 0, end: 5 }, { start: 5.0000001, end: 10 }, 1e-6)).toBe(false);
    });

    it('treats a real overlap larger than epsilon as overlapping', () => {
      expect(rangesOverlap({ start: 0, end: 5 }, { start: 4.9999, end: 10 }, 1e-6)).toBe(true);
    });

    it('sorts unsorted ranges before comparing', () => {
      expect(rangesOverlap({ start: 5, end: 0 }, { start: 10, end: 5 })).toBe(false);
      expect(rangesOverlap({ start: 5, end: 0 }, { start: 10, end: 4 })).toBe(true);
    });
  });

  describe('clampRangeAgainstNeighbors', () => {
    it('preserves a valid dragged range', () => {
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
    });

    it('clamps the end to the next neighbor start', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: 10,
          end: 30,
          duration: 100,
          previousEnd: 5,
          nextStart: 25,
          minDuration: 2,
        })
      ).toEqual({ start: 10, end: 25 });
    });

    it('clamps the start to the previous neighbor end', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: -5,
          end: 8,
          duration: 100,
          previousEnd: 5,
          nextStart: 25,
          minDuration: 2,
        })
      ).toEqual({ start: 5, end: 18 });
    });

    it('clamps to duration when there are no neighbors', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: 90,
          end: 120,
          duration: 100,
          previousEnd: null,
          nextStart: undefined,
          minDuration: 5,
        })
      ).toEqual({ start: 90, end: 100 });
    });

    it('expands a too-short range to minDuration preserving the start', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: 10,
          end: 11,
          duration: 100,
          previousEnd: 5,
          nextStart: 25,
          minDuration: 3,
        })
      ).toEqual({ start: 10, end: 13 });
    });

    it('pulls start back to keep minDuration before the next neighbor', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: 24,
          end: 30,
          duration: 100,
          previousEnd: 5,
          nextStart: 25,
          minDuration: 2,
        })
      ).toEqual({ start: 23, end: 25 });
    });

    it('returns null when the neighbor window is smaller than minDuration', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: 10,
          end: 20,
          duration: 100,
          previousEnd: 22,
          nextStart: 24,
          minDuration: 3,
        })
      ).toBeNull();
    });

    it('sorts a reversed dragged range before clamping', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: 20,
          end: 10,
          duration: 100,
          previousEnd: 5,
          nextStart: 25,
          minDuration: 2,
        })
      ).toEqual({ start: 10, end: 20 });
    });

    it('returns null for invalid inputs', () => {
      expect(
        clampRangeAgainstNeighbors({
          start: Number.NaN,
          end: 20,
          duration: 100,
          previousEnd: 5,
          nextStart: 25,
          minDuration: 2,
        })
      ).toBeNull();
      expect(
        clampRangeAgainstNeighbors({
          start: 10,
          end: 20,
          duration: 0,
          previousEnd: 5,
          nextStart: 25,
          minDuration: 2,
        })
      ).toBeNull();
    });
  });

  describe('getAdaptiveRulerStep', () => {
    it('chooses a step whose ticks fall in the 80-160px band at fit zoom', () => {
      const pps = 2;
      const step = getAdaptiveRulerStep(pps);
      expect(step).toBe(60);
      expect(step * pps).toBe(120);
      expect(step * pps).toBeGreaterThanOrEqual(80);
      expect(step * pps).toBeLessThanOrEqual(160);
    });

    it('chooses a frame-level step at frame-level zoom', () => {
      const pps = 2400;
      const step = getAdaptiveRulerStep(pps);
      expect(step).toBe(1 / 30);
      expect(step * pps).toBe(80);
      expect(step * pps).toBeGreaterThanOrEqual(80);
      expect(step * pps).toBeLessThanOrEqual(160);
    });

    it('chooses a useful mid-range step', () => {
      const pps = 10;
      const step = getAdaptiveRulerStep(pps);
      expect(step).toBe(10);
      expect(step * pps).toBe(100);
    });

    it('falls back to the coarsest step when zoomed out further than the list allows', () => {
      expect(getAdaptiveRulerStep(0.01)).toBe(3600);
    });

    it('falls back to the coarsest step for invalid pixels per second', () => {
      expect(getAdaptiveRulerStep(0)).toBe(3600);
      expect(getAdaptiveRulerStep(-5)).toBe(3600);
      expect(getAdaptiveRulerStep(Number.NaN)).toBe(3600);
    });
  });
});
