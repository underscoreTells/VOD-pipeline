import { describe, expect, it } from 'vitest';
import { normalizeTimelineActions } from '../../src/electron/ipc/support/conversation-results.js';

describe('conversation result normalization', () => {
  it('accepts an arbitrary number of ordered split segments with gaps', () => {
    expect(normalizeTimelineActions([{
      type: 'split_clip',
      clipId: 42,
      segments: [
        { inPoint: 10, outPoint: 18, description: 'Setup' },
        { inPoint: 24, outPoint: 31, role: 'escalation' },
        { inPoint: 45, outPoint: 52, isEssential: false },
      ],
      reasoning: 'Remove dead air',
    }])).toEqual([{
      type: 'split_clip',
      clipId: 42,
      segments: [
        {
          inPoint: 10,
          outPoint: 18,
          role: undefined,
          description: 'Setup',
          isEssential: undefined,
        },
        {
          inPoint: 24,
          outPoint: 31,
          role: 'escalation',
          description: undefined,
          isEssential: undefined,
        },
        {
          inPoint: 45,
          outPoint: 52,
          role: undefined,
          description: undefined,
          isEssential: false,
        },
      ],
      reasoning: 'Remove dead air',
      supersedesSuggestionId: undefined,
    }]);
  });

  it('rejects overlapping or single-segment split actions', () => {
    expect(normalizeTimelineActions([
      {
        type: 'split_clip',
        clipId: 42,
        segments: [{ inPoint: 10, outPoint: 18 }],
      },
      {
        type: 'split_clip',
        clipId: 42,
        segments: [
          { inPoint: 10, outPoint: 20 },
          { inPoint: 19, outPoint: 30 },
        ],
      },
    ])).toEqual([]);
  });
});
