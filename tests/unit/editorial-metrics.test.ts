import { describe, expect, it } from 'vitest';
import { evaluateEditorialRemovals } from '../../src/agent/evaluation/editorial-metrics.js';

describe('editorial evaluation metrics', () => {
  it('scores removal matches, boundary error, and protected overlap', () => {
    expect(evaluateEditorialRemovals({
      expectedRemovals: [{ start: 10, end: 12 }, { start: 30, end: 35 }],
      proposedRemovals: [{ start: 10.2, end: 12.1 }, { start: 50, end: 52 }],
      protectedRanges: [{ start: 51, end: 60 }],
    })).toEqual({
      expectedCount: 2,
      proposedCount: 2,
      matchedCount: 1,
      precision: 0.5,
      recall: 0.5,
      meanBoundaryErrorSeconds: expect.closeTo(0.15),
      protectedOverlapSeconds: 1,
    });
  });

  it('handles empty annotated and proposed sets', () => {
    expect(evaluateEditorialRemovals({ expectedRemovals: [], proposedRemovals: [] }))
      .toMatchObject({ precision: 1, recall: 1, meanBoundaryErrorSeconds: null });
  });
});
