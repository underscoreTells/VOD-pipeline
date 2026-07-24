import { describe, expect, it } from 'vitest';
import {
  createFindTranscriptEditCandidatesTool,
  createLoadFullTranscriptTool,
} from '../../../src/agent/conversation/tools/transcript-evidence.js';
import type { ConversationToolAccumulator } from '../../../src/agent/conversation/tools/create-tools.js';
import type { ConversationTurnInput } from '../../../src/agent/conversation/types.js';
import type { Transcript } from '../../../src/shared/types/database.js';

function createInput(): ConversationTurnInput {
  return {
    messages: [],
    selectedClipIds: [],
    context: {
      chapter: { id: '3', startTime: 100, endTime: 160 },
      chapterAssetIds: [1],
      chapterClips: [],
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
    evidenceReferences: [],
    currentStepIndex: 2,
    hasSuccessfulVideoEvidence: false,
    videoEvidenceAssetIds: new Set(),
  };
}

const transcripts: Transcript[] = [
  {
    id: 11,
    chapter_id: 3,
    text: 'Um go',
    start_time: 110,
    end_time: 111,
    words_json: [
      { word: 'Um', start: 110, end: 110.2 },
      { word: 'go', start: 110.3, end: 110.5 },
    ],
  },
  {
    id: 12,
    chapter_id: 3,
    text: 'go now',
    start_time: 112,
    end_time: 113,
    words_json: [
      { word: 'go', start: 112, end: 112.2 },
      { word: 'now', start: 112.3, end: 112.7 },
    ],
  },
];

describe('transcript evidence tools', () => {
  it('normalizes legacy global timestamps and records stable evidence references', async () => {
    const accumulator = createAccumulator();
    const tool = createLoadFullTranscriptTool(createInput(), accumulator, async () => transcripts);

    const output = JSON.parse(await tool.execute({ startLocalTime: 9, endLocalTime: 14 })) as {
      segments: Array<{ evidenceId: string; start: number; end: number; words: Array<{ start: number }> }>;
    };

    expect(output.segments).toEqual([
      expect.objectContaining({ evidenceId: 'transcript-segment:11', start: 10, end: 11 }),
      expect.objectContaining({ evidenceId: 'transcript-segment:12', start: 12, end: 13 }),
    ]);
    expect(output.segments[0]?.words[0]?.start).toBe(10);
    expect(accumulator.evidenceReferences).toEqual([
      expect.objectContaining({ evidenceId: 'transcript-segment:11', start: 10, end: 11, observedAtStep: 2 }),
      expect.objectContaining({ evidenceId: 'transcript-segment:12', start: 12, end: 13, observedAtStep: 2 }),
    ]);
  });

  it('finds filler, repetition, and pause candidates across segment boundaries', async () => {
    const accumulator = createAccumulator();
    const tool = createFindTranscriptEditCandidatesTool(
      createInput(),
      accumulator,
      async () => transcripts
    );

    const output = JSON.parse(await tool.execute({ startLocalTime: 9, endLocalTime: 14 })) as {
      candidates: Array<{ evidenceId: string; category: string; start: number; end: number }>;
    };

    expect(output.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceId: 'transcript-candidate:11:filler:0', category: 'filler' }),
      expect.objectContaining({ evidenceId: 'transcript-candidate:11:pause:1', category: 'pause', start: 10.5, end: 12 }),
      expect.objectContaining({ evidenceId: 'transcript-candidate:12:repetition:0', category: 'repetition' }),
    ]));
    expect(accumulator.evidenceReferences).toHaveLength(output.candidates.length);
  });
});
