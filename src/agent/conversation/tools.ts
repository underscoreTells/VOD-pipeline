import { z, ZodError } from "zod";
import { loadConfig, getProviderLLMConfig } from "../config.js";
import { createLLM, VIDEO_CAPABLE_PROVIDERS } from "../providers/index.js";
import { createVideoMessage, type VideoProvider } from "../utils/video-messages.js";
import type {
  AgentSuggestionDraft,
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from "../../shared/types/agent-ipc.js";
import {
  generateDetailedTranscriptsForRequests,
  normalizeTranscriptDetailRequests,
} from "../../shared/utils/detailed-transcript-tools.js";
import { getClipVisibleRangeInChapter } from "../../shared/utils/clip-timing.js";
import type {
  ConversationTurnInput,
  ConversationWriter,
  ProposalDraft,
  TurnOutcome,
} from "./types.js";
import {
  AgentToolDefinition,
  defineAgentTool,
} from "../tools/define-tool.js";
import { isExecutableToolValidationError } from "../tools/binding.js";
import { canonicalSchema as s } from "../tools/schema.js";
import { getMessageText } from "./provider-adapter.js";

const MAX_VIDEO_OBSERVATIONS = 12;
const MAX_PROPOSAL_DRAFTS = 16;
const MAX_TRANSCRIPT_WINDOW_REQUESTS = 3;
const CLIP_ROLE_VALUES = ["setup", "escalation", "twist", "payoff", "transition"] as const;
const TURN_OUTCOME_VALUES = ["discussion", "proposal", "clarification"] as const;
const PLAYHEAD_GROUNDING_WINDOW_SECONDS = 45;
const KEEP_WINDOW_REMOVAL_PREFIX = /^\s*(cut|remove|trim|drop|skip|omit|delete)\b/i;

export interface ConversationToolDependencies {
  analyzeChapterVideo?: (
    input: ConversationTurnInput,
    request: AnalyzeChapterVideoInput
  ) => Promise<{
    assetId?: number;
    summary: string;
    observations: Array<{
      in_point?: number;
      out_point?: number;
      note: string;
    }>;
  }>;
  loadDetailedTranscriptWindows?: (
    input: ConversationTurnInput,
    requests: TranscriptDetailRequest[]
  ) => Promise<DetailedTranscriptWindow[]>;
}

export interface ConversationToolAccumulator {
  suggestionDrafts: AgentSuggestionDraft[];
  timelineActions: TimelineAction[];
  transcriptDetailRequests: TranscriptDetailRequest[];
  loadedDetailedTranscripts: DetailedTranscriptWindow[];
  hasSuccessfulVideoEvidence: boolean;
  videoEvidenceAssetIds: Set<number>;
  finalOutcome?: TurnOutcome;
  finalAssistantResponse?: string;
}

interface AnalyzeChapterVideoInput {
  focus: string;
  assetId?: number;
}

interface LoadDetailedTranscriptWindowsInput {
  requests: TranscriptDetailRequest[];
}

interface DraftRoughCutProposalsInput {
  proposals: ProposalDraft[];
}

interface FinalizeConversationTurnInput {
  outcome: TurnOutcome;
  assistantResponse: string;
}

const rangeSuggestionSchema = s.object(
  {
    type: s.required(s.literalString("range_suggestion")),
    in_point: s.required(s.number({ minimum: 0 })),
    out_point: s.required(s.number({ minimum: 0 })),
    description: s.optional(
      s.string({
        minLength: 1,
        maxLength: 240,
      })
    ),
    reasoning: s.optional(
      s.string({
        minLength: 1,
        maxLength: 400,
      })
    ),
  },
  { description: "Suggest a kept source window using chapter-local seconds." }
);

const createClipSchema = s.object(
  {
    type: s.required(s.literalString("create_clip")),
    assetId: s.optional(s.integer({ minimum: 1 })),
    trackIndex: s.optional(s.integer({ minimum: 0 })),
    inPoint: s.required(s.number({ minimum: 0 })),
    outPoint: s.required(s.number({ minimum: 0 })),
    role: s.optional(s.nullable(s.stringEnum(CLIP_ROLE_VALUES))),
    description: s.optional(
      s.string({
        minLength: 1,
        maxLength: 240,
      })
    ),
    isEssential: s.optional(s.boolean()),
    reasoning: s.optional(
      s.string({
        minLength: 1,
        maxLength: 400,
      })
    ),
  },
  {
    description:
      "Create a new clip by defining the kept source window using chapter-local source points only."
  }
);

const updateClipSchema = s.object(
  {
    type: s.required(s.literalString("update_clip")),
    clipId: s.required(s.integer({ minimum: 1 })),
    updates: s.required(
      s.object(
        {
          inPoint: s.optional(s.number({ minimum: 0 })),
          outPoint: s.optional(s.number({ minimum: 0 })),
          role: s.optional(s.nullable(s.stringEnum(CLIP_ROLE_VALUES))),
          description: s.optional(
            s.nullable(
              s.string({
                minLength: 1,
                maxLength: 240,
              })
            )
          ),
          isEssential: s.optional(s.boolean()),
        },
        {
          description: "Fields to update on the target clip.",
          minProperties: 1,
        }
      )
    ),
    reasoning: s.optional(
      s.string({
        minLength: 1,
        maxLength: 400,
      })
    ),
  },
  {
    description:
      "Update an existing clip by id using chapter-local kept source points and metadata only."
  }
);

const draftRoughCutProposalsSchema = s.object(
  {
    proposals: s.required(
      s.array(
        s.discriminatedUnion("type", [rangeSuggestionSchema, createClipSchema, updateClipSchema]),
        {
          minItems: 1,
          maxItems: MAX_PROPOSAL_DRAFTS,
        }
      )
    ),
  },
  { description: "One or more rough-cut proposals for the chapter." }
);

const transcriptDetailRequestSchema = s.object(
  {
    windowStart: s.required(s.number({ minimum: 0 })),
    windowEnd: s.required(s.number({ minimum: 0 })),
    assetId: s.optional(s.integer({ minimum: 1 })),
    reason: s.optional(
      s.string({
        minLength: 1,
        maxLength: 240,
      })
    ),
  },
  { description: "Request an exact transcript window for a chapter-local time range." }
);

const loadDetailedTranscriptWindowsSchema = s.object(
  {
    requests: s.required(
      s.array(transcriptDetailRequestSchema, {
        minItems: 1,
        maxItems: MAX_TRANSCRIPT_WINDOW_REQUESTS,
      })
    ),
  },
  { description: "One or more detailed transcript windows to fetch." }
);

const analyzeChapterVideoSchema = s.object(
  {
    focus: s.required(
      s.string({
        minLength: 1,
        maxLength: 400,
      })
    ),
    assetId: s.optional(s.integer({ minimum: 1 })),
  },
  { description: "The evidence question to answer from the chapter video." }
);

const finalizeConversationTurnSchema = s.object(
  {
    outcome: s.required(s.stringEnum(TURN_OUTCOME_VALUES)),
    assistantResponse: s.required(
      s.string({
        minLength: 1,
        maxLength: 4000,
      })
    ),
  },
  {
    description:
      "Terminate the turn with the user-facing assistant response and declared outcome.",
  }
);

const videoEvidenceSchema = z.object({
  assetId: z.number().int().positive().optional(),
  summary: z.string().trim().min(1).max(4000),
  observations: z
    .array(
      z.object({
        in_point: z.number().finite().min(0).optional(),
        out_point: z.number().finite().min(0).optional(),
        note: z.string().trim().min(1).max(240),
      })
    )
    .max(MAX_VIDEO_OBSERVATIONS),
});

export function isToolSchemaFailure(error: unknown): boolean {
  return error instanceof ZodError || isExecutableToolValidationError(error);
}

export function createConversationTools(
  input: ConversationTurnInput,
  writer: ConversationWriter | undefined,
  accumulator: ConversationToolAccumulator,
  dependencies: ConversationToolDependencies = {}
): AgentToolDefinition[] {
  const analyzeChapterVideoImpl =
    dependencies.analyzeChapterVideo ?? analyzeChapterVideoEvidence;
  const loadDetailedTranscriptWindowsImpl =
    dependencies.loadDetailedTranscriptWindows ?? loadDetailedTranscriptToolEvidence;

  const tools: AgentToolDefinition[] = [
    defineAgentTool<AnalyzeChapterVideoInput>({
      name: "analyzeChapterVideo",
      description:
        "Inspect the current chapter video for factual visual evidence only. Use this when you need to verify what happens on screen before answering. This tool never makes recommendations.",
      schema: analyzeChapterVideoSchema,
      execute: async ({ focus, assetId }) => {
        writer?.writeStatus({
          status: "analyzing_video",
          message: "Gathering visual evidence from the chapter video...",
          progress: 50,
          nodeName: "conversation_runner",
        });

        const evidence = await analyzeChapterVideoImpl(input, { focus, assetId });
        if (
          typeof evidence.assetId === "number" &&
          Number.isFinite(evidence.assetId) &&
          input.context.videoAnalysisAssets.some((asset) => asset.assetId === evidence.assetId)
        ) {
          accumulator.hasSuccessfulVideoEvidence = true;
          accumulator.videoEvidenceAssetIds.add(evidence.assetId);
        }
        return JSON.stringify(evidence);
      },
    }),
    defineAgentTool<LoadDetailedTranscriptWindowsInput>({
      name: "loadDetailedTranscriptWindows",
      description:
        "Load precise transcript windows for the current chapter when the overview transcript is insufficient for exact timing. This tool only provides evidence and never creates recommendations by itself.",
      schema: loadDetailedTranscriptWindowsSchema,
      execute: async ({ requests }) => {
        writer?.writeStatus({
          status: "loading_detailed_transcript_context",
          message: "Fetching detailed transcript windows for exact timing...",
          progress: 50,
          nodeName: "conversation_runner",
        });

        const normalizedRequests = normalizeDetailedTranscriptRequestsForInput(input, requests);
        accumulator.transcriptDetailRequests.push(...normalizedRequests);
        const windows = await loadDetailedTranscriptWindowsImpl(input, normalizedRequests);
        accumulator.loadedDetailedTranscripts.push(...windows);

        return JSON.stringify({
          windows: windows.map((window) => ({
            assetId: window.assetId,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
            reason: window.reason,
            text: window.text,
            segments: window.segments.slice(0, 80),
          })),
        });
      },
    }),
    defineAgentTool<DraftRoughCutProposalsInput>({
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
    }),
    defineAgentTool<FinalizeConversationTurnInput>({
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
    }),
  ];

  return tools;
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

function validateKeepWindowDescriptions(proposals: ProposalDraft[]): void {
  for (const proposal of proposals) {
    if (proposal.type === "range_suggestion") {
      validateKeepWindowDescription(proposal.description, "range_suggestion.description");
      continue;
    }

    if (proposal.type === "create_clip") {
      validateKeepWindowDescription(proposal.description, "create_clip.description");
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

function resolveGroundedVideoAsset(
  input: ConversationTurnInput,
  requestedAssetId?: number
): { assetId: number; proxyPath: string } | null {
  const groundedAssets = input.context.videoAnalysisAssets;
  if (groundedAssets.length === 0) {
    return null;
  }

  if (requestedAssetId === undefined) {
    if (groundedAssets.length > 1) {
      throw new Error("assetId is required when multiple grounded video assets are available.");
    }

    return groundedAssets[0] ?? null;
  }

  const selectedAsset = groundedAssets.find((asset) => asset.assetId === requestedAssetId);
  if (!selectedAsset) {
    throw new Error(`No grounded video asset is available for assetId ${requestedAssetId}.`);
  }

  return selectedAsset;
}

function validateProposalGrounding(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  proposals: ProposalDraft[]
): void {
  for (const proposal of proposals) {
    if (proposal.type === "create_clip") {
      validateCreateClipGrounding(input, accumulator, proposal);
      continue;
    }

    if (!accumulator.hasSuccessfulVideoEvidence && !hasNonVisualProposalGrounding(input, accumulator, proposal)) {
      if (proposal.type === "update_clip") {
        throw new Error(
          "update_clip requires transcript context, a selected clip, the playhead region, or matching video evidence."
        );
      }

      throw new Error(
        "range_suggestion requires transcript context, detailed transcript windows, the playhead region, or matching video evidence."
      );
    }
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
    typeof proposal.assetId === "number" &&
    accumulator.videoEvidenceAssetIds.has(proposal.assetId)
  ) {
    return;
  }

  if (
    groundedVideoAssetIds.length > 1 ||
    input.context.chapterAssetIds.length > 1
  ) {
    const assetIdDetail =
      typeof proposal.assetId === "number" ? ` for assetId ${proposal.assetId}` : "";
    throw new Error(
      `create_clip${assetIdDetail} requires analyzeChapterVideo evidence for that same asset earlier in the turn.`
    );
  }

  if (
    !hasNonVisualProposalGrounding(
      input,
      accumulator,
      proposal,
      { requirePreciseWindowGrounding: true }
    )
  ) {
    throw new Error(
      "create_clip requires matching video evidence or strong local grounding from detailed transcript windows, selected clips, or the current playhead region."
    );
  }
}

function hasNonVisualProposalGrounding(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator,
  proposal: ProposalDraft,
  options: { requirePreciseWindowGrounding?: boolean } = {}
): boolean {
  const range = getProposalRangeInChapter(input, proposal);
  const detailedTranscriptWindows = getDetailedTranscriptGroundingWindows(input, accumulator);
  const hasDetailedTranscriptAnchor = range
    ? detailedTranscriptWindows.some((window) =>
        rangesOverlap(range.start, range.end, window.windowStart, window.windowEnd)
      )
    : detailedTranscriptWindows.length > 0;
  const hasSelectedClipAnchor = hasSelectedClipGrounding(input, proposal, range);
  const hasPlayheadAnchor = hasPlayheadGrounding(input, range);

  if (options.requirePreciseWindowGrounding) {
    return hasDetailedTranscriptAnchor || hasSelectedClipAnchor || hasPlayheadAnchor;
  }

  return hasTranscriptContext(input, accumulator) || hasDetailedTranscriptAnchor || hasSelectedClipAnchor || hasPlayheadAnchor;
}

function hasTranscriptContext(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator
): boolean {
  return Boolean(input.context.transcript?.trim()) || getDetailedTranscriptGroundingWindows(input, accumulator).length > 0;
}

function getDetailedTranscriptGroundingWindows(
  input: ConversationTurnInput,
  accumulator: ConversationToolAccumulator
): DetailedTranscriptWindow[] {
  return [...input.context.detailedTranscripts, ...accumulator.loadedDetailedTranscripts];
}

function hasSelectedClipGrounding(
  input: ConversationTurnInput,
  proposal: ProposalDraft,
  range: { start: number; end: number } | null
): boolean {
  if (
    proposal.type === "update_clip" &&
    input.selectedClipIds.includes(proposal.clipId)
  ) {
    return true;
  }

  if (!range || input.selectedClipIds.length === 0) {
    return false;
  }

  return input.selectedClipIds.some((clipId) => {
    const selectedRange = getChapterLocalClipRange(input, clipId);
    return selectedRange
      ? rangesOverlap(range.start, range.end, selectedRange.start, selectedRange.end)
      : false;
  });
}

function hasPlayheadGrounding(
  input: ConversationTurnInput,
  range: { start: number; end: number } | null
): boolean {
  const localPlayhead = getChapterLocalPlayheadTime(input);
  if (localPlayhead === null) {
    return false;
  }

  if (!range) {
    return true;
  }

  return rangesOverlap(
    range.start,
    range.end,
    localPlayhead - PLAYHEAD_GROUNDING_WINDOW_SECONDS,
    localPlayhead + PLAYHEAD_GROUNDING_WINDOW_SECONDS
  );
}

function getProposalRangeInChapter(
  input: ConversationTurnInput,
  proposal: ProposalDraft
): { start: number; end: number } | null {
  if (proposal.type === "range_suggestion") {
    return { start: proposal.in_point, end: proposal.out_point };
  }

  if (proposal.type === "create_clip") {
    return { start: proposal.inPoint, end: proposal.outPoint };
  }

  const existingRange = getChapterLocalClipRange(input, proposal.clipId);
  const start = proposal.updates.inPoint ?? existingRange?.start;
  const end = proposal.updates.outPoint ?? existingRange?.end;

  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    typeof end !== "number" ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return existingRange;
  }

  return { start, end };
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

function getChapterLocalPlayheadTime(input: ConversationTurnInput): number | null {
  const chapter = input.context.chapter;
  if (
    !chapter ||
    typeof input.playheadTime !== "number" ||
    !Number.isFinite(input.playheadTime)
  ) {
    return null;
  }

  const chapterDuration = Math.max(0.01, chapter.endTime - chapter.startTime);
  return Math.min(chapterDuration, Math.max(0, input.playheadTime - chapter.startTime));
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftEnd > rightStart && leftStart < rightEnd;
}

async function analyzeChapterVideoEvidence(
  input: ConversationTurnInput,
  request: AnalyzeChapterVideoInput
): Promise<z.infer<typeof videoEvidenceSchema>> {
  if (
    !input.selectedProvider ||
    !VIDEO_CAPABLE_PROVIDERS.includes(input.selectedProvider)
  ) {
    return {
      summary: `Video analysis is unavailable for provider ${input.selectedProvider || "undefined"}.`,
      observations: [],
    };
  }

  const groundedAsset = resolveGroundedVideoAsset(input, request.assetId);
  if (!groundedAsset) {
    return {
      summary:
        "No chapter proxy video is ready yet, so I could not inspect the visuals directly.",
      observations: [],
    };
  }

  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig, input.selectedProvider);
  const llm = createLLM(llmConfig);
  const prompt = buildVideoEvidencePrompt(request.focus);
  const provider = input.selectedProvider as VideoProvider;
  const videoMessage = await createVideoMessage({
    provider,
    videoPath: groundedAsset.proxyPath,
    textPrompt: prompt,
    transcriptContext: input.context.transcript,
  });

  const response = await llm.invoke([videoMessage]);
  const parsed = parseVideoEvidenceResponse(getMessageText(response.content));
  return {
    ...parsed,
    assetId: groundedAsset.assetId,
  };
}

function buildVideoEvidencePrompt(focus: string): string {
  return `You are gathering factual evidence about a chapter video for an editing assistant.

Focus:
${focus}

Inspect the visuals and dialogue as evidence for editing decisions.
Do not make edit recommendations, do not say what should be cut or kept, and do not propose timeline changes.
When relevant, surface concrete observations about:
- momentum drops, dead air, repeated actions or explanations, and reset moments
- payoff landings, reactions, reveals, transitions, and visually important beats
- whether humor escalates the sequence or stalls it

Keep every note factual, specific, and anchored to what is visibly or audibly present on screen.

Return exactly one JSON object with this shape:
{
  "summary": "Short factual summary of what matters for this focus",
  "observations": [
    {
      "in_point": 12.5,
      "out_point": 18.2,
      "note": "Concrete visual or dialogue observation"
    }
  ]
}`;
}

function parseVideoEvidenceResponse(content: string): z.infer<typeof videoEvidenceSchema> {
  const jsonObject = extractJsonObject(content);
  if (jsonObject) {
    try {
      return videoEvidenceSchema.parse(JSON.parse(jsonObject));
    } catch {
      // Fall through to the text fallback.
    }
  }

  return {
    summary: content.trim() || "The video evidence response could not be parsed cleanly.",
    observations: [],
  };
}

async function loadDetailedTranscriptToolEvidence(
  input: ConversationTurnInput,
  requests: TranscriptDetailRequest[]
): Promise<DetailedTranscriptWindow[]> {
  const chapter = input.context.chapter;
  if (!chapter) {
    return [];
  }

  return await generateDetailedTranscriptsForRequests(
    {
      id: Number(chapter.id),
      start_time: chapter.startTime,
      end_time: chapter.endTime,
    },
    input.context.chapterAssetIds,
    requests
  );
}

function normalizeDetailedTranscriptRequestsForInput(
  input: ConversationTurnInput,
  requests: TranscriptDetailRequest[]
): TranscriptDetailRequest[] {
  const chapter = input.context.chapter;
  if (!chapter) {
    return [];
  }

  const chapterDuration = Math.max(0.01, chapter.endTime - chapter.startTime);
  return normalizeTranscriptDetailRequests(
    requests,
    chapterDuration,
    input.context.chapterAssetIds
  );
}

function extractJsonObject(content: string): string | null {
  const objectStart = content.indexOf("{");
  if (objectStart === -1) return null;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let index = objectStart; index < content.length; index += 1) {
    const char = content[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}
