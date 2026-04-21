import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearTimeline,
  restoreTransport,
  snapshotTransport,
  timelineState,
} from '../../src/renderer/lib/state/timeline.svelte';

describe('timeline transport snapshots', () => {
  beforeEach(() => {
    clearTimeline();
  });

  afterEach(() => {
    clearTimeline();
  });

  it('captures the current transport state', () => {
    timelineState.isPlaying = true;
    timelineState.shuttleDirection = -1;
    timelineState.shuttleSpeed = 4;

    expect(snapshotTransport()).toEqual({
      isPlaying: true,
      shuttleDirection: -1,
      shuttleSpeed: 4,
    });
  });

  it('restores a paused transport snapshot exactly', () => {
    timelineState.isPlaying = true;
    timelineState.shuttleDirection = 1;
    timelineState.shuttleSpeed = 2;

    restoreTransport({
      isPlaying: false,
      shuttleDirection: 0,
      shuttleSpeed: 1,
    });

    expect(timelineState.isPlaying).toBe(false);
    expect(timelineState.shuttleDirection).toBe(0);
    expect(timelineState.shuttleSpeed).toBe(1);
  });

  it('restores a forward transport snapshot exactly', () => {
    restoreTransport({
      isPlaying: true,
      shuttleDirection: 1,
      shuttleSpeed: 2,
    });

    expect(timelineState.isPlaying).toBe(true);
    expect(timelineState.shuttleDirection).toBe(1);
    expect(timelineState.shuttleSpeed).toBe(2);
  });

  it('restores a reverse transport snapshot exactly', () => {
    restoreTransport({
      isPlaying: true,
      shuttleDirection: -1,
      shuttleSpeed: 8,
    });

    expect(timelineState.isPlaying).toBe(true);
    expect(timelineState.shuttleDirection).toBe(-1);
    expect(timelineState.shuttleSpeed).toBe(8);
  });
});
