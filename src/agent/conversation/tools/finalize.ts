import type { ConversationToolAccumulator } from "./create-tools.js";
import {
  AgentToolDefinition,
  defineAgentTool,
} from "../../tools/define-tool.js";
import { finalizeConversationTurnSchema } from "./schemas.js";
import type { FinalizeConversationTurnInput } from "./schemas.js";

export function createFinalizeConversationTurnTool(
  accumulator: ConversationToolAccumulator
): AgentToolDefinition {
  return defineAgentTool<FinalizeConversationTurnInput>({
    name: "finalizeConversationTurn",
    description:
      "Terminate the turn exactly once with the declared outcome and the assistantResponse that should be shown to the user.",
    schema: finalizeConversationTurnSchema,
    execute: async ({ outcome, assistantResponse }) => {
      const normalizedAssistantResponse = assistantResponse.trim();
      if (!normalizedAssistantResponse) {
        throw new Error("assistantResponse must include visible user-facing text.");
      }

      const hasDrafts =
        accumulator.suggestionDrafts.length > 0 || accumulator.timelineActions.length > 0;

      if (outcome === "proposal" && !hasDrafts) {
        throw new Error(
          "A proposal turn must include at least one accepted draftRoughCutProposals result before finalizing."
        );
      }

      if (outcome === "discussion" && hasDrafts) {
        throw new Error(
          "A discussion turn cannot finalize after drafting actionable proposals. Use proposal or clarification instead."
        );
      }

      accumulator.finalOutcome = outcome;
      accumulator.finalAssistantResponse = normalizedAssistantResponse;

      return JSON.stringify({
        outcome,
        assistantResponse: accumulator.finalAssistantResponse,
      });
    },
  });
}
