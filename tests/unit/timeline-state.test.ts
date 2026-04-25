import { beforeEach, describe, expect, it } from 'vitest';
import type { Clip } from '../../src/shared/types/database.js';
import {
  clearTimeline,
  createClip as addClip,
  getTotalDuration,
  timelineState,
  zoomToFit,
} from '../../src/renderer/lib/state/timeline.svelte.js';

function createClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    project_id: 1,
    asset_id: 1,
    track_index: 0,
    in_point: 10,
    out_point: 20,
    role: null,
    description: null,
    is_essential: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('timeline state duration', () => {
  beforeEach(() => {
    clearTimeline();
  });

  it('computes total duration from summed clip lengths instead of source timestamps', () => {
    addClip(createClip({ id: 1, in_point: 3600, out_point: 3610 }));
    addClip(createClip({ id: 2, in_point: 25, out_point: 30 }));

    expect(getTotalDuration()).toBe(15);
  });

  it('zooms to fit using playback duration instead of absolute source time', () => {
    addClip(createClip({ id: 1, in_point: 3600, out_point: 3610 }));

    zoomToFit();

    expect(timelineState.zoomLevel).toBe(100);
  });
});
