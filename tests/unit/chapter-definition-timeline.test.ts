import { describe, expect, it } from 'vitest';

import {
  createDraftChapterRange,
  createDraftChapterRangeFromPoints,
  findDanglingInPointToLeft,
  insertDraftChapterRange,
  MIN_DRAFT_CHAPTER_DURATION_SECONDS,
  moveDraftChapterRange,
  normalizeDraftChapterRange,
  removeDraftChapterRange,
  renumberDraftChapterRanges,
  resizeDraftChapterRange,
} from '../../src/renderer/lib/components/chapter-definition-timeline.js';

describe('chapter definition timeline helpers', () => {
  it('creates a normalized range from drag input', () => {
    expect(
      createDraftChapterRange({
        id: 1,
        startTime: 30,
        endTime: 10,
        timelineDuration: 100,
      })
    ).toEqual({
      id: 1,
      title: 'Chapter',
      startTime: 10,
      endTime: 30,
    });
  });

  it('rejects draft ranges below the minimum duration', () => {
    expect(
      normalizeDraftChapterRange({
        startTime: 10,
        endTime: 10 + MIN_DRAFT_CHAPTER_DURATION_SECONDS - 0.01,
        timelineDuration: 100,
      })
    ).toBeNull();
  });

  it('does not find a dangling in-point when none is pending', () => {
    expect(findDanglingInPointToLeft({ inPoint: null, cursorTime: 20 })).toBeNull();
  });

  it('does not find a dangling in-point when it is to the right of the cursor', () => {
    expect(findDanglingInPointToLeft({ inPoint: 30, cursorTime: 20 })).toBeNull();
  });

  it('does not find a dangling in-point when it is too close to the cursor', () => {
    expect(
      findDanglingInPointToLeft({
        inPoint: 10,
        cursorTime: 10 + MIN_DRAFT_CHAPTER_DURATION_SECONDS - 0.01,
      })
    ).toBeNull();
  });

  it('finds a dangling in-point when it is far enough to the left of the cursor', () => {
    expect(
      findDanglingInPointToLeft({
        inPoint: 10,
        cursorTime: 10 + MIN_DRAFT_CHAPTER_DURATION_SECONDS,
      })
    ).toBe(10);
  });

  it('creates a normalized range from explicit in and out points', () => {
    expect(
      createDraftChapterRangeFromPoints({
        id: 2,
        inPoint: 40,
        outPoint: 20,
        timelineDuration: 100,
      })
    ).toEqual({
      id: 2,
      title: 'Chapter',
      startTime: 20,
      endTime: 40,
    });
  });

  it('rejects overlapping inserted ranges', () => {
    const ranges = renumberDraftChapterRanges([
      { id: 1, title: 'Chapter', startTime: 10, endTime: 20 },
    ]);
    const overlapping = createDraftChapterRange({
      id: 2,
      startTime: 19,
      endTime: 25,
      timelineDuration: 100,
    });

    expect(overlapping).not.toBeNull();
    expect(insertDraftChapterRange(ranges, overlapping!)).toBeNull();
  });

  it('allows gaps between inserted ranges and renumbers by timeline order', () => {
    const first = createDraftChapterRange({
      id: 1,
      startTime: 30,
      endTime: 40,
      timelineDuration: 100,
    });
    const second = createDraftChapterRange({
      id: 2,
      startTime: 10,
      endTime: 20,
      timelineDuration: 100,
    });

    const withFirst = insertDraftChapterRange([], first!);
    const withSecond = insertDraftChapterRange(withFirst!, second!);

    expect(withSecond).toEqual([
      { id: 2, title: 'Chapter 1', startTime: 10, endTime: 20 },
      { id: 1, title: 'Chapter 2', startTime: 30, endTime: 40 },
    ]);
  });

  it('moves a range within neighbor bounds without overlap', () => {
    const ranges = renumberDraftChapterRanges([
      { id: 1, title: 'Chapter', startTime: 0, endTime: 10 },
      { id: 2, title: 'Chapter', startTime: 20, endTime: 30 },
      { id: 3, title: 'Chapter', startTime: 40, endTime: 50 },
    ]);

    expect(moveDraftChapterRange(ranges, 2, 35, 100)).toEqual([
      { id: 1, title: 'Chapter 1', startTime: 0, endTime: 10 },
      { id: 2, title: 'Chapter 2', startTime: 30, endTime: 40 },
      { id: 3, title: 'Chapter 3', startTime: 40, endTime: 50 },
    ]);
  });

  it('resizes a range against its neighbors', () => {
    const ranges = renumberDraftChapterRanges([
      { id: 1, title: 'Chapter', startTime: 0, endTime: 10 },
      { id: 2, title: 'Chapter', startTime: 20, endTime: 30 },
      { id: 3, title: 'Chapter', startTime: 40, endTime: 50 },
    ]);

    expect(resizeDraftChapterRange(ranges, 2, 'start', 5, 100)).toEqual([
      { id: 1, title: 'Chapter 1', startTime: 0, endTime: 10 },
      { id: 2, title: 'Chapter 2', startTime: 10, endTime: 30 },
      { id: 3, title: 'Chapter 3', startTime: 40, endTime: 50 },
    ]);

    expect(resizeDraftChapterRange(ranges, 2, 'end', 45, 100)).toEqual([
      { id: 1, title: 'Chapter 1', startTime: 0, endTime: 10 },
      { id: 2, title: 'Chapter 2', startTime: 20, endTime: 40 },
      { id: 3, title: 'Chapter 3', startTime: 40, endTime: 50 },
    ]);
  });

  it('renumbers after removal', () => {
    const ranges = renumberDraftChapterRanges([
      { id: 10, title: 'Chapter', startTime: 5, endTime: 10 },
      { id: 20, title: 'Chapter', startTime: 15, endTime: 20 },
      { id: 30, title: 'Chapter', startTime: 25, endTime: 30 },
    ]);

    expect(removeDraftChapterRange(ranges, 20)).toEqual([
      { id: 10, title: 'Chapter 1', startTime: 5, endTime: 10 },
      { id: 30, title: 'Chapter 2', startTime: 25, endTime: 30 },
    ]);
  });
});
