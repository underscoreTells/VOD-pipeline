import { describe, expect, it } from 'vitest';
import type { Chapter, Clip } from '../../src/shared/types/database.js';
import {
  clipOverlapsChapterSourceRange,
  compareChaptersForExport,
  compareClipsBySourceTime,
  compareClipsForExport,
  getClipVisibleRangeInChapter,
  mergeSuggestionUpdateWindow,
  normalizeSuggestionWindowForChapter,
  resolveSuggestionWindowForChapter,
  resolveSuggestionWindowsForChapter,
  splitClipAtSourceTime,
} from '../../src/shared/utils/clip-timing.js';

function createChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 1,
    project_id: 1,
    title: 'Chapter',
    start_time: 100,
    end_time: 200,
    display_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    project_id: 1,
    asset_id: 1,
    track_index: 0,
    in_point: 120,
    out_point: 150,
    role: null,
    description: null,
    is_essential: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('clip timing helpers', () => {
  it('filters chapter clips by source overlap', () => {
    const chapter = createChapter({ start_time: 100, end_time: 200 });

    expect(
      clipOverlapsChapterSourceRange(createClip({ in_point: 120, out_point: 160 }), chapter)
    ).toBe(true);
    expect(
      clipOverlapsChapterSourceRange(createClip({ in_point: 10, out_point: 80 }), chapter)
    ).toBe(false);
    expect(
      clipOverlapsChapterSourceRange(createClip({ in_point: 200, out_point: 220 }), chapter)
    ).toBe(false);
  });

  it('resolves a shared visible source range for timeline, sidebar, and chapter preview', () => {
    const chapter = createChapter({ start_time: 100, end_time: 180 });
    const clip = createClip({ in_point: 90, out_point: 150 });

    expect(getClipVisibleRangeInChapter(clip, chapter)).toEqual({
      start: 100,
      end: 150,
    });
  });

  it('normalizes chapter-local suggestion windows to global source times', () => {
    const chapter = createChapter({ start_time: 3600, end_time: 4200 });

    expect(
      normalizeSuggestionWindowForChapter({ in_point: 50, out_point: 60 }, chapter)
    ).toEqual({ start: 3650, end: 3660 });
  });

  it('clamps suggestion windows to the chapter range', () => {
    const chapter = createChapter({ start_time: 3600, end_time: 4200 });

    expect(
      normalizeSuggestionWindowForChapter({ in_point: -5, out_point: 700 }, chapter)
    ).toEqual({ start: 3600, end: 4200 });
  });

  it('keeps the out point at or after the clamped in point', () => {
    const chapter = createChapter({ start_time: 3600, end_time: 4200 });

    expect(
      normalizeSuggestionWindowForChapter({ in_point: 500, out_point: 100 }, chapter)
    ).toEqual({ start: 4100, end: 4100 });
  });

  it('merges update payloads onto the live target window', () => {
    const chapter = createChapter({ start_time: 100, end_time: 200 });
    const payload = JSON.stringify({ update: { inPoint: 20 } });

    expect(
      mergeSuggestionUpdateWindow(
        { action_payload_json: payload },
        { start: 140, end: 150 },
        chapter
      )
    ).toEqual({ start: 120, end: 150 });
  });

  it('clamps merged update windows like the backend apply path', () => {
    const chapter = createChapter({ start_time: 100, end_time: 200 });

    expect(
      mergeSuggestionUpdateWindow(
        { action_payload_json: JSON.stringify({ update: { inPoint: -10, outPoint: 500 } }) },
        { start: 140, end: 150 },
        chapter
      )
    ).toEqual({ start: 100, end: 200 });
  });

  it('resolves update suggestions against the live target window', () => {
    const chapter = createChapter({ start_time: 100, end_time: 200 });
    const suggestion = {
      in_point: 20,
      out_point: 21,
      action_type: 'update_clip' as const,
      target_clip_id: 7,
      action_payload_json: JSON.stringify({ update: { description: 'metadata only' } }),
    };

    expect(
      resolveSuggestionWindowForChapter(suggestion, chapter, { start: 140, end: 150 })
    ).toEqual({ start: 140, end: 150 });
  });

  it('falls back to the stored range when the update target is gone', () => {
    const chapter = createChapter({ start_time: 100, end_time: 200 });
    const suggestion = {
      in_point: 20,
      out_point: 30,
      action_type: 'update_clip' as const,
      target_clip_id: 7,
      action_payload_json: null,
    };

    expect(resolveSuggestionWindowForChapter(suggestion, chapter, null)).toEqual({
      start: 120,
      end: 130,
    });
  });

  it('resolves every kept segment in a multi-split suggestion', () => {
    const chapter = createChapter({ start_time: 100, end_time: 200 });
    const suggestion = {
      in_point: 10,
      out_point: 70,
      action_type: 'split_clip' as const,
      target_clip_id: 7,
      action_payload_json: JSON.stringify({
        split: {
          segments: [
            { inPoint: 10, outPoint: 20 },
            { inPoint: 30, outPoint: 40 },
            { inPoint: 60, outPoint: 70 },
          ],
        },
      }),
    };

    expect(resolveSuggestionWindowsForChapter(suggestion, chapter, { start: 110, end: 170 })).toEqual([
      { start: 110, end: 120 },
      { start: 130, end: 140 },
      { start: 160, end: 170 },
    ]);
  });

  it('resolves legacy binary split payloads into two windows', () => {
    const chapter = createChapter({ start_time: 100, end_time: 200 });
    const suggestion = {
      in_point: 20,
      out_point: 50,
      action_type: 'split_clip' as const,
      target_clip_id: 7,
      action_payload_json: JSON.stringify({ split: { splitPoint: 35 } }),
    };

    expect(resolveSuggestionWindowsForChapter(suggestion, chapter, { start: 120, end: 150 })).toEqual([
      { start: 120, end: 135 },
      { start: 135, end: 150 },
    ]);
  });

  it('splits a clip from source time into left and right source windows', () => {
    expect(
      splitClipAtSourceTime({
        inPoint: 110,
        outPoint: 130,
        splitTime: 118,
      })
    ).toEqual({
      leftInPoint: 110,
      leftOutPoint: 118,
      rightInPoint: 118,
      rightOutPoint: 130,
    });
  });

  it('sorts chapters and clips into stable export order', () => {
    const chapters = [
      createChapter({ id: 3, display_order: 1, start_time: 200, end_time: 260 }),
      createChapter({ id: 2, display_order: 1, start_time: 100, end_time: 160 }),
      createChapter({ id: 1, display_order: 0, start_time: 0, end_time: 50 }),
    ].sort(compareChaptersForExport);

    expect(chapters.map((chapter) => chapter.id)).toEqual([1, 2, 3]);

    const clips = [
      createClip({ id: 9, asset_id: 2, in_point: 120, out_point: 130 }),
      createClip({ id: 7, asset_id: 1, in_point: 120, out_point: 128 }),
      createClip({ id: 8, asset_id: 1, in_point: 140, out_point: 150 }),
    ];

    expect([...clips].sort(compareClipsBySourceTime).map((clip) => clip.id)).toEqual([7, 9, 8]);
    expect([...clips].sort(compareClipsForExport).map((clip) => clip.id)).toEqual([7, 9, 8]);
  });
});
