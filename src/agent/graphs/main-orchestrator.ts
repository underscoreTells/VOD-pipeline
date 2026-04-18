import { StateGraph, END, START, Send } from "@langchain/langgraph";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createLLM, type LLMConfig, VIDEO_CAPABLE_PROVIDERS } from "../providers/index.js";
import { loadConfig, type AgentConfig, getProviderLLMConfig } from "../config.js";
import { MainState, ChapterState } from "../state/schemas.js";
import { createChapterSubgraph } from "./chapter-subgraph.js";
import { narrativeAnalysisPrompt } from "../prompts/narrative-analysis.js";
import { storyCohesionPrompt } from "../prompts/story-cohesion.js";
import { exportGenerationPrompt } from "../prompts/export-generation.js";
import {
  parseGroundedChatResponse,
  parseTimelineEditResponse,
  parseVisualAnalysisResponse,
} from "../output-parsing.js";
import { createVideoMessage, type VideoProvider } from "../utils/video-messages.js";
import type { LLMProviderType } from "../providers/index.js";
import type {
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from "../../shared/types/agent-ipc.js";

interface CreateMainGraphOptions {
  checkpointer?: any;
}

const CLIP_ROLE_VALUES = ["setup", "escalation", "twist", "payoff", "transition"] as const;

const explicitTimelineEditPatterns = [
  /\b(?:create|make|add|insert)\s+(?:a\s+)?clip\b/,
  /\b(?:edit|update|move|retime)\s+(?:the\s+)?clip\b/,
  /\b(?:trim|cut|shorten|extend|tighten|remove)\b.*\b(?:clip|timeline|intro|outro|section|segment|sequence|transition|continuity|pacing|dead air|repetition)\b/,
  /\b(?:what|which)\s+(?:can|should)\s+(?:i|we)\s+(?:cut|trim|tighten|keep)\b/,
  /\b(?:suggest|propose|make)\s+(?:some\s+)?(?:cuts?|edits?|clips?|timeline changes?)\b/,
  /\b(?:fix|improve|smooth|bridge)\b.*\b(?:transition|continuity|flow|pacing)\b/,
  /\b(?:adjust|change|improve)\b.*\b(?:timeline|pacing|flow|transition|continuity)\b/,
  /\b(?:end|start)\s+(?:with|on)\b/,
];

const timelineEditFollowupPatterns = [
  /\bgood start\b/,
  /\bthose clips\b/,
  /\bthese clips\b/,
  /\brefine\b/,
  /\btighten\b/,
  /\brework\b/,
  /\bbridge\b/,
  /\bcliffhanger\b/,
  /\bnext chapter\b/,
  /\bmake (?:it|this)\b/,
  /\b(?:more|less) aggressive\b/,
  /\bend with\b/,
  /\bmake (?:the )?(?:hook|payoff|callback)\b/,
];

const suggestionRequestPatterns = [
  /\b(?:what|which)\s+(?:can|should)\s+(?:i|we)\s+(?:cut|trim|keep)\b/,
  /\b(?:suggest|propose)\s+(?:some\s+)?(?:cuts?|keeps?|edits?)\b/,
  /\b(?:what|which)\s+(?:sections?|parts?|moments?)\s+(?:should|can)\s+(?:stay|go)\b/,
  /\b(?:trim|cut|tighten|remove)\b.*\b(?:video|chapter|section|segment|sequence|moment|dead air|repetition)\b/,
];

const genericCapabilityKeywords = [
  "what can you do",
  "who are you",
  "which model",
  "api key",
  "provider",
  "help menu",
  "settings",
];

const timelineActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_clip"),
    assetId: z.number().int().positive().optional(),
    trackIndex: z.number().int().min(0).optional(),
    startTime: z.number().finite().min(0).optional(),
    inPoint: z.number().finite().min(0),
    outPoint: z.number().finite().min(0),
    role: z.enum(CLIP_ROLE_VALUES).nullable().optional(),
    description: z.string().nullable().optional(),
    isEssential: z.boolean().optional(),
    reasoning: z.string().optional(),
  }),
  z.object({
    type: z.literal("update_clip"),
    clipId: z.number().int().positive(),
    updates: z
      .object({
        startTime: z.number().finite().min(0).optional(),
        inPoint: z.number().finite().min(0).optional(),
        outPoint: z.number().finite().min(0).optional(),
        role: z.enum(CLIP_ROLE_VALUES).nullable().optional(),
        description: z.string().nullable().optional(),
        isEssential: z.boolean().optional(),
      })
      .refine((value) => Object.keys(value).length > 0, {
        message: "update_clip requires at least one update field",
      }),
    reasoning: z.string().optional(),
  }),
]);

const transcriptDetailRequestSchema = z.object({
  windowStart: z.number().finite().min(0),
  windowEnd: z.number().finite().min(0),
  assetId: z.number().int().positive().optional(),
  reason: z.string().min(1).max(240).optional(),
});

async function chatNode(state: typeof MainState.State, config: any) {
  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig, state.selectedProvider);

  const llm = createLLM(llmConfig);

  config.writer?.({
    type: "progress",
    status: "processing_chat",
    nodeName: "chat_node",
    progress: 0,
  });

  const baseMessages = Array.isArray(state.messages) ? state.messages : [];
  let response;

  if (state.currentChapterId && state.chapterContext) {
    const groundedSystemPrompt = buildGroundedChatSystemPrompt(state);
    response = await llm.invoke([new SystemMessage(groundedSystemPrompt), ...baseMessages] as any);
  } else {
    response = await llm.invoke(baseMessages as any);
  }

  const responseContent =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content ?? "");

  const groundedResponse = state.currentChapterId && state.chapterContext
    ? parseGroundedChatResponse(responseContent)
    : null;
  const assistantResponse = groundedResponse?.assistantResponse ?? responseContent;
  const thinkingMarkdown = groundedResponse?.thinkingMarkdown || undefined;

  config.writer?.({
    type: "progress",
    status: "processing_chat_complete",
    nodeName: "chat_node",
    progress: 100,
  });

  return {
    messages: [new AIMessage(assistantResponse)],
    assistantResponse,
    thinkingMarkdown,
    routingProposalContext: Boolean(state.lastProposalContext),
    lastProposalContext: false,
    timelineActions: undefined,
    transcriptDetailRequests: undefined,
  };
}

async function visualAnalysisNode(state: typeof MainState.State, config: any) {
  // Find the index of the last human message to track analysis (do this before try block so catch can access it)
  const lastHumanMessageIndex = getLastHumanMessageIndex(state.messages as unknown[]);

  try {
    config.writer?.({
      type: "progress",
      status: "analyzing_video",
      nodeName: "visual_analysis",
      progress: 0,
      message: "Preparing video analysis...",
    });

    const agentConfig = await loadConfig();
    const llmConfig = getProviderLLMConfig(agentConfig, state.selectedProvider);
    const llm = createLLM(llmConfig);

    // Get the last human message (not the assistant reply)
    const lastHumanMessage = getLastHumanMessage(state);
    const userQuery = lastHumanMessage && typeof lastHumanMessage.content === "string" 
      ? lastHumanMessage.content 
      : "Analyze this video chapter";

    const allowSuggestions = shouldGenerateVisualSuggestions(userQuery.toLowerCase());

    // Build the analysis prompt
    const analysisPrompt = buildVisualAnalysisPrompt(userQuery, allowSuggestions);

    config.writer?.({
      type: "progress",
      status: "analyzing_video",
      nodeName: "visual_analysis",
      progress: 50,
      message: "Sending video to AI...",
    });

    // Defensive validation: ensure provider supports video and proxy path exists
    if (!state.selectedProvider || !VIDEO_CAPABLE_PROVIDERS.includes(state.selectedProvider)) {
      throw new Error(
        `Provider ${state.selectedProvider || "undefined"} does not support video analysis. ` +
        `Supported providers: ${VIDEO_CAPABLE_PROVIDERS.join(", ")}`
      );
    }
    
    if (!state.proxyPath) {
      throw new Error(
        "No proxy video path available. Please ensure a video chapter is selected and proxy generation is complete."
      );
    }

    // Create multimodal message with video
    const provider = state.selectedProvider as VideoProvider;
    const videoMessage = await createVideoMessage({
      provider,
      videoPath: state.proxyPath,
      textPrompt: analysisPrompt,
      transcriptContext: typeof state.transcript === 'string' ? state.transcript : undefined,
    });

    // Send to LLM
    const response = await llm.invoke([videoMessage]);
    const content = typeof response.content === "string" ? response.content : "";

    config.writer?.({
      type: "progress",
      status: "analyzing_video",
      nodeName: "visual_analysis",
      progress: 100,
      message: "Analysis complete",
    });

    const parsedResponse = parseVisualAnalysisResponse(content);

    return {
      messages: [new AIMessage(parsedResponse.assistantResponse)],
      assistantResponse: parsedResponse.assistantResponse,
      thinkingMarkdown: parsedResponse.thinkingMarkdown || undefined,
      suggestions: allowSuggestions && parsedResponse.suggestions.length > 0
        ? parsedResponse.suggestions
        : undefined,
      lastProposalContext: allowSuggestions && parsedResponse.suggestions.length > 0,
      timelineActions: undefined,
      transcriptDetailRequests: undefined,
      lastAnalyzedMessageIndex: lastHumanMessageIndex,
    };
  } catch (error) {
    console.error("[VisualAnalysis] Error during video analysis:", error);
    
    config.writer?.({
      type: "progress",
      status: "analyzing_video",
      nodeName: "visual_analysis",
      progress: 0,
      message: `Video analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });

    // Return user-visible error message so the graph doesn't crash
    const errorContent = error instanceof Error 
      ? `Sorry, video analysis failed: ${error.message}`
      : "Sorry, video analysis failed. Please try again or check your API keys.";

    return {
      messages: [new AIMessage(errorContent)],
      assistantResponse: errorContent,
      thinkingMarkdown: undefined,
      suggestions: undefined,
      lastProposalContext: false,
      timelineActions: undefined,
      transcriptDetailRequests: undefined,
      // Set lastAnalyzedMessageIndex even on error to prevent repeated retriggering
      lastAnalyzedMessageIndex: lastHumanMessageIndex >= 0 ? lastHumanMessageIndex : undefined,
    };
  }
}

function buildVisualAnalysisPrompt(userQuery: string, allowSuggestions: boolean): string {
  let prompt = `You are a professional video editor analyzing a video chapter.

User question: ${userQuery}

Watch the video and analyze both visual content and dialogue.

Primary goal:
- Preserve and strengthen story progression across the chapter (setup -> escalation -> payoff).

Secondary goal:
- Keep funny moments that improve engagement and pacing, but do not let humor derail story momentum.

${allowSuggestions
  ? `If the user is asking what to keep, cut, tighten, or edit:
- Identify the most important sections to KEEP or CUT.
- For each suggestion, provide a time range, a brief description, and the reasoning.
- Keep the suggestion list focused and practical.`
  : `If the user is asking for analysis, explanation, recap, or diagnosis rather than edit advice:
- Do not make cut/keep recommendations.
- Return SUGGESTIONS_JSON: [].
- Focus on describing what happens, why it matters, and how it affects story progression.`}

Respond in this exact format:

ASSISTANT_RESPONSE:
<Complete user-facing answer for the chat bubble. Do not summarize away important analysis. Do not include raw JSON or suggestion blocks here.>

THINKING_MARKDOWN:
<Optional hidden markdown notes, rationale, or section-by-section reasoning that do not repeat the full answer. Leave blank if there is nothing extra to add. Do not include raw JSON here.>

SUGGESTIONS_JSON:
[
  {"in_point": 120.5, "out_point": 180.0, "description": "Setup scene", "reasoning": "Establishes challenge and builds tension"}
]

Be concrete and actionable. Put the full answer in ASSISTANT_RESPONSE.

If transcript context is provided in a separate text block, use it to align dialogue timing and verify narrative beats.`;

  return prompt;
}

function getMessageType(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  const getter = record._getType;
  if (typeof getter === "function") {
    try {
      const result = getter.call(message);
      if (typeof result === "string") {
        return result;
      }
    } catch {
      // Fall back to role-based detection.
    }
  }

  const role = record.role;
  if (typeof role === "string") {
    const normalizedRole = role.toLowerCase();
    if (normalizedRole === "user") return "human";
    if (normalizedRole === "assistant") return "ai";
    return normalizedRole;
  }

  return undefined;
}

function getLastHumanMessageIndex(messages: unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (getMessageType(messages[i]) === "human") {
      return i;
    }
  }
  return -1;
}

function getLastHumanMessage(state: typeof MainState.State): { content?: unknown } | null {
  const lastHumanMessageIndex = getLastHumanMessageIndex(state.messages as unknown[]);
  if (lastHumanMessageIndex < 0) {
    return null;
  }

  const message = state.messages[lastHumanMessageIndex];
  if (!message || typeof message !== "object") {
    return null;
  }

  return message as { content?: unknown };
}

function hasTimelineEditIntent(content: string): boolean {
  return explicitTimelineEditPatterns.some((pattern) => pattern.test(content));
}

function isGenericCapabilityQuery(content: string): boolean {
  return genericCapabilityKeywords.some((keyword) => content.includes(keyword));
}

function hasTimelineEditFollowupIntent(content: string): boolean {
  return timelineEditFollowupPatterns.some((pattern) => pattern.test(content));
}

function shouldGenerateVisualSuggestions(content: string): boolean {
  return suggestionRequestPatterns.some((pattern) => pattern.test(content));
}

function buildChapterGroundingSystemPrompt(state: typeof MainState.State): string {
  const chapter = state.chapterContext;
  if (!chapter) {
    return "You are an assistant editor for a livestream chapter. Stay concrete and avoid generic stock-video scripts.";
  }

  const chapterDuration = Math.max(0, chapter.endTime - chapter.startTime);
  const transcriptExcerpt = typeof state.transcript === "string"
    ? state.transcript.slice(0, 5000)
    : "";
  const chapterClips = Array.isArray(state.chapterClips) ? state.chapterClips : [];
  const clipPreview = chapterClips
    .slice(0, 18)
    .map((clip) => {
      const localStart = Math.max(0, clip.startTime - chapter.startTime);
      const localIn = Math.max(0, clip.inPoint - chapter.startTime);
      const localOut = Math.max(localIn, clip.outPoint - chapter.startTime);
      return `- clip#${clip.id} timeline=${localStart.toFixed(2)}s source=${localIn.toFixed(2)}-${localOut.toFixed(2)} role=${clip.role ?? "none"} desc=${clip.description ?? ""}`;
    })
    .join("\n");

  return `You are a senior video editing copilot working inside a chapter-based timeline tool.

Active chapter:
- id=${chapter.id}
- title=${chapter.title ?? "Untitled chapter"}
- chapter-global-start=${chapter.startTime.toFixed(2)}s
- chapter-duration=${chapterDuration.toFixed(2)}s

Rules:
- Keep responses grounded in this chapter and the prior conversation history.
- If the user says "those clips", "good start", "refine", "tighten", or asks for continuity/transition, treat it as a follow-up to earlier chapter-specific suggestions.
- Prefer concrete editing instructions and chapter-local timing when appropriate.
- Prioritize narrative continuity and progression over isolated highlight density.
- Preserve strong funny moments when they support momentum, but avoid choices that overshadow story advancement.
- Never switch to generic unrelated templates unless the user explicitly asks for unrelated examples.

Existing chapter clips:
${clipPreview || "- none yet"}

Transcript excerpt:
${transcriptExcerpt || "No transcript excerpt loaded."}`;
}

function buildGroundedChatSystemPrompt(state: typeof MainState.State): string {
  return `${buildChapterGroundingSystemPrompt(state)}

Return exactly two sections:

ASSISTANT_RESPONSE:
<Complete user-facing answer for the chat bubble. Include the full answer, not a summary placeholder.>

THINKING_MARKDOWN:
<Optional hidden markdown notes that add rationale or supporting detail without repeating the full answer. Leave blank if there is nothing extra to add. Do not include raw JSON.>`;
}


function parseTimelineActions(actionsRaw: unknown[]): TimelineAction[] {
  const validated: TimelineAction[] = [];

  for (const action of actionsRaw) {
    const parsed = timelineActionSchema.safeParse(action);
    if (!parsed.success) {
      continue;
    }

    if (parsed.data.type === "create_clip" && parsed.data.outPoint <= parsed.data.inPoint) {
      continue;
    }

    if (
      parsed.data.type === "update_clip" &&
      parsed.data.updates.inPoint !== undefined &&
      parsed.data.updates.outPoint !== undefined &&
      parsed.data.updates.outPoint <= parsed.data.updates.inPoint
    ) {
      continue;
    }

    validated.push(parsed.data as TimelineAction);
  }

  return validated;
}

function parseTranscriptDetailRequests(requestsRaw: unknown[]): TranscriptDetailRequest[] {
  const validated: TranscriptDetailRequest[] = [];

  for (const request of requestsRaw) {
    const parsed = transcriptDetailRequestSchema.safeParse(request);
    if (!parsed.success) {
      continue;
    }

    if (parsed.data.windowEnd <= parsed.data.windowStart) {
      continue;
    }

    validated.push(parsed.data);
  }

  return validated;
}

function formatDetailedTranscriptWindowsForPrompt(
  windows: DetailedTranscriptWindow[] | undefined
): string {
  if (!Array.isArray(windows) || windows.length === 0) {
    return "No detailed windows available.";
  }

  return windows
    .slice(0, 3)
    .map((window) => {
      const segments = Array.isArray(window.segments) ? window.segments : [];
      const segmentLines = segments
        .slice(0, 80)
        .map((segment) => `[${segment.start.toFixed(2)}-${segment.end.toFixed(2)}] ${segment.text}`)
        .join("\n");

      return [
        `window assetId=${window.assetId} range=[${window.windowStart.toFixed(2)}, ${window.windowEnd.toFixed(2)}] reason=${window.reason ?? "n/a"}`,
        `summary=${window.text.slice(0, 1200)}`,
        segmentLines,
      ]
        .filter((line) => line.length > 0)
        .join("\n");
    })
    .join("\n\n");
}

function toShortJson(value: unknown, maxLength: number): string {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxLength) return json;
  return `${json.slice(0, maxLength)}\n...`;
}

function buildTimelineEditPrompt(
  state: typeof MainState.State,
  userRequest: string
): string {
  const chapter = state.chapterContext;
  const chapterDuration = chapter
    ? Math.max(0.01, chapter.endTime - chapter.startTime)
    : undefined;
  const chapterStart = chapter?.startTime ?? 0;

  const chapterSummary = chapter
    ? `Chapter ${chapter.id} (${chapter.title || "Untitled"}), start=${chapter.startTime.toFixed(2)}s, end=${chapter.endTime.toFixed(2)}s, duration=${chapterDuration?.toFixed(2)}s`
    : "No chapter selected";

  const chapterAssetIds = Array.isArray(state.chapterAssetIds)
    ? state.chapterAssetIds
    : [];

  const chapterClips = Array.isArray(state.chapterClips)
    ? state.chapterClips
    : [];

  const clipLines = chapterClips.length
    ? chapterClips.map((clip) => {
        const localStart = clip.startTime - chapterStart;
        const duration = Math.max(0.01, clip.outPoint - clip.inPoint);
        const localEnd = localStart + duration;
        return [
          `clipId=${clip.id}`,
          `assetId=${clip.assetId}`,
          `track=${clip.trackIndex}`,
          `timeline=[${localStart.toFixed(2)}, ${localEnd.toFixed(2)}]`,
          `source=[${(clip.inPoint - chapterStart).toFixed(2)}, ${(clip.outPoint - chapterStart).toFixed(2)}]`,
          `role=${clip.role ?? "null"}`,
          `essential=${clip.isEssential}`,
          `description=${clip.description ?? ""}`,
        ].join(", ");
      }).join("\n")
    : "No clips currently in this chapter.";

  const transcript = typeof state.transcript === "string"
    ? state.transcript.slice(0, 16000)
    : "";

  const detailedTranscripts = Array.isArray(state.detailedTranscripts)
    ? state.detailedTranscripts
    : [];
  const detailedTranscriptPromptBlock = formatDetailedTranscriptWindowsForPrompt(detailedTranscripts).slice(0, 18000);
  const hasDetailedTranscripts = detailedTranscripts.length > 0;

  return `You are an assistant editor. Propose safe timeline edit actions.

User request:
${userRequest}

Context:
- ${chapterSummary}
- chapterAssetIds=${toShortJson(chapterAssetIds, 1200)}
- selectedClipIds=${toShortJson(state.selectedClipIds ?? [], 400)}
- playheadTime=${typeof state.playheadTime === "number" ? state.playheadTime.toFixed(2) : "unknown"} (global seconds)

Available clips (chapter-local timeline):
${clipLines}

Transcript excerpt (chapter-local):
${transcript || "No transcript loaded."}

Detailed transcript windows (chapter-local, high precision):
${detailedTranscriptPromptBlock}

Return exactly three sections:

ASSISTANT_RESPONSE:
<Complete user-facing answer for the chat bubble. Mention that these are proposals when proposals are present.>

THINKING_MARKDOWN:
<Optional hidden markdown notes about rationale, diagnostics, or tradeoffs that do not restate the full answer. Leave blank if there is nothing extra to add. Do not include raw JSON.>

TIMELINE_ACTIONS_JSON:
<A valid JSON array. No markdown fences.>

TRANSCRIPT_DETAIL_REQUESTS_JSON:
<A valid JSON array. No markdown fences.>

Action schema:
1) create_clip
{
  "type": "create_clip",
  "assetId": number,              // optional only if exactly one chapterAssetIds item
  "trackIndex": number,           // optional, default 0
  "startTime": number,            // chapter-local seconds, optional default=inPoint
  "inPoint": number,              // chapter-local seconds
  "outPoint": number,             // chapter-local seconds
  "role": "setup"|"escalation"|"twist"|"payoff"|"transition"|null,
  "description": string|null,
  "isEssential": boolean,
  "reasoning": string
}

2) update_clip
{
  "type": "update_clip",
  "clipId": number,
  "updates": {
    "startTime": number,          // chapter-local seconds
    "inPoint": number,            // chapter-local seconds
    "outPoint": number,           // chapter-local seconds
    "role": "setup"|"escalation"|"twist"|"payoff"|"transition"|null,
    "description": string|null,
    "isEssential": boolean
  },
  "reasoning": string
}

3) transcript detail request
{
  "windowStart": number,         // chapter-local seconds
  "windowEnd": number,           // chapter-local seconds
  "assetId": number,             // optional
  "reason": string               // optional, short justification
}

Rules:
- Use chapter-local seconds only (0 to ${chapterDuration?.toFixed(2) ?? "unknown"}).
- Only propose timeline edits when the user explicitly asks to change the cut, timeline, pacing, continuity, transitions, or existing clip proposals.
- If the user is mainly asking for analysis, explanation, recap, summary, or discussion rather than an edit request, return [] for both TIMELINE_ACTIONS_JSON and TRANSCRIPT_DETAIL_REQUESTS_JSON.
- If request is unclear or non-editing, return [] for both TIMELINE_ACTIONS_JSON and TRANSCRIPT_DETAIL_REQUESTS_JSON.
- Never invent clipId values not listed in context.
- For create_clip, outPoint must be > inPoint.
- For update_clip, only include fields to change.
- Keep proposals minimal and practical.
- Prioritize narrative continuity and story progression over isolated highlight density.
- Keep funny beats when they support pacing, but do not let humor override chapter progression.
- Detailed request windows must be <= 90 seconds each and no more than 3 items.
- When detailed transcript windows are already provided (${hasDetailedTranscripts ? "YES" : "NO"}), do not request more windows.
- If detailed windows are needed first, return [] for TIMELINE_ACTIONS_JSON and populate TRANSCRIPT_DETAIL_REQUESTS_JSON.
- If you can already propose edits, return [] for TRANSCRIPT_DETAIL_REQUESTS_JSON.`;
}

async function timelineEditNode(state: typeof MainState.State, config: any) {
  const lastHumanMessage = getLastHumanMessage(state);
  const userRequest =
    lastHumanMessage && typeof lastHumanMessage.content === "string"
      ? lastHumanMessage.content
      : "";

  if (!userRequest) {
    const fallback = "I can propose timeline edits once you provide a concrete edit request.";
    return {
      messages: [new AIMessage(fallback)],
      assistantResponse: fallback,
      thinkingMarkdown: undefined,
      lastProposalContext: false,
      timelineActions: undefined,
      transcriptDetailRequests: undefined,
    };
  }

  if (!state.currentChapterId || !state.chapterContext) {
    const fallback = "I can propose timeline edits after you select a chapter.";
    return {
      messages: [new AIMessage(fallback)],
      assistantResponse: fallback,
      thinkingMarkdown: undefined,
      lastProposalContext: false,
      timelineActions: undefined,
      transcriptDetailRequests: undefined,
    };
  }

  try {
    config.writer?.({
      type: "progress",
      status: "planning_timeline_edits",
      nodeName: "timeline_edit",
      progress: 0,
    });

    const agentConfig = await loadConfig();
    const llmConfig = getProviderLLMConfig(agentConfig, state.selectedProvider);
    const llm = createLLM(llmConfig);

    const prompt = buildTimelineEditPrompt(state, userRequest);
    const response = await llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content ?? "");

    const parsedResponse = parseTimelineEditResponse(content);
    const timelineActions = parseTimelineActions(parsedResponse.timelineActions);
    const requestedDetails = parseTranscriptDetailRequests(parsedResponse.transcriptDetailRequests);
    const hasDetailedTranscripts = Array.isArray(state.detailedTranscripts) && state.detailedTranscripts.length > 0;
    const transcriptDetailRequests = hasDetailedTranscripts ? [] : requestedDetails;
    const finalActions = transcriptDetailRequests.length > 0 ? [] : timelineActions;

    config.writer?.({
      type: "progress",
      status: "planning_timeline_edits_complete",
      nodeName: "timeline_edit",
      progress: 100,
    });

    return {
      messages: [new AIMessage(parsedResponse.assistantResponse)],
      assistantResponse: parsedResponse.assistantResponse,
      thinkingMarkdown: parsedResponse.thinkingMarkdown || undefined,
      timelineActions: finalActions.length > 0 ? finalActions : undefined,
      lastProposalContext: finalActions.length > 0,
      transcriptDetailRequests:
        transcriptDetailRequests.length > 0 ? transcriptDetailRequests : undefined,
      suggestions: undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `I could not generate timeline edit proposals: ${error.message}`
        : "I could not generate timeline edit proposals.";
    return {
      messages: [new AIMessage(message)],
      assistantResponse: message,
      thinkingMarkdown: undefined,
      lastProposalContext: false,
      timelineActions: undefined,
      transcriptDetailRequests: undefined,
      suggestions: undefined,
    };
  }
}

export function shouldContinueChat(state: typeof MainState.State): string {
  const lastHumanMessage = getLastHumanMessage(state);
  const content = lastHumanMessage && typeof lastHumanMessage.content === "string"
    ? lastHumanMessage.content.toLowerCase()
    : "";

  if (
    content.includes("analyze chapters") ||
    content.includes("start analysis") ||
    content.includes("process chapters")
  ) {
    return "dispatch_chapters";
  }

  // Check if we should do visual analysis
  // Requires: active chapter, video-capable provider, video intent
  if (state.selectedProvider && 
      VIDEO_CAPABLE_PROVIDERS.includes(state.selectedProvider) &&
      state.currentChapterId &&
      state.proxyPath) {
    const videoIntentKeywords = [
      "watch", "video", "visual", "see", "look", "analyze video",
      "what's in the video", "what happens", "show me", "review video"
    ];
    
    if (videoIntentKeywords.some(kw => content.includes(kw))) {
      // Find the index of the last human message
      const lastHumanMessageIndex = getLastHumanMessageIndex(state.messages as unknown[]);
      
      // Prevent repeated analysis: only analyze if we haven't analyzed this message yet
      if (lastHumanMessageIndex !== state.lastAnalyzedMessageIndex) {
        return "visual_analysis";
      }
    }
  }

  const hasChapterContext = Boolean(state.currentChapterId && state.chapterContext);
  if (hasTimelineEditIntent(content)) {
    return "timeline_edit";
  }

  if (hasChapterContext && state.routingProposalContext && hasTimelineEditFollowupIntent(content)) {
    return "timeline_edit";
  }

  return "done";
}

async function dispatchChaptersNode(
  state: typeof MainState.State,
  config: any
) {
  const chapterCount = Array.isArray(state.chapters) ? state.chapters.length : 0;

  config.writer?.({
    type: "progress",
    status: "dispatching_chapters",
    nodeName: "dispatch_chapters",
    progress: 0,
    message: `Dispatching ${chapterCount} chapter${chapterCount === 1 ? "" : "s"}`,
  });

  config.writer?.({
    type: "progress",
    status: "dispatching_chapters_complete",
    nodeName: "dispatch_chapters",
    progress: 100,
  });

  return {};
}

function routeChapterDispatch(
  state: typeof MainState.State
): Array<Send> | typeof END {
  const chapters = Array.isArray(state.chapters) ? state.chapters : [];
  if (chapters.length === 0) {
    return END;
  }

  return chapters.map(
    (chapter) =>
      new Send("chapter_agent", {
        chapterId: chapter.id,
        transcript: chapter.transcript || "",
        instructions: `Analyze chapter ${chapter.id} for narrative structure and beats.`,
      })
  );
}

async function chapterAgentNode(
  state: typeof MainState.State,
  config: any
) {
  config.writer?.({
    type: "progress",
    status: "running_chapter_agents",
    nodeName: "chapter_agent",
    progress: 0,
  });

  config.writer?.({
    type: "progress",
    status: "chapter_agents_complete",
    nodeName: "chapter_agent",
    progress: 100,
  });

  return state;
}

async function storyCohesionNode(
  state: typeof MainState.State,
  config: any
) {
  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig);

  const llm = createLLM(llmConfig);

  config.writer?.({
    type: "progress",
    status: "analyzing_story_cohesion",
    nodeName: "story_cohesion",
    progress: 0,
  });

  const chaptersData = Object.entries(state.chapterSummaries || {}).map(
    ([chapterId, summary]) => ({
      chapterId,
      summary,
      beats: state.chapterBeats[chapterId] || [],
    })
  );

  const prompt = await storyCohesionPrompt.format({
    chapters_data: JSON.stringify(chaptersData, null, 2),
  });

  const response = await llm.invoke(prompt);

  config.writer?.({
    type: "progress",
    status: "analyzing_story_cohesion_complete",
    nodeName: "story_cohesion",
    progress: 100,
  });

  let result: any = {};
  try {
    const content =
      typeof response.content === "string" ? response.content : "";
    result = JSON.parse(content);
  } catch (error) {
    console.error("[StoryCohesion] Failed to parse response:", error);
  }

  return {
    exports: {
      cuts: state.chapterBeats,
      storyAnalysis: result,
    },
  };
}

async function generateExportsNode(
  state: typeof MainState.State,
  config: any
) {
  config.writer?.({
    type: "progress",
    status: "generating_exports",
    nodeName: "generate_exports",
    progress: 0,
  });

    const cutList: any = {
      projectId: state.projectId,
      projectName: "VOD Pipeline Project",
      format: "vod-pipeline-cutlist-v1",
      created: new Date().toISOString(),
      cuts: [],
    };

  for (const [chapterId, beats] of Object.entries(state.chapterBeats || {})) {
    const chapter = state.chapters.find((c) => c.id === chapterId);
    if (!chapter || !beats || beats.length === 0) continue;

    const essentialBeats = beats.filter((b: any) => b.essential !== false);

    if (essentialBeats.length === 0) continue;

    const firstBeat = essentialBeats[0] as any;
    const lastBeat = essentialBeats[essentialBeats.length - 1] as any;

    cutList.cuts.push({
      chapterId,
      chapterTitle: `Chapter ${chapterId}`,
      assetPath: "",
      inTime: firstBeat.start_time,
      outTime: lastBeat.end_time,
      duration: lastBeat.end_time - firstBeat.start_time,
      label: firstBeat.type,
      notes: firstBeat.why_essential,
      beats: essentialBeats,
      optionalSegments: [],
    });
  }

  config.writer?.({
    type: "progress",
    status: "generating_exports_complete",
    nodeName: "generate_exports",
    progress: 100,
  });

  return {
    exports: state.exports
      ? {
          ...state.exports,
          cuts: cutList.cuts,
        }
      : {
          cuts: cutList.cuts,
        },
  };
}

export async function createMainGraph({ checkpointer }: CreateMainGraphOptions) {
  const workflow = new StateGraph(MainState)
    .addNode("chat_node", chatNode as any)
    .addNode("visual_analysis", visualAnalysisNode as any)
    .addNode("timeline_edit", timelineEditNode as any)
    .addNode("dispatch_chapters", dispatchChaptersNode as any)
    .addNode("chapter_agent", await createChapterSubgraph())
    .addNode("story_cohesion", storyCohesionNode as any)
    .addNode("generate_exports", generateExportsNode as any)
    .addEdge(START, "chat_node")
    .addConditionalEdges("chat_node", shouldContinueChat, {
      done: END,
      dispatch_chapters: "dispatch_chapters",
      visual_analysis: "visual_analysis",
      timeline_edit: "timeline_edit",
    } as any)
    .addConditionalEdges("dispatch_chapters", routeChapterDispatch, ["chapter_agent", END] as any)
    .addEdge("visual_analysis", END)
    .addEdge("timeline_edit", END)
    .addEdge("chapter_agent", "story_cohesion")
    .addEdge("story_cohesion", "generate_exports")
    .addEdge("generate_exports", END);

  const compiledGraph = checkpointer
    ? workflow.compile({ checkpointer })
    : workflow.compile();

  return compiledGraph;
}
