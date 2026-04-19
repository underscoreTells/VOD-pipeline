import type { TurnIntent } from "./types.js";

interface RouteTurnIntentInput {
  latestUserMessage: string;
  selectedClipIds: number[];
  playheadTime?: number;
}

interface RouteTurnIntentResult {
  intent: TurnIntent;
  reason: string;
}

const DISCUSSION_PATTERNS = [
  /\b(story arc|emotional arc|narrative arc|through[- ]line|storyline)\b/i,
  /\b(recap|summari[sz]e|overview|what happens|what happened)\b/i,
  /\b(explain|analysis|analy[sz]e|diagnos(?:e|is)|interpret|commentary|trade[- ]?offs?)\b/i,
  /\b(why does|why did|what is the|how does)\b/i,
];

const PROPOSAL_PATTERNS = [
  /\b(trim|cut|keep|remove|delete|drop|shorten|condense)\b/i,
  /\b(should|what should)\b.{0,24}\b(stay|keep|cut|trim|remove)\b/i,
  /\b(add|insert|create|make|build)\b.{0,24}\bclip/i,
  /\b(new clips?|clip proposals?|timeline edits?|timeline changes?)\b/i,
  /\b(update|replace|move|reorder|rearrange|shift)\b/i,
  /\b(tighten)\b.{0,24}\b(dialogue|opening|intro|ending|sequence|section|scene|moment|segment)\b/i,
];

const AMBIGUOUS_PATTERNS = [
  /\bmake\b.{0,20}\b(better|tighter|stronger|cleaner|snappier|more engaging)\b/i,
  /\b(improve|punch up|fix)\b.{0,20}\b(this|it)\b/i,
  /\b(tighten|improve)\b$/i,
  /^\s*(this|it|here)\s*$/i,
];

const CONTEXT_ANCHORED_PRONOUNS = /\b(this|these|it|here|around here|this section|this part)\b/i;
const STRONG_CONTEXT_ANCHORS = /\b(this|these|here|around here|this section|this part)\b/i;

export function routeTurnIntent({
  latestUserMessage,
  selectedClipIds,
  playheadTime,
}: RouteTurnIntentInput): RouteTurnIntentResult {
  const message = latestUserMessage.trim();
  if (!message) {
    return {
      intent: "discussion",
      reason: "Empty messages fall back to discussion mode.",
    };
  }

  const hasSelectionContext = selectedClipIds.length > 0 || typeof playheadTime === "number";
  const isProposal = PROPOSAL_PATTERNS.some((pattern) => pattern.test(message));
  const isDiscussion = DISCUSSION_PATTERNS.some((pattern) => pattern.test(message));
  const isAmbiguous = AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(message));
  const hasContextPronoun = CONTEXT_ANCHORED_PRONOUNS.test(message);
  const hasStrongContextAnchor = STRONG_CONTEXT_ANCHORS.test(message);

  if (isProposal) {
    return {
      intent: "proposal",
      reason: "The request uses explicit edit or clip-management language.",
    };
  }

  if (isAmbiguous && (!hasSelectionContext || !hasStrongContextAnchor)) {
    return {
      intent: "ambiguous",
      reason: "The request asks for a vague improvement without a concrete rough-cut instruction.",
    };
  }

  if (isDiscussion) {
    return {
      intent: "discussion",
      reason: "The request asks for analysis, explanation, or recap.",
    };
  }

  if (hasSelectionContext && hasContextPronoun) {
    return {
      intent: "proposal",
      reason: "The request refers to the currently selected edit context.",
    };
  }

  return {
    intent: "discussion",
    reason: "Default to discussion when the request does not clearly ask for actionable edits.",
  };
}

export function buildAmbiguousClarificationMessage(): string {
  return "I can help with that, but I need you to be specific about the rough cut. Tell me whether you want trim ranges, new clip proposals, or story notes for the current section.";
}
