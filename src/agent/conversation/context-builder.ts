import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { ConversationTurnInput } from "./types.js";
import { getClipVisibleRangeInChapter } from "../../shared/utils/clip-timing.js";

const TRANSCRIPT_PREVIEW_CHARS = 12000;
const MAX_CLIP_PREVIEW_LINES = 18;
const MAX_DETAILED_TRANSCRIPT_LINES = 3;

export function buildConversationMessages(
  input: ConversationTurnInput
): BaseMessage[] {
  return [new SystemMessage(buildConversationSystemPrompt(input)), ...input.messages];
}

export function buildConversationSystemPrompt(input: ConversationTurnInput): string {
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
      const visibleRange = chapter
        ? getClipVisibleRangeInChapter(
            {
              in_point: clip.inPoint,
              out_point: clip.outPoint,
            },
            {
              start_time: chapter.startTime,
              end_time: chapter.endTime,
            }
          )
        : {
            start: clip.inPoint,
            end: clip.outPoint,
          };
      const localIn = chapter
        ? Math.max(0, (visibleRange?.start ?? clip.inPoint) - chapter.startTime)
        : clip.inPoint;
      const localOut = chapter
        ? Math.max(localIn, (visibleRange?.end ?? clip.outPoint) - chapter.startTime)
        : clip.outPoint;
      return `- clip#${clip.id} source=${localIn.toFixed(
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
  const groundedVideoAssetIds = input.context.videoAnalysisAssets.map((asset) => asset.assetId);

  const suggestionSummary =
    typeof input.context.suggestionSummary === "string" && input.context.suggestionSummary.trim().length > 0
      ? input.context.suggestionSummary.trim()
      : "- none";

  return `You are a senior rough-cut video editing copilot working inside a chapter-based timeline tool.

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

Grounded video assets available for analysis:
${groundedVideoAssetIds.length > 0 ? `- [${groundedVideoAssetIds.join(", ")}]` : "- none"}

Existing proposal summary for this conversation:
${suggestionSummary}

Rules:
- Use chapter-local seconds only for any actionable edit proposal.
- For clips, inPoint/outPoint describe the kept source window.
- Chapter clip order is inferred from source timing, so do not propose timeline gaps or manual repositioning.
- Use create_clip and update_clip only to define or revise source windows and metadata.
- Prioritize narrative continuity and story progression over isolated highlight density.
- Do not invent clip identifiers or asset identifiers.
- Use evidence tools when they are needed for factual verification.
- Use analyzeChapterVideo for on-screen evidence and loadDetailedTranscriptWindows for exact dialogue timing.
- All actionable proposals require successful analyzeChapterVideo evidence in the same turn.
- If video evidence is unavailable, do not draft proposals. Finalize as clarification and explain that the video proxy is not ready.
- If multiple grounded video assets are available, analyzeChapterVideo must specify assetId and create_clip must specify assetId.
- If you provide actionable rough-cut edits, you MUST call draftRoughCutProposals first.
- Never describe concrete trims, clip inserts, clip updates, or reorder proposals only in prose.
- If the request is too unclear to answer safely or too underspecified for edits, end with clarification.
- End every turn by calling finalizeConversationTurn exactly once.
- finalizeConversationTurn(outcome="proposal") is only valid after at least one actionable proposal draft has been accepted this turn.
- finalizeConversationTurn(outcome="discussion") is only valid when you did not draft any actionable proposals this turn.
- finalizeConversationTurn(outcome="clarification") should ask one concrete question that unblocks the next turn.
- The user sees assistantResponse from finalizeConversationTurn directly in chat.
- Do not output JSON in assistantResponse.`;
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
