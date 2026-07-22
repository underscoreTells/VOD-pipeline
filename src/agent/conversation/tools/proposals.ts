import type { ConversationTurnInput, ProposalDraft } from "../types.js";
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
      "Create actionable rough-cut proposals. Use range_suggestion/create_clip for kept windows, update_clip for trims or metadata, delete_clip to remove a committed clip, and split_clip to divide one at a chapter-local source time. Set supersedesSuggestionId when revising a pending suggestion; the original remains in audit history. Do not describe actionable edits only in prose.",
    schema: draftRoughCutProposalsSchema,
    execute: async ({ proposals }) => {
      const accepted = normalizeProposalDrafts(proposals);
      validateProposalGrounding(input, accumulator, accepted);
      validateKeepWindowDescriptions(accepted);

      for (const draft of accepted) {
        if (draft.type === "range_suggestion") {
          accumulator.suggestionDrafts.push({
            in_point: draft.in_point,
            out_point: draft.out_point,
            description: draft.description,
            reasoning: draft.reasoning,
          });
          continue;
        }

        accumulator.timelineActions.push(draft);
      }

      const rejectedCount = proposals.length - accepted.length;
      return JSON.stringify({
        acceptedCount: accepted.length,
        rejectedCount,
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

    if (item.type === 'split_clip') {
      if (!Number.isFinite(item.splitPoint)) continue;
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
