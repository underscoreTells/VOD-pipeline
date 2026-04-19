import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { ConversationTurnInput, TurnIntent } from "./types.js";

const TRANSCRIPT_PREVIEW_CHARS = 12000;
const MAX_CLIP_PREVIEW_LINES = 18;
const MAX_DETAILED_TRANSCRIPT_LINES = 3;

export function buildConversationMessages(
  input: ConversationTurnInput,
  intent: TurnIntent
): BaseMessage[] {
  return [new SystemMessage(buildConversationSystemPrompt(input, intent)), ...input.messages];
}

export function buildConversationSystemPrompt(
  input: ConversationTurnInput,
  intent: TurnIntent
): string {
  const chapter = input.context.chapter;
  const chapterDuration = chapter
    ? Math.max(0, chapter.endTime - chapter.startTime)
    : 0;
  const transcriptPreview =
    typeof input.context.transcript === "string"
      ? input.context.transcript.slice(0, TRANSCRIPT_PREVIEW_CHARS)
      : "";
  const clipPreview = input.context.chapterClips
    .slice(0, MAX_CLIP_PREVIEW_LINES)
    .map((clip) => {
      const localStart = chapter ? Math.max(0, clip.startTime - chapter.startTime) : clip.startTime;
      const localIn = chapter ? Math.max(0, clip.inPoint - chapter.startTime) : clip.inPoint;
      const localOut = chapter ? Math.max(localIn, clip.outPoint - chapter.startTime) : clip.outPoint;
      return `- clip#${clip.id} timeline=${localStart.toFixed(2)}s source=${localIn.toFixed(
        2
      )}-${localOut.toFixed(2)} role=${clip.role ?? "none"} desc=${clip.description ?? ""}`;
    })
    .join("\n");

  const detailedTranscriptSummary = input.context.detailedTranscripts
    .slice(0, MAX_DETAILED_TRANSCRIPT_LINES)
    .map(
      (window) =>
        `- asset=${window.assetId} range=${window.windowStart.toFixed(2)}-${window.windowEnd.toFixed(
          2
        )} reason=${window.reason ?? "n/a"}`
    )
    .join("\n");

  const suggestionSummary =
    typeof input.context.suggestionSummary === "string" && input.context.suggestionSummary.trim().length > 0
      ? input.context.suggestionSummary.trim()
      : "- none";

  const basePrompt = `You are a senior rough-cut video editing copilot working inside a chapter-based timeline tool.

Active chapter:
- id=${chapter?.id ?? "none"}
- title=${chapter?.title ?? "Untitled chapter"}
- chapter-global-start=${chapter ? chapter.startTime.toFixed(2) : "0.00"}s
- chapter-duration=${chapter ? chapterDuration.toFixed(2) : "0.00"}s
- selectedClipIds=${JSON.stringify(input.selectedClipIds)}
- playheadTime=${typeof input.playheadTime === "number" ? input.playheadTime.toFixed(2) : "unknown"}

Existing chapter clips:
${clipPreview || "- none yet"}

Transcript excerpt:
${transcriptPreview || "No transcript excerpt loaded."}

Detailed transcript windows already in context:
${detailedTranscriptSummary || "- none loaded"}

Existing proposal summary for this conversation:
${suggestionSummary}

Rules:
- Use chapter-local seconds only for any actionable edit proposal.
- Prioritize narrative continuity and story progression over isolated highlight density.
- Do not invent clip identifiers or asset identifiers.
- Do not output JSON in your final assistant text.
- The user sees your final assistant text directly in chat.`;

  if (intent === "proposal") {
    return `${basePrompt}

This is a PROPOSAL turn.

Additional rules:
- If you need factual visual confirmation, call analyzeChapterVideo.
- If you need exact dialogue timing, call loadDetailedTranscriptWindows.
- When you are ready to propose actionable rough-cut edits, you MUST call draftRoughCutProposals before giving final assistant text.
- If the request is still too vague or timing is too uncertain, call requestClarification instead of guessing.
- Do not describe concrete trims, clip inserts, clip updates, or reorder proposals only in prose.
- Your final assistant text should briefly summarize the drafted proposals after draftRoughCutProposals succeeds.`;
  }

  return `${basePrompt}

This is a DISCUSSION turn.

Additional rules:
- You may use analyzeChapterVideo or loadDetailedTranscriptWindows when they are needed for evidence.
- Do not create actionable rough-cut proposals in this turn.
- Answer directly and concisely in plain text.`;
}

export function normalizeConversationMessages(
  messages: Array<{ role: string; content: string }>
): BaseMessage[] {
  return messages.map((message) => {
    const content =
      typeof message.content === "string" ? message.content : String(message.content ?? "");
    const role = typeof message.role === "string" ? message.role.toLowerCase() : "user";

    if (role === "assistant" || role === "ai") {
      return new AIMessage(content);
    }

    if (role === "system") {
      return new SystemMessage(content);
    }

    return new HumanMessage(content);
  });
}
