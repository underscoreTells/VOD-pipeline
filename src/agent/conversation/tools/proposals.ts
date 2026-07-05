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
      "Create actionable rough-cut proposals. Use range_suggestion as a keep-only shorthand for the kept source window, create_clip for new clips, and update_clip for existing clip edits. Descriptions must describe the kept footage inside the proposed window or updated clip, while reasoning can explain what the edit skips or trims. Transcript context, detailed transcript windows, selected clips, and the playhead region can ground trims and clip updates without a same-turn video call. Use analyzeChapterVideo when visual confirmation or multi-asset clip creation matters. Clips are source excerpts only, so proposal timing is defined entirely by inPoint/outPoint. Do not describe actionable edits only in prose.",
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
