import { describe, expect, it } from 'vitest';
import { buildDefaultClipRangeAtCursor, splitClipAtTimelineTime } from '../../src/renderer/lib/utils/timeline-edit.js';

describe('timeline edit utils', () => {
  describe('buildDefaultClipRangeAtCursor', () => {
    it('creates a 5s range at the cursor in an empty lane', () => {
      const range = buildDefaultClipRangeAtCursor(12, [], 120, 5, 0.05);
      expect(range).toEqual({ start: 12, end: 17 });
    });

    it('clamps range to the next clip boundary', () => {
      const range = buildDefaultClipRangeAtCursor(
        12,
        [{ start: 14, end: 18 }],
        120,
        5,
        0.05
      );

      expect(range).toEqual({ start: 12, end: 14 });
    });

    it('returns null when cursor is inside an existing clip', () => {
      const range = buildDefaultClipRangeAtCursor(
        12,
        [{ start: 10, end: 20 }],
        120,
        5,
        0.05
      );

      expect(range).toBeNull();
    });

    it('backfills start near chapter end when needed', () => {
      const range = buildDefaultClipRangeAtCursor(9.8, [], 10, 5, 0.05);
      expect(range).toEqual({ start: 9.8, end: 10 });
    });
  });

  describe('splitClipAtTimelineTime', () => {
    it('returns split points for a valid split', () => {
      const split = splitClipAtTimelineTime({
        inPoint: 110,
        outPoint: 130,
        splitTime: 118,
        minDuration: 0.05,
      });

      expect(split).toEqual({
        leftInPoint: 110,
        leftOutPoint: 118,
        rightInPoint: 118,
        rightOutPoint: 130,
      });
    });

    it('rejects splits too close to clip edges', () => {
      const nearStart = splitClipAtTimelineTime({
        clipStartTime: 10,
        inPoint: 10,
        outPoint: 20,
        splitTime: 10.01,
        minDuration: 0.05,
      });
      const nearEnd = splitClipAtTimelineTime({
        clipStartTime: 10,
        inPoint: 10,
        outPoint: 20,
        splitTime: 19.99,
        minDuration: 0.05,
      });

      expect(nearStart).toBeNull();
      expect(nearEnd).toBeNull();
    });
  });
});
