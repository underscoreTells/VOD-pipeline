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
import type {
  ConversationTurnInput,
  ConversationWriter,
  ProposalDraft,
} from "./types.js";
import {
  AgentToolDefinition,
  defineAgentTool,
} from "../tools/define-tool.js";
import { isExecutableToolValidationError } from "../tools/binding.js";
import { canonicalSchema as s } from "../tools/schema.js";

const MAX_VIDEO_OBSERVATIONS = 12;
const MAX_PROPOSAL_DRAFTS = 16;
const MAX_TRANSCRIPT_WINDOW_REQUESTS = 3;
const CLIP_ROLE_VALUES = ["setup", "escalation", "twist", "payoff", "transition"] as const;

export interface ConversationToolDependencies {
  analyzeChapterVideo?: (
    input: ConversationTurnInput,
    focus: string
  ) => Promise<{
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
  clarificationQuestion?: string;
}

interface AnalyzeChapterVideoInput {
  focus: string;
}

interface LoadDetailedTranscriptWindowsInput {
  requests: TranscriptDetailRequest[];
}

interface DraftRoughCutProposalsInput {
  proposals: ProposalDraft[];
}

interface RequestClarificationInput {
  question: string;
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
  { description: "Suggest a keep or cut window using chapter-local seconds." }
);

const createClipSchema = s.object(
  {
    type: s.required(s.literalString("create_clip")),
    assetId: s.optional(s.integer({ minimum: 1 })),
    trackIndex: s.optional(s.integer({ minimum: 0 })),
    startTime: s.optional(s.number({ minimum: 0 })),
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
  { description: "Create a new clip using chapter-local source points." }
);

const updateClipSchema = s.object(
  {
    type: s.required(s.literalString("update_clip")),
    clipId: s.required(s.integer({ minimum: 1 })),
    updates: s.required(
      s.object(
        {
          startTime: s.optional(s.number({ minimum: 0 })),
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
  { description: "Update an existing clip by id." }
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
  },
  { description: "The evidence question to answer from the chapter video." }
);

const requestClarificationSchema = s.object(
  {
    question: s.required(
      s.string({
        minLength: 1,
        maxLength: 400,
      })
    ),
  },
  { description: "A clarification question to ask instead of guessing." }
);

const videoEvidenceSchema = z.object({
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
  dependencies: ConversationToolDependencies = {},
  options: { includeProposalTools: boolean }
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
      execute: async ({ focus }) => {
        writer?.writeStatus({
          status: "analyzing_video",
          message: "Gathering visual evidence from the chapter video...",
          progress: 50,
          nodeName: "conversation_runner",
        });

        const evidence = await analyzeChapterVideoImpl(input, focus);
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
  ];

  if (options.includeProposalTools) {
    tools.push(
      defineAgentTool<DraftRoughCutProposalsInput>({
        name: "draftRoughCutProposals",
        description:
          "Create actionable rough-cut proposals. Use range_suggestion for keep/cut windows, create_clip for new clips, and update_clip for existing clip edits. Do not describe actionable edits only in prose.",
        schema: draftRoughCutProposalsSchema,
        execute: async ({ proposals }) => {
          const accepted = normalizeProposalDrafts(proposals);

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
      defineAgentTool<RequestClarificationInput>({
        name: "requestClarification",
        description:
          "Use this when the user wants actionable edits but the scope or timing is too unclear to draft safely. This ends the turn with a clarifying question instead of guessing.",
        schema: requestClarificationSchema,
        execute: async ({ question }) => {
          accumulator.clarificationQuestion = question;
          return JSON.stringify({ question });
        },
      })
    );
  }

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

async function analyzeChapterVideoEvidence(
  input: ConversationTurnInput,
  focus: string
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

  if (!input.context.proxyPath) {
    return {
      summary:
        "No chapter proxy video is ready yet, so I could not inspect the visuals directly.",
      observations: [],
    };
  }

  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig, input.selectedProvider);
  const llm = createLLM(llmConfig);
  const prompt = buildVideoEvidencePrompt(focus);
  const provider = input.selectedProvider as VideoProvider;
  const videoMessage = await createVideoMessage({
    provider,
    videoPath: input.context.proxyPath,
    textPrompt: prompt,
    transcriptContext: input.context.transcript,
  });

  const response = await llm.invoke([videoMessage]);
  return parseVideoEvidenceResponse(getMessageText(response.content));
}

function buildVideoEvidencePrompt(focus: string): string {
  return `You are gathering factual evidence about a chapter video for an editing assistant.

Focus:
${focus}

Inspect the visuals and dialogue only as evidence. Do not make edit recommendations, do not say what should be cut, and do not propose timeline changes.

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

function getMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content ?? "");
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }

      return "";
    })
    .join("");
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
