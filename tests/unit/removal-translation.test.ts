import { describe, expect, it } from 'vitest';
import { translateRemovalToTimelineAction } from '../../src/agent/conversation/tools/proposals.js';
import type { ConversationTurnInput } from '../../src/agent/conversation/types.js';

function createInput(): ConversationTurnInput {
  return {
    messages: [],
    selectedClipIds: [4],
    context: {
      chapter: { id: '2', startTime: 100, endTime: 200 },
      chapterAssetIds: [1],
      chapterClips: [{
        id: 4,
        assetId: 1,
        trackIndex: 0,
        inPoint: 110,
        outPoint: 150,
        role: 'setup',
        description: 'Explanation',
        isEssential: true,
      }],
      detailedTranscripts: [],
      videoAnalysisAssets: [],
    },
  };
}

describe('removal proposal translation', () => {
  it('translates start and end removals into clip-boundary updates', () => {
    expect(translateRemovalToTimelineAction(createInput(), {
      type: 'remove_range', clipId: 4, removeStart: 10, removeEnd: 14,
    })).toMatchObject({ type: 'update_clip', clipId: 4, updates: { inPoint: 14 } });

    expect(translateRemovalToTimelineAction(createInput(), {
      type: 'remove_range', clipId: 4, removeStart: 44, removeEnd: 50,
    })).toMatchObject({ type: 'update_clip', clipId: 4, updates: { outPoint: 44 } });
  });

  it('translates an internal removal into two kept split segments', () => {
    expect(translateRemovalToTimelineAction(createInput(), {
      type: 'remove_range',
      clipId: 4,
      removeStart: 24,
      removeEnd: 27,
      evidenceIds: ['transcript-candidate:1:pause:3'],
    })).toEqual({
      type: 'split_clip',
      clipId: 4,
      reasoning: undefined,
      supersedesSuggestionId: undefined,
      evidenceIds: ['transcript-candidate:1:pause:3'],
      segments: [
        { inPoint: 10, outPoint: 24 },
        { inPoint: 27, outPoint: 50 },
      ],
    });
  });

  it('translates a full-range removal into clip deletion', () => {
    expect(translateRemovalToTimelineAction(createInput(), {
      type: 'remove_range', clipId: 4, removeStart: 10, removeEnd: 50,
    })).toMatchObject({ type: 'delete_clip', clipId: 4 });
  });
});
