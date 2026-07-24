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
    evidenceReferences: [{
      evidenceId: 'detailed-transcript:1:0.000:100.000',
      start: 0,
      end: 100,
      source: 'detailed_transcript',
      observedAtStep: 0,
      assetId: 1,
    }],
    currentStepIndex: 1,
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

  it('rejects evidence fetched in the same model step', () => {
    const accumulator = createAccumulator();
    accumulator.evidenceReferences[0]!.observedAtStep = 2;
    accumulator.currentStepIndex = 2;

    expect(() => validateProposalGrounding(createInput(), accumulator, [{
      type: 'remove_range',
      clipId: 7,
      removeStart: 22,
      removeEnd: 24,
      reasoning: 'Remove repeated wording',
    }])).toThrow('returned in an earlier model step');
  });

  it('rejects an overview transcript without precise evidence', () => {
    const accumulator = createAccumulator();
    accumulator.evidenceReferences = [];

    expect(() => validateProposalGrounding(createInput(), accumulator, [{
      type: 'range_suggestion',
      in_point: 20,
      out_point: 30,
      description: 'Keep the concise explanation',
    }])).toThrow('Actionable edits require overlapping transcript or video evidence');
  });

  it('requires update evidence at the changed trim boundary', () => {
    const accumulator = createAccumulator();
    accumulator.evidenceReferences = [{
      evidenceId: 'unrelated-clip-evidence',
      start: 35,
      end: 36,
      source: 'full_transcript',
      observedAtStep: 0,
    }];

    expect(() => validateProposalGrounding(createInput(), accumulator, [{
      type: 'update_clip',
      clipId: 7,
      updates: { inPoint: 25 },
      reasoning: 'Trim repeated setup from the head',
    }])).toThrow('Actionable edits require overlapping transcript or video evidence');
  });

  it('requires evidence for every gap removed by a direct split', () => {
    const accumulator = createAccumulator();
    accumulator.evidenceReferences = [{
      evidenceId: 'first-gap-only',
      start: 25,
      end: 30,
      source: 'full_transcript',
      observedAtStep: 0,
    }];

    expect(() => validateProposalGrounding(createInput(), accumulator, [{
      type: 'split_clip',
      clipId: 7,
      segments: [
        { inPoint: 20, outPoint: 25 },
        { inPoint: 30, outPoint: 35 },
      ],
      reasoning: 'Remove two separate pacing stalls',
    }])).toThrow('Actionable edits require overlapping transcript or video evidence');
  });
});
