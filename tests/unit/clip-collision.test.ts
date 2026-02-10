import { describe, expect, it } from 'vitest';
import { clampMoveStartWithCollision } from '../../src/renderer/lib/utils/clip-collision.js';

const baseInput = {
  candidateStart: 10,
  duration: 5,
  chapterDuration: 60,
  currentStart: 10,
  currentEnd: 15,
  direction: 'none' as const,
  otherIntervals: [] as Array<{ start: number; end: number }>,
};

describe('clip collision utils', () => {
  it('returns candidate start when there are no collisions', () => {
    const result = clampMoveStartWithCollision(baseInput);
    expect(result).toBe(10);
  });

  it('clamps movement to chapter bounds', () => {
    const left = clampMoveStartWithCollision({
      ...baseInput,
      candidateStart: -4,
      direction: 'left',
    });
    const right = clampMoveStartWithCollision({
      ...baseInput,
      candidateStart: 80,
      direction: 'right',
    });

    expect(left).toBe(0);
    expect(right).toBe(55);
  });

  it('stops at the first right-side clip boundary', () => {
    const result = clampMoveStartWithCollision({
      ...baseInput,
      candidateStart: 22,
      direction: 'right',
      otherIntervals: [
        { start: 20, end: 25 },
        { start: 30, end: 40 },
      ],
    });

    expect(result).toBe(15);
  });

  it('stops at the first left-side clip boundary', () => {
    const result = clampMoveStartWithCollision({
      ...baseInput,
      candidateStart: 3,
      direction: 'left',
      otherIntervals: [
        { start: 1, end: 9 },
        { start: -5, end: -1 },
      ],
    });

    expect(result).toBe(9);
  });

  it('allows exact boundary touch without overlap', () => {
    const result = clampMoveStartWithCollision({
      ...baseInput,
      candidateStart: 15,
      direction: 'right',
      otherIntervals: [{ start: 20, end: 28 }],
    });

    expect(result).toBe(15);
  });

  it('ignores collision boundaries when drag direction is none', () => {
    const result = clampMoveStartWithCollision({
      ...baseInput,
      direction: 'none',
      otherIntervals: [{ start: 12, end: 18 }],
    });

    expect(result).toBe(10);
  });

  it('ignores invalid or zero-length intervals', () => {
    const result = clampMoveStartWithCollision({
      ...baseInput,
      candidateStart: 18,
      direction: 'right',
      otherIntervals: [
        { start: Number.NaN, end: 20 },
        { start: 24, end: 24 },
        { start: 30, end: 32 },
      ],
    });

    expect(result).toBe(18);
  });
});
