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
  const chapterLocalPlayheadTime =
    chapter && typeof input.playheadTime === "number" && Number.isFinite(input.playheadTime)
      ? Math.min(chapterDuration, Math.max(0, input.playheadTime - chapter.startTime))
      : undefined;
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
- playheadTimeGlobal=${typeof input.playheadTime === "number" ? input.playheadTime.toFixed(2) : "unknown"}
- playheadTimeChapterLocal=${typeof chapterLocalPlayheadTime === "number" ? chapterLocalPlayheadTime.toFixed(2) : "unknown"}

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
- If the user asks to make the cut tighter, faster, cleaner, more engaging, less fluffy, or to improve the current section, prefer drafting at least one concrete proposal instead of asking for clarification.
- Use clarification only when there is no local anchor from transcript context, detailed transcript windows, selected clips, or the playhead region and you cannot safely draft even one grounded proposal.
- Default editorial bias: cut dead air, repeated explanation, reset loops, stalled tangents, and humor that stops story momentum.
- Preserve setup -> escalation -> payoff continuity, strong transitions, exact payoff wording, and humor that improves pacing or meaningfully pays off a setup.
- Use chapter-local seconds only for any actionable edit proposal.
- For clips, inPoint/outPoint describe the kept source window.
- Chapter clip order is inferred from source timing, so do not propose timeline gaps or manual repositioning.
- Use create_clip and update_clip only to define or revise source windows and metadata.
- Prioritize narrative continuity and story progression over isolated highlight density.
- Do not invent clip identifiers or asset identifiers.
- Use evidence tools when they are needed for factual verification.
- Use loadDetailedTranscriptWindows for exact dialogue wording and timing.
- Use analyzeChapterVideo when visual confirmation matters, when a beat depends on on-screen action or reaction, when choosing between multiple source assets, or when a proposal depends on visuals rather than dialogue or pacing alone.
- range_suggestion and update_clip can be grounded by transcript context, detailed transcript windows, selected clips, or the current playhead region even without a same-turn video call.
- create_clip requires stronger grounding. Use matching analyzeChapterVideo evidence for multi-asset or visually dependent clips, and otherwise keep the clip anchored to the currently grounded local context.
- If multiple grounded video assets are available, analyzeChapterVideo must specify assetId and create_clip must specify assetId.
- If you provide actionable rough-cut edits, you MUST call draftRoughCutProposals first.
- Never describe concrete trims, clip inserts, clip updates, or reorder proposals only in prose.
- If the request is too unclear to answer safely or too underspecified for edits, end with clarification.
- End every turn by calling finalizeConversationTurn exactly once.
- finalizeConversationTurn(outcome="proposal") is only valid after at least one actionable proposal draft has been accepted this turn.
- finalizeConversationTurn(outcome="discussion") is only valid when you did not draft any actionable proposals this turn.
- finalizeConversationTurn(outcome="clarification") should ask one concrete question that unblocks the next turn only after you cannot safely draft even one grounded proposal.
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
