import type { ConversationTurnInput, EditingIntent, ProposalDraft } from "../types.js";
import type { TimelineAction } from '../../../shared/types/agent-ipc.js';
import type { ConversationToolAccumulator } from "./create-tools.js";
import {
  AgentToolDefinition,
  defineAgentTool,
} from "../../tools/define-tool.js";
import { draftRoughCutProposalsSchema } from "./schemas.js";
import type { DraftRoughCutProposalsInput } from "./schemas.js";
import { validateProposalGrounding, validateKeepWindowDescriptions } from "./grounding.js";

export function createDraftRoughCutProposalsTool(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator
): AgentToolDefinition {
  return defineAgentTool<DraftRoughCutProposalsInput>({
    name: "draftRoughCutProposals",
    description:
      "Create actionable rough-cut proposals after inferring editingIntent. Prefer remove_range for footage to cut; runtime translates it into the compatible update_clip, split_clip, or delete_clip action. Use range_suggestion/create_clip for kept windows and direct structural actions only when they better express the intended result. Set supersedesSuggestionId when revising a pending suggestion. Cite earlier evidenceIds.",
    schema: draftRoughCutProposalsSchema,
    execute: async ({ editingIntent, proposals }) => {
      const accepted = normalizeProposalDrafts(proposals);
      validateProposalGrounding(input, accumulator, accepted);
      validateKeepWindowDescriptions(accepted);
      accumulator.editingIntent = editingIntent ?? inferDefaultEditingIntent(input);

      for (const draft of accepted) {
        if (draft.type === "range_suggestion") {
          accumulator.suggestionDrafts.push({
            in_point: draft.in_point,
            out_point: draft.out_point,
            description: draft.description,
            reasoning: draft.reasoning,
            supersedesSuggestionId: draft.supersedesSuggestionId,
            evidenceIds: draft.evidenceIds,
          });
          continue;
        }

        accumulator.timelineActions.push(
          draft.type === 'remove_range'
            ? translateRemovalToTimelineAction(input, draft)
            : draft
        );
      }

      const rejectedCount = proposals.length - accepted.length;
      return JSON.stringify({
        acceptedCount: accepted.length,
        rejectedCount,
        editingIntent: accumulator.editingIntent,
      });
    },
  });
}

function normalizeProposalDrafts(value: ProposalDraft[]): ProposalDraft[] {
  const normalized: ProposalDraft[] = [];

  for (const item of value) {
    if (item.type === "range_suggestion") {
      if (item.out_point <= item.in_point) {
        continue;
      }
      normalized.push(item);
      continue;
    }

    if (item.type === "create_clip") {
      if (item.outPoint <= item.inPoint) {
        continue;
      }
      normalized.push(item);
      continue;
    }

    if (item.type === 'delete_clip') {
      normalized.push(item);
      continue;
    }

    if (item.type === 'remove_range') {
      if (item.removeEnd <= item.removeStart) continue;
      normalized.push(item);
      continue;
    }

    if (item.type === 'split_clip') {
      if (
        item.segments.length < 2
        || item.segments.some((segment, index) =>
          !Number.isFinite(segment.inPoint)
          || !Number.isFinite(segment.outPoint)
          || segment.outPoint <= segment.inPoint
          || (index > 0 && segment.inPoint < item.segments[index - 1].outPoint)
        )
      ) continue;
      normalized.push(item);
      continue;
    }

    if (Object.keys(item.updates).length === 0) {
      continue;
    }

    if (
      item.updates.inPoint !== undefined &&
      item.updates.outPoint !== undefined &&
      item.updates.outPoint <= item.updates.inPoint
    ) {
      continue;
    }

    normalized.push(item);
  }

  return normalized;
}

function inferDefaultEditingIntent(input: ConversationTurnInput): EditingIntent {
  return {
    scope: input.selectedClipIds.length > 0
      ? 'selected_clips'
      : typeof input.playheadTime === 'number'
        ? 'playhead_region'
        : 'whole_chapter',
    compression: 'balanced',
    protectedBeats: ['setup', 'payoff', 'causal continuity'],
  };
}

export function translateRemovalToTimelineAction(
  input: ConversationTurnInput,
  removal: Extract<ProposalDraft, { type: 'remove_range' }>
): TimelineAction {
  const chapter = input.context.chapter;
  const clip = input.context.chapterClips.find((candidate) => candidate.id === removal.clipId);
  if (!chapter || !clip) {
    throw new Error(`remove_range target clip ${removal.clipId} is not available in this chapter.`);
  }

  const clipStart = clip.inPoint - chapter.startTime;
  const clipEnd = clip.outPoint - chapter.startTime;
  const edgeTolerance = 0.02;
  const base = {
    clipId: removal.clipId,
    reasoning: removal.reasoning,
    supersedesSuggestionId: removal.supersedesSuggestionId,
    evidenceIds: removal.evidenceIds,
  };

  if (
    removal.removeStart <= clipStart + edgeTolerance
    && removal.removeEnd >= clipEnd - edgeTolerance
  ) {
    return { type: 'delete_clip', ...base };
  }

  if (removal.removeStart <= clipStart + edgeTolerance) {
    return {
      type: 'update_clip',
      ...base,
      updates: { inPoint: removal.removeEnd },
    };
  }

  if (removal.removeEnd >= clipEnd - edgeTolerance) {
    return {
      type: 'update_clip',
      ...base,
      updates: { outPoint: removal.removeStart },
    };
  }

  return {
    type: 'split_clip',
    ...base,
    segments: [
      { inPoint: clipStart, outPoint: removal.removeStart },
      { inPoint: removal.removeEnd, outPoint: clipEnd },
    ],
  };
}
