import { getClipVisibleRangeInChapter } from "../../../shared/utils/clip-timing.js";
import type { DetailedTranscriptWindow } from "../../../shared/types/agent-ipc.js";
import type { ConversationTurnInput, ProposalDraft } from "../types.js";
import type { ConversationToolAccumulator } from "./create-tools.js";
import { KEEP_WINDOW_REMOVAL_PREFIX, PLAYHEAD_GROUNDING_WINDOW_SECONDS } from "./constants.js";

export function validateKeepWindowDescriptions(proposals: ProposalDraft[]): void {
  for (const proposal of proposals) {
    if (proposal.type === "range_suggestion") {
      validateKeepWindowDescription(proposal.description, "range_suggestion.description");
      continue;
    }

    if (proposal.type === "create_clip") {
      validateKeepWindowDescription(proposal.description, "create_clip.description");
      continue;
    }

    if (proposal.type === 'delete_clip') continue;

    if (proposal.type === 'split_clip') {
      proposal.segments.forEach((segment, index) => {
        validateKeepWindowDescription(
          segment.description,
          `split_clip.segments[${index}].description`
        );
      });
      continue;
    }

    validateKeepWindowDescription(
      proposal.updates.description ?? undefined,
      "update_clip.updates.description"
    );
  }
}

function validateKeepWindowDescription(
  description: string | null | undefined,
  fieldName: string
): void {
  if (!description || !KEEP_WINDOW_REMOVAL_PREFIX.test(description)) {
    return;
  }

  throw new Error(
    `${fieldName} uses removal-first wording. Describe the kept footage inside the proposed window; put the cut rationale in reasoning.`
  );
}

function getGroundedVideoAssetIds(input: ConversationTurnInput): number[] {
  return input.context.videoAnalysisAssets.map((asset) => asset.assetId);
}

export function validateProposalGrounding(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  proposals: ProposalDraft[]
): void {
  for (const proposal of proposals) {
    if (proposal.type === "create_clip") {
      validateCreateClipGrounding(input, accumulator, proposal);
      continue;
    }

    if (proposal.type === 'delete_clip') {
      validateTargetClipInChapter(input, proposal.clipId, proposal.type);
    }

    if (proposal.type === 'split_clip') {
      validateSplitClipSegments(input, proposal);
    }

    if (!accumulator.hasSuccessfulVideoEvidence && !hasNonVisualProposalGrounding(input, accumulator, proposal)) {
      if (proposal.type !== "range_suggestion") {
        throw new Error(
          "Timeline edits require transcript context, a selected clip, the playhead region, or matching video evidence."
        );
      }

      throw new Error(
        "range_suggestion requires transcript context, detailed transcript windows, the playhead region, or matching video evidence."
      );
    }
  }
}

function validateTargetClipInChapter(
  input: ConversationTurnInput,
  clipId: number,
  proposalType: 'delete_clip' | 'split_clip'
): { start: number; end: number } {
  const targetRange = getChapterLocalClipRange(input, clipId);
  if (!targetRange) {
    throw new Error(`${proposalType} target clip ${clipId} is not available in this chapter.`);
  }
  return targetRange;
}

function validateSplitClipSegments(
  input: ConversationTurnInput,
  proposal: Extract<ProposalDraft, { type: 'split_clip' }>
): void {
  const targetRange = validateTargetClipInChapter(input, proposal.clipId, proposal.type);

  let previousOut = Number.NEGATIVE_INFINITY;
  for (const segment of proposal.segments) {
    if (
      segment.inPoint < targetRange.start
      || segment.outPoint > targetRange.end
      || segment.inPoint < previousOut
    ) {
      throw new Error(
        'split_clip segments must be ordered, non-overlapping kept windows inside the target clip.'
      );
    }
    previousOut = segment.outPoint;
  }
}

function validateCreateClipGrounding(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  proposal: Extract<ProposalDraft, { type: "create_clip" }>
): void {
  const groundedVideoAssetIds = getGroundedVideoAssetIds(input);
  const requiresExplicitAssetId = groundedVideoAssetIds.length > 1;

  if (requiresExplicitAssetId && proposal.assetId === undefined) {
    throw new Error("assetId is required when multiple grounded video assets are available.");
  }

  if (
    typeof proposal.assetId === "number" &&
    accumulator.videoEvidenceAssetIds.has(proposal.assetId)
  ) {
    return;
  }

  if (
    groundedVideoAssetIds.length > 1 ||
    input.context.chapterAssetIds.length > 1
  ) {
    const assetIdDetail =
      typeof proposal.assetId === "number" ? ` for assetId ${proposal.assetId}` : "";
    throw new Error(
      `create_clip${assetIdDetail} requires analyzeChapterVideo evidence for that same asset earlier in the turn.`
    );
  }

  if (
    !hasNonVisualProposalGrounding(
      input,
      accumulator,
      proposal,
      { requirePreciseWindowGrounding: true }
    )
  ) {
    throw new Error(
      "create_clip requires matching video evidence or strong local grounding from detailed transcript windows, selected clips, or the current playhead region."
    );
  }
}

function hasNonVisualProposalGrounding(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  proposal: ProposalDraft,
  options: { requirePreciseWindowGrounding?: boolean } = {}
): boolean {
  const range = getProposalRangeInChapter(input, proposal);
  const detailedTranscriptWindows = getDetailedTranscriptGroundingWindows(input, accumulator);
  const hasDetailedTranscriptAnchor = range
    ? detailedTranscriptWindows.some((window) =>
        rangesOverlap(range.start, range.end, window.windowStart, window.windowEnd)
      )
    : detailedTranscriptWindows.length > 0;
  const hasSelectedClipAnchor = hasSelectedClipGrounding(input, proposal, range);
  const hasPlayheadAnchor = hasPlayheadGrounding(input, range);

  if (options.requirePreciseWindowGrounding) {
    return hasDetailedTranscriptAnchor || hasSelectedClipAnchor || hasPlayheadAnchor;
  }

  return hasTranscriptContext(input, accumulator) || hasDetailedTranscriptAnchor || hasSelectedClipAnchor || hasPlayheadAnchor;
}

function hasTranscriptContext(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator
): boolean {
  return Boolean(input.context.transcript?.trim()) || getDetailedTranscriptGroundingWindows(input, accumulator).length > 0;
}

function getDetailedTranscriptGroundingWindows(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator
): DetailedTranscriptWindow[] {
  return [...input.context.detailedTranscripts, ...accumulator.loadedDetailedTranscripts];
}

function hasSelectedClipGrounding(
  input: ConversationTurnInput,
  proposal: ProposalDraft,
  range: { start: number; end: number } | null
): boolean {
  if (
    proposal.type !== "range_suggestion" && proposal.type !== 'create_clip' &&
    input.selectedClipIds.includes(proposal.clipId)
  ) {
    return true;
  }

  if (!range || input.selectedClipIds.length === 0) {
    return false;
  }

  return input.selectedClipIds.some((clipId) => {
    const selectedRange = getChapterLocalClipRange(input, clipId);
    return selectedRange
      ? rangesOverlap(range.start, range.end, selectedRange.start, selectedRange.end)
      : false;
  });
}

function hasPlayheadGrounding(
  input: ConversationTurnInput,
  range: { start: number; end: number } | null
): boolean {
  const localPlayhead = getChapterLocalPlayheadTime(input);
  if (localPlayhead === null) {
    return false;
  }

  if (!range) {
    return true;
  }

  return rangesOverlap(
    range.start,
    range.end,
    localPlayhead - PLAYHEAD_GROUNDING_WINDOW_SECONDS,
    localPlayhead + PLAYHEAD_GROUNDING_WINDOW_SECONDS
  );
}

function getProposalRangeInChapter(
  input: ConversationTurnInput,
  proposal: ProposalDraft
): { start: number; end: number } | null {
  if (proposal.type === "range_suggestion") {
    return { start: proposal.in_point, end: proposal.out_point };
  }

  if (proposal.type === "create_clip") {
    return { start: proposal.inPoint, end: proposal.outPoint };
  }

  if (proposal.type === 'delete_clip' || proposal.type === 'split_clip') {
    return getChapterLocalClipRange(input, proposal.clipId);
  }

  const existingRange = getChapterLocalClipRange(input, proposal.clipId);
  const start = proposal.updates.inPoint ?? existingRange?.start;
  const end = proposal.updates.outPoint ?? existingRange?.end;

  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    typeof end !== "number" ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return existingRange;
  }

  return { start, end };
}

function getChapterLocalClipRange(
  input: ConversationTurnInput,
  clipId: number
): { start: number; end: number } | null {
  const clip = input.context.chapterClips.find((candidate) => candidate.id === clipId);
  const chapter = input.context.chapter;
  if (!clip || !chapter) {
    return null;
  }

  const visibleRange = getClipVisibleRangeInChapter(
    {
      in_point: clip.inPoint,
      out_point: clip.outPoint,
    },
    {
      start_time: chapter.startTime,
      end_time: chapter.endTime,
    }
  );

  if (!visibleRange) {
    return null;
  }

  const start = Math.max(0, visibleRange.start - chapter.startTime);
  const end = Math.max(start, visibleRange.end - chapter.startTime);
  return end > start ? { start, end } : null;
}

function getChapterLocalPlayheadTime(input: ConversationTurnInput): number | null {
  const chapter = input.context.chapter;
  if (
    !chapter ||
    typeof input.playheadTime !== "number" ||
    !Number.isFinite(input.playheadTime)
  ) {
    return null;
  }

  const chapterDuration = Math.max(0.01, chapter.endTime - chapter.startTime);
  return Math.min(chapterDuration, Math.max(0, input.playheadTime - chapter.startTime));
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftEnd > rightStart && leftStart < rightEnd;
}
