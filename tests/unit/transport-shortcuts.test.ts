import { describe, expect, it } from 'vitest';

import {
  getArrowNavigationDelta,
  nextShuttleSpeed,
} from '../../src/renderer/lib/utils/transport-shortcuts.js';

describe('transport shortcuts', () => {
  it('keeps plain arrows frame-accurate', () => {
    expect(getArrowNavigationDelta({
      key: 'ArrowRight',
      shiftKey: false,
      fps: 60,
      coarseJumpSeconds: 10,
    })).toBeCloseTo(1 / 60);
    expect(getArrowNavigationDelta({
      key: 'ArrowLeft',
      shiftKey: false,
      fps: 24,
      coarseJumpSeconds: 10,
    })).toBeCloseTo(-1 / 24);
  });

  it('uses the configured coarse jump for Shift plus Arrow', () => {
    expect(getArrowNavigationDelta({
      key: 'ArrowRight',
      shiftKey: true,
      fps: 60,
      coarseJumpSeconds: 15,
    })).toBe(15);
  });

  it('cycles shuttle speeds up to the maximum tier', () => {
    expect(nextShuttleSpeed(0)).toBe(1);
    expect(nextShuttleSpeed(1)).toBe(2);
    expect(nextShuttleSpeed(4)).toBe(8);
    expect(nextShuttleSpeed(8)).toBe(8);
  });
});
