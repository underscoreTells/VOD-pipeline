import { beforeEach, describe, expect, it } from 'vitest';
import {
  addVodCutRange,
  deleteVodCutRange,
  initializeVodCut,
  markVodCutIn,
  markVodCutOut,
  markVodCutSaved,
  redoVodCut,
  setVodCutDuration,
  setVodCutPlayhead,
  undoVodCut,
  updateVodCutRange,
  vodCutState,
} from '../../src/renderer/lib/state/vod-cut.svelte.js';

describe('vod cut state', () => {
  beforeEach(() => {
    initializeVodCut({ projectId: 1, assetId: 2, duration: 3600, fps: 60 });
  });

  it('creates a range from visible in and out marks', () => {
    setVodCutPlayhead(120);
    markVodCutIn();
    setVodCutPlayhead(180);
    markVodCutOut();

    const range = addVodCutRange();

    expect(range).toMatchObject({ title: 'Chapter 1', start_time: 120, end_time: 180 });
    expect(vodCutState.pendingIn).toBeNull();
    expect(vodCutState.pendingOut).toBeNull();
  });

  it('keeps ranges in chronological source order', () => {
    addVodCutRange({ title: 'Later', start: 600, end: 700 });
    addVodCutRange({ title: 'Earlier', start: 100, end: 200 });

    expect(vodCutState.ranges.map((range) => range.title)).toEqual(['Earlier', 'Later']);
  });

  it('allows gaps but rejects overlaps', () => {
    addVodCutRange({ start: 100, end: 200 });

    expect(addVodCutRange({ start: 250, end: 300 })).not.toBeNull();
    expect(addVodCutRange({ start: 190, end: 260 })).toBeNull();
    expect(vodCutState.error).toBe('Chapter ranges cannot overlap.');
  });

  it('uses the source fps as the minimum range duration', () => {
    expect(addVodCutRange({ start: 10, end: 10.01 })).toBeNull();
    expect(addVodCutRange({ start: 10, end: 10 + 1 / 60 })).not.toBeNull();
  });

  it('prevents trimming into a neighboring range', () => {
    const first = addVodCutRange({ start: 100, end: 200 });
    addVodCutRange({ start: 300, end: 400 });

    expect(updateVodCutRange(first!.id, { end_time: 350 })).toBe(false);
    expect(vodCutState.ranges[0].end_time).toBe(200);
  });

  it('undoes and redoes range mutations', () => {
    const range = addVodCutRange({ start: 100, end: 200 });
    updateVodCutRange(range!.id, { title: 'Opening' });
    deleteVodCutRange(range!.id);

    expect(vodCutState.ranges).toHaveLength(0);
    expect(undoVodCut()).toBe(true);
    expect(vodCutState.ranges[0].title).toBe('Opening');
    expect(undoVodCut()).toBe(true);
    expect(vodCutState.ranges[0].title).toBe('Chapter 1');
    expect(redoVodCut()).toBe(true);
    expect(vodCutState.ranges[0].title).toBe('Opening');
  });

  it('does not mark a newer edit clean when an older save completes', () => {
    addVodCutRange({ start: 100, end: 200 });
    const savedRevision = vodCutState.revision;
    addVodCutRange({ start: 300, end: 400 });

    markVodCutSaved('2026-07-18T00:00:00.000Z', savedRevision);

    expect(vodCutState.dirty).toBe(true);
    expect(vodCutState.lastSavedAt).toBe('2026-07-18T00:00:00.000Z');
  });

  it('defers persisted range sanitization until duration is available', () => {
    initializeVodCut({
      projectId: 1,
      assetId: 2,
      duration: Number.NaN,
      draft: {
        project_id: 1,
        asset_id: 2,
        updated_at: '2026-07-18T00:00:00.000Z',
        ranges: [
          { id: 'valid', title: 'Opening', start_time: 10, end_time: 20 },
          { id: 'bad', title: '', start_time: 20, end_time: 10 },
        ],
      },
    });

    expect(vodCutState.duration).toBe(0);
    expect(vodCutState.ranges).toEqual([]);
    expect(vodCutState.isLoading).toBe(true);
    expect(vodCutState.error).toBeNull();

    setVodCutDuration(100);

    expect(vodCutState.ranges).toEqual([
      { id: 'valid', title: 'Opening', start_time: 10, end_time: 20 },
    ]);
    expect(vodCutState.isLoading).toBe(false);
    expect(vodCutState.error).toBe('Some invalid saved chapter ranges were removed.');
  });

  it('restores and tracks the persisted VOD viewport', () => {
    initializeVodCut({
      projectId: 1,
      assetId: 2,
      duration: 3600,
      draft: {
        project_id: 1,
        asset_id: 2,
        ranges: [],
        view: { playheadTime: 120, pixelsPerSecond: 16, scrollLeft: 800 },
        updated_at: '2026-07-18T00:00:00.000Z',
      },
    });

    expect(vodCutState.playheadTime).toBe(120);
    expect(vodCutState.pixelsPerSecond).toBe(16);
    expect(vodCutState.scrollLeft).toBe(800);
    expect(vodCutState.dirty).toBe(false);

    setVodCutPlayhead(121);
    expect(vodCutState.dirty).toBe(true);
  });
});
