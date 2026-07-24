import { getClipVisibleRangeInChapter } from "../../../shared/utils/clip-timing.js";
import type { ConversationTurnInput, ProposalDraft } from "../types.js";
import type { ConversationToolAccumulator } from "./create-tools.js";
import { KEEP_WINDOW_REMOVAL_PREFIX } from "./constants.js";

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

    if (proposal.type === 'delete_clip' || proposal.type === 'remove_range') continue;

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
    }

    if (proposal.type === 'delete_clip') {
      validateTargetClipInChapter(input, proposal.clipId, proposal.type);
    }

    if (proposal.type === 'split_clip') {
      validateSplitClipSegments(input, proposal);
    }

    if (proposal.type === 'remove_range') {
      validateRemoveRange(input, proposal);
    }

    if (proposal.type === 'delete_clip' && isExplicitlyReferencedClip(input, proposal.clipId)) {
      continue;
    }

    attachAndValidatePriorEvidence(input, accumulator, proposal);
  }
}

function attachAndValidatePriorEvidence(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  proposal: ProposalDraft
): void {
  const affectedRanges = getProposalAffectedRangesInChapter(input, proposal);
  if (!affectedRanges || affectedRanges.length === 0) {
    throw new Error(`${proposal.type} does not resolve to a valid chapter-local source range.`);
  }

  const requestedIds = new Set(proposal.evidenceIds ?? []);
  const requiresAssetSpecificVideo = proposal.type === 'create_clip'
    && (getGroundedVideoAssetIds(input).length > 1 || input.context.chapterAssetIds.length > 1);
  const eligible = accumulator.evidenceReferences.filter((reference) =>
    reference.observedAtStep < accumulator.currentStepIndex
    && affectedRanges.some((range) =>
      rangesOverlap(range.start, range.end, reference.start, reference.end)
    )
    && (requestedIds.size === 0 || requestedIds.has(reference.evidenceId))
    && (!requiresAssetSpecificVideo || (
      reference.source === 'video'
      && reference.assetId === proposal.assetId
    ))
  );

  if (requestedIds.size > 0) {
    const eligibleIds = new Set(eligible.map((reference) => reference.evidenceId));
    const invalidIds = [...requestedIds].filter((evidenceId) => !eligibleIds.has(evidenceId));
    if (invalidIds.length > 0) {
      throw new Error(
        `Proposal evidence must overlap the affected range and come from an earlier model step. Invalid evidenceIds: ${invalidIds.join(', ')}`
      );
    }
  }

  const uncoveredRange = affectedRanges.find((range) => !eligible.some((reference) =>
    rangesOverlap(range.start, range.end, reference.start, reference.end)
  ));
  if (uncoveredRange) {
    throw new Error(
      'Actionable edits require overlapping transcript or video evidence returned in an earlier model step. Load evidence, observe the result, then draft the proposal.'
    );
  }

  proposal.evidenceIds = [...new Set(eligible.map((reference) => reference.evidenceId))];
}

function isExplicitlyReferencedClip(input: ConversationTurnInput, clipId: number): boolean {
  return (input.context.referencedEntities ?? []).some(
    (entity) => entity.type === 'clip' && entity.id === clipId
  );
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

function validateRemoveRange(
  input: ConversationTurnInput,
  proposal: Extract<ProposalDraft, { type: 'remove_range' }>
): void {
  const targetRange = getChapterLocalClipRange(input, proposal.clipId);
  if (!targetRange) {
    throw new Error(`remove_range target clip ${proposal.clipId} is not available in this chapter.`);
  }
  if (
    proposal.removeEnd <= proposal.removeStart
    || proposal.removeStart < targetRange.start
    || proposal.removeEnd > targetRange.end
  ) {
    throw new Error('remove_range must be a positive chapter-local interval inside the target clip.');
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
    groundedVideoAssetIds.length > 1 ||
    input.context.chapterAssetIds.length > 1
  ) {
    if (proposal.assetId === undefined) {
      throw new Error('assetId is required for create_clip when multiple chapter assets are available.');
    }
  }

  // Single-asset create proposals are validated by range-specific evidence below.
}

function getProposalAffectedRangesInChapter(
  input: ConversationTurnInput,
  proposal: ProposalDraft
): Array<{ start: number; end: number }> | null {
  if (proposal.type === "range_suggestion") {
    return [{ start: proposal.in_point, end: proposal.out_point }];
  }

  if (proposal.type === "create_clip") {
    return [{ start: proposal.inPoint, end: proposal.outPoint }];
  }

  if (proposal.type === 'remove_range') {
    return [{ start: proposal.removeStart, end: proposal.removeEnd }];
  }

  const targetRange = getChapterLocalClipRange(input, proposal.clipId);
  if (!targetRange) {
    return null;
  }

  if (proposal.type === 'delete_clip') {
    return [targetRange];
  }

  if (proposal.type === 'split_clip') {
    const removedRanges: Array<{ start: number; end: number }> = [];
    let cursor = targetRange.start;
    for (const segment of proposal.segments) {
      if (segment.inPoint > cursor) {
        removedRanges.push({ start: cursor, end: segment.inPoint });
      }
      cursor = Math.max(cursor, segment.outPoint);
    }
    if (cursor < targetRange.end) {
      removedRanges.push({ start: cursor, end: targetRange.end });
    }
    return removedRanges.length > 0 ? removedRanges : [targetRange];
  }

  if (proposal.type === 'update_clip') {
    const changedRanges: Array<{ start: number; end: number }> = [];
    if (
      proposal.updates.inPoint !== undefined
      && proposal.updates.inPoint !== targetRange.start
    ) {
      changedRanges.push({
        start: Math.min(targetRange.start, proposal.updates.inPoint),
        end: Math.max(targetRange.start, proposal.updates.inPoint),
      });
    }
    if (
      proposal.updates.outPoint !== undefined
      && proposal.updates.outPoint !== targetRange.end
    ) {
      changedRanges.push({
        start: Math.min(targetRange.end, proposal.updates.outPoint),
        end: Math.max(targetRange.end, proposal.updates.outPoint),
      });
    }
    return changedRanges.length > 0 ? changedRanges : [targetRange];
  }

  return null;
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

  if (clip.inPoint < chapter.startTime || clip.outPoint > chapter.endTime) {
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

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftEnd > rightStart && leftStart < rightEnd;
}
