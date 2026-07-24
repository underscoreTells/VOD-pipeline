import { describe, expect, it } from 'vitest';
import {
  createFindTranscriptEditCandidatesTool,
  createLoadFullTranscriptTool,
} from '../../src/agent/conversation/tools/transcript-evidence.js';
import type { ConversationToolAccumulator } from '../../src/agent/conversation/tools/create-tools.js';
import type { ConversationTurnInput } from '../../src/agent/conversation/types.js';
import type { Transcript } from '../../src/shared/types/database.js';

function createInput(): ConversationTurnInput {
  return {
    messages: [],
    selectedClipIds: [],
    context: {
      chapter: { id: '8', startTime: 100, endTime: 160 },
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

const transcripts: Transcript[] = [{
  id: 12,
  chapter_id: 8,
  text: 'Um really really can explain this now',
  start_time: 2,
  end_time: 6,
  words_json: [
    { word: ' Um', start: 2, end: 2.2 },
    { word: ' really', start: 2.3, end: 2.4 },
    { word: ' really', start: 2.5, end: 2.6 },
    { word: ' can', start: 4, end: 4.2 },
  ],
}];

describe('transcript evidence tools', () => {
  it('returns paginated segments with stable evidence references', async () => {
    const accumulator = createAccumulator();
    const tool = createLoadFullTranscriptTool(createInput(), accumulator, async () => transcripts);
    const output = JSON.parse(await tool.execute({ offset: 0, limit: 1 })) as Record<string, unknown>;

    expect(output).toMatchObject({ nextOffset: null, wordTimestampsAvailable: true });
    expect(accumulator.evidenceReferences).toEqual([expect.objectContaining({
      evidenceId: 'transcript-segment:12',
      observedAtStep: 2,
    })]);
  });

  it('finds conservative filler, repetition, and pause candidates', async () => {
    const accumulator = createAccumulator();
    const tool = createFindTranscriptEditCandidatesTool(
      createInput(),
      accumulator,
      async () => transcripts
    );
    const output = JSON.parse(await tool.execute({ minimumPauseSeconds: 0.8 })) as {
      candidates: Array<{ category: string }>;
    };

    expect(output.candidates.map((candidate) => candidate.category)).toEqual([
      'filler',
      'repetition',
      'pause',
    ]);
    expect(accumulator.evidenceReferences).toHaveLength(3);
  });
});
