import { getTranscriptsByChapter } from '../../../electron/database/index.js';
import type { Transcript, DetailedTranscriptWord } from '../../../shared/types/database.js';
import type { ConversationTurnInput } from '../types.js';
import type { ConversationToolAccumulator } from './create-tools.js';
import {
  AgentToolDefinition,
  defineAgentTool,
} from '../../tools/define-tool.js';
import {
  DEFAULT_TRANSCRIPT_EDIT_CANDIDATES,
  DEFAULT_TRANSCRIPT_EVIDENCE_SEGMENTS,
  MAX_TRANSCRIPT_EDIT_CANDIDATES,
  MAX_TRANSCRIPT_EVIDENCE_SEGMENTS,
} from './constants.js';
import {
  findTranscriptEditCandidatesSchema,
  loadFullTranscriptSchema,
  type FindTranscriptEditCandidatesInput,
  type LoadFullTranscriptInput,
} from './schemas.js';

export interface ConversationEvidenceReference {
  evidenceId: string;
  start: number;
  end: number;
  source: 'full_transcript' | 'edit_candidate' | 'detailed_transcript' | 'video';
  observedAtStep: number;
  assetId?: number;
}

type TranscriptEditCandidate = {
  evidenceId: string;
  category: 'filler' | 'repetition' | 'pause';
  start: number;
  end: number;
  text: string;
  context: string;
};

type NormalizedTranscriptSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  words: DetailedTranscriptWord[];
};

type IndexedTranscriptWord = DetailedTranscriptWord & {
  segmentId: number;
  wordIndex: number;
};

const FILLER_WORDS = new Set(['uh', 'um', 'erm', 'er', 'hmm', 'mm-hmm', 'uh-huh']);

export async function loadChapterTranscriptEvidence(chapterId: number): Promise<Transcript[]> {
  return await getTranscriptsByChapter(chapterId);
}

function getChapterId(input: ConversationTurnInput): number {
  const chapterId = Number(input.context.chapter?.id);
  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    throw new Error('A valid active chapter is required to load transcript evidence.');
  }
  return chapterId;
}

function getChapterDuration(input: ConversationTurnInput): number {
  const chapter = input.context.chapter;
  return chapter ? Math.max(0.01, chapter.endTime - chapter.startTime) : 0.01;
}

function normalizeRange(
  input: ConversationTurnInput,
  startLocalTime?: number,
  endLocalTime?: number
): { start: number; end: number } {
  const duration = getChapterDuration(input);
  const start = Math.min(duration, Math.max(0, startLocalTime ?? 0));
  const end = Math.min(duration, Math.max(start, endLocalTime ?? duration));
  if (end <= start) {
    throw new Error('endLocalTime must be greater than startLocalTime.');
  }
  return { start, end };
}

function getSegmentEvidenceId(segment: Pick<Transcript, 'id'>): string {
  return `transcript-segment:${segment.id}`;
}

function normalizeTranscriptSegments(
  input: ConversationTurnInput,
  transcripts: Transcript[]
): NormalizedTranscriptSegment[] {
  const chapter = input.context.chapter;
  if (!chapter) {
    return [];
  }

  const duration = getChapterDuration(input);
  return transcripts.flatMap((segment) => {
    const usesLegacyGlobalTime =
      segment.start_time > duration + 1
      || segment.end_time > duration + 1
      || segment.start_time < -0.001;
    const offset = usesLegacyGlobalTime ? chapter.startTime : 0;
    const start = Math.min(duration, Math.max(0, segment.start_time - offset));
    const end = Math.min(duration, Math.max(start, segment.end_time - offset));
    if (end <= start || !segment.text.trim()) {
      return [];
    }

    const words = segment.words_json.flatMap((word) => {
      const wordStart = Math.min(duration, Math.max(0, word.start - offset));
      const wordEnd = Math.min(duration, Math.max(wordStart, word.end - offset));
      if (wordEnd <= wordStart || !word.word.trim()) {
        return [];
      }
      return [{ ...word, start: wordStart, end: wordEnd }];
    });

    return [{
      id: segment.id,
      start,
      end,
      text: segment.text,
      words,
    }];
  });
}

export function createLoadFullTranscriptTool(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  loadChapterTranscript: (chapterId: number) => Promise<Transcript[]>
): AgentToolDefinition {
  return defineAgentTool<LoadFullTranscriptInput>({
    name: 'loadFullTranscript',
    description:
      'Load a bounded page of the current chapter transcript for story, pacing, and exact-word evidence. Results include stable evidenceId values that later proposals can cite. Paginate until the requested scope is covered.',
    schema: loadFullTranscriptSchema,
    execute: async ({ startLocalTime, endLocalTime, offset, limit }) => {
      const range = normalizeRange(input, startLocalTime, endLocalTime);
      const allSegments = normalizeTranscriptSegments(
        input,
        await loadChapterTranscript(getChapterId(input))
      );
      const matching = allSegments.filter(
        (segment) => segment.end > range.start && segment.start < range.end
      );
      const safeOffset = Math.max(0, offset ?? 0);
      const safeLimit = Math.min(
        MAX_TRANSCRIPT_EVIDENCE_SEGMENTS,
        Math.max(1, limit ?? DEFAULT_TRANSCRIPT_EVIDENCE_SEGMENTS)
      );
      const page = matching.slice(safeOffset, safeOffset + safeLimit);

      accumulator.evidenceReferences.push(...page.map((segment) => ({
        evidenceId: getSegmentEvidenceId(segment),
        start: segment.start,
        end: segment.end,
        source: 'full_transcript' as const,
        observedAtStep: accumulator.currentStepIndex,
      })));

      const nextOffset = safeOffset + page.length < matching.length
        ? safeOffset + page.length
        : null;
      return JSON.stringify({
        requestedRange: range,
        offset: safeOffset,
        nextOffset,
        totalMatchingSegments: matching.length,
        wordTimestampsAvailable: page.some((segment) => segment.words.length > 0),
        segments: page.map((segment) => ({
          evidenceId: getSegmentEvidenceId(segment),
          start: segment.start,
          end: segment.end,
          text: segment.text,
          words: segment.words,
        })),
      });
    },
  });
}

export function createFindTranscriptEditCandidatesTool(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  loadChapterTranscript: (chapterId: number) => Promise<Transcript[]>
): AgentToolDefinition {
  return defineAgentTool<FindTranscriptEditCandidatesInput>({
    name: 'findTranscriptEditCandidates',
    description:
      'Find deterministic micro-edit evidence from persistent word timestamps: conservative filler words, immediate repetitions, and pauses. Candidates are evidence, not automatic edit decisions; preserve comedic timing and meaning.',
    schema: findTranscriptEditCandidatesSchema,
    execute: async ({
      startLocalTime,
      endLocalTime,
      categories,
      minimumPauseSeconds,
      limit,
    }) => {
      const range = normalizeRange(input, startLocalTime, endLocalTime);
      const transcripts = normalizeTranscriptSegments(
        input,
        await loadChapterTranscript(getChapterId(input))
      );
      const enabled = new Set(categories ?? ['filler', 'repetition', 'pause']);
      const candidates = findEditCandidates(
        transcripts,
        range,
        enabled,
        minimumPauseSeconds ?? 0.8
      ).slice(0, Math.min(
        MAX_TRANSCRIPT_EDIT_CANDIDATES,
        Math.max(1, limit ?? DEFAULT_TRANSCRIPT_EDIT_CANDIDATES)
      ));

      accumulator.evidenceReferences.push(...candidates.map((candidate) => ({
        evidenceId: candidate.evidenceId,
        start: candidate.start,
        end: candidate.end,
        source: 'edit_candidate' as const,
        observedAtStep: accumulator.currentStepIndex,
      })));

      return JSON.stringify({
        requestedRange: range,
        wordTimestampsAvailable: transcripts.some((segment) => segment.words.length > 0),
        candidates,
      });
    },
  });
}

function normalizeWord(value: string): string {
  return value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function formatContext(words: IndexedTranscriptWord[], index: number): string {
  return words
    .slice(Math.max(0, index - 4), Math.min(words.length, index + 5))
    .map((word) => word.word.trim())
    .filter(Boolean)
    .join(' ');
}

function findEditCandidates(
  transcripts: NormalizedTranscriptSegment[],
  range: { start: number; end: number },
  enabled: Set<string>,
  minimumPauseSeconds: number
): TranscriptEditCandidate[] {
  const candidates: TranscriptEditCandidate[] = [];
  const words = transcripts
    .flatMap((segment) => segment.words.map((word, wordIndex) => ({
      ...word,
      segmentId: segment.id,
      wordIndex,
    })))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    const normalized = normalizeWord(word.word);

    if (
      enabled.has('filler')
      && FILLER_WORDS.has(normalized)
      && rangesOverlap(word.start, word.end, range.start, range.end)
    ) {
      candidates.push({
        evidenceId: `transcript-candidate:${word.segmentId}:filler:${word.wordIndex}`,
        category: 'filler',
        start: word.start,
        end: word.end,
        text: word.word.trim(),
        context: formatContext(words, index),
      });
    }

    const previous = words[index - 1];
    if (
      enabled.has('repetition')
      && previous
      && normalized.length > 1
      && normalized === normalizeWord(previous.word)
      && word.start - previous.end <= 1.5
      && rangesOverlap(word.start, word.end, range.start, range.end)
    ) {
      candidates.push({
        evidenceId: `transcript-candidate:${word.segmentId}:repetition:${word.wordIndex}`,
        category: 'repetition',
        start: word.start,
        end: word.end,
        text: word.word.trim(),
        context: formatContext(words, index),
      });
    }

    const next = words[index + 1];
    if (enabled.has('pause') && next) {
      const pauseDuration = next.start - word.end;
      if (
        pauseDuration >= minimumPauseSeconds
        && rangesOverlap(word.end, next.start, range.start, range.end)
      ) {
        candidates.push({
          evidenceId: `transcript-candidate:${word.segmentId}:pause:${word.wordIndex}`,
          category: 'pause',
          start: word.end,
          end: next.start,
          text: `[${pauseDuration.toFixed(2)}s pause]`,
          context: `${word.word.trim()} ... ${next.word.trim()}`,
        });
      }
    }
  }

  return candidates.sort((left, right) => left.start - right.start || left.end - right.end);
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftEnd > rightStart && leftStart < rightEnd;
}
