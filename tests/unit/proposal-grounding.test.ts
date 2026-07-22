import { describe, expect, it } from 'vitest';
import { validateProposalGrounding } from '../../src/agent/conversation/tools/grounding.js';
import type { ConversationTurnInput } from '../../src/agent/conversation/types.js';
import type { ConversationToolAccumulator } from '../../src/agent/conversation/tools/create-tools.js';

function createInput(): ConversationTurnInput {
  return {
    messages: [],
    selectedClipIds: [],
    context: {
      chapter: { id: '3', startTime: 100, endTime: 200 },
      chapterAssetIds: [1],
      chapterClips: [{
        id: 7,
        assetId: 1,
        trackIndex: 0,
        inPoint: 120,
        outPoint: 140,
        role: null,
        description: null,
        isEssential: true,
      }],
      transcript: 'Transcript context',
      detailedTranscripts: [],
      videoAnalysisAssets: [],
    },
  };
}

function createAccumulator(): ConversationToolAccumulator {
  return {
    suggestionDrafts: [],
    timelineActions: [],
    transcriptDetailRequests: [],
    loadedDetailedTranscripts: [],
    hasSuccessfulVideoEvidence: false,
    videoEvidenceAssetIds: new Set(),
  };
}

describe('proposal grounding', () => {
  it('rejects delete targets that are not available in the current chapter', () => {
    expect(() => validateProposalGrounding(createInput(), createAccumulator(), [{
      type: 'delete_clip',
      clipId: 99,
      reasoning: 'Remove the unrelated clip',
    }])).toThrow('delete_clip target clip 99 is not available in this chapter');
  });

  it('accepts delete targets available in the current chapter', () => {
    expect(() => validateProposalGrounding(createInput(), createAccumulator(), [{
      type: 'delete_clip',
      clipId: 7,
      reasoning: 'Remove the current chapter clip',
    }])).not.toThrow();
  });

  it('rejects structural targets that cross a chapter boundary', () => {
    const input = createInput();
    input.context.chapterClips[0]!.inPoint = 90;

    expect(() => validateProposalGrounding(input, createAccumulator(), [{
      type: 'delete_clip',
      clipId: 7,
      reasoning: 'Remove the boundary-crossing clip',
    }])).toThrow('delete_clip target clip 7 is not available in this chapter');
  });

  it('accepts a structural target grounded by an explicit clip mention', () => {
    const input = createInput();
    input.context.transcript = '';
    input.context.referencedEntities = [{ type: 'clip', id: 7, label: 'Clip 7' }];

    expect(() => validateProposalGrounding(input, createAccumulator(), [{
      type: 'delete_clip',
      clipId: 7,
      reasoning: 'Remove the explicitly mentioned clip',
    }])).not.toThrow();
  });
});
