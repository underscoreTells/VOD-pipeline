import { describe, it, expect } from 'vitest';
import { buildClipTimes, normalizeSelection } from '../../src/renderer/lib/utils/clip-selection.js';

describe('clip-selection utils', () => {
  it('normalizes selection order', () => {
    const result = normalizeSelection(12, 5, 0.25);
    expect(result).toEqual({ start: 5, end: 12 });
  });

  it('rejects selections shorter than minimum duration', () => {
    const result = normalizeSelection(10, 10.1, 0.25);
    expect(result).toBeNull();
  });

  it('builds clip times from selection', () => {
    const selection = normalizeSelection(20, 30, 0.25);
    expect(selection).not.toBeNull();
    const clipTimes = buildClipTimes(selection!);
    expect(clipTimes).toEqual({ startTime: 20, inPoint: 20, outPoint: 30 });
  });
});
