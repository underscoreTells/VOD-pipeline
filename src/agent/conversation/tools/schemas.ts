import { z } from "zod";
import { canonicalSchema as s } from "../../tools/schema.js";
import {
  CLIP_ROLE_VALUES,
  DEFAULT_CHAPTER_CUT_MAP_PAGE_SIZE,
  MAX_CHAPTER_CUT_MAP_CLIP_IDS,
  MAX_CHAPTER_CUT_MAP_PAGE_SIZE,
  MAX_PROPOSAL_DRAFTS,
  MAX_TRANSCRIPT_WINDOW_REQUESTS,
  MAX_VIDEO_OBSERVATIONS,
  TURN_OUTCOME_VALUES,
} from "./constants.js";
import type { ProposalDraft, TurnOutcome } from "../types.js";
import type { TranscriptDetailRequest } from "../../../shared/types/agent-ipc.js";

export interface AnalyzeChapterVideoInput {
  focus: string;
  assetId?: number;
}

export interface LoadDetailedTranscriptWindowsInput {
  requests: TranscriptDetailRequest[];
}

export interface DraftRoughCutProposalsInput {
  proposals: ProposalDraft[];
}

export interface FinalizeConversationTurnInput {
  outcome: TurnOutcome;
  assistantResponse: string;
}

export interface LoadChapterCutMapInput {
  startLocalTime?: number;
  endLocalTime?: number;
  clipIds?: number[];
  offset?: number;
  limit?: number;
}

export const rangeSuggestionSchema = s.object(
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
    supersedesSuggestionId: s.optional(s.integer({ minimum: 1 })),
  },
  { description: "Suggest a kept source window using chapter-local seconds." }
);

export const createClipSchema = s.object(
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
    supersedesSuggestionId: s.optional(s.integer({ minimum: 1 })),
  },
  {
    description:
      "Create a new clip by defining the kept source window using chapter-local source points only."
  }
);

export const updateClipSchema = s.object(
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
    supersedesSuggestionId: s.optional(s.integer({ minimum: 1 })),
  },
  {
    description:
      "Update an existing clip by id using chapter-local kept source points and metadata only."
  }
);

export const deleteClipSchema = s.object(
  {
    type: s.required(s.literalString('delete_clip')),
    clipId: s.required(s.integer({ minimum: 1 })),
    reasoning: s.optional(s.string({ minLength: 1, maxLength: 400 })),
    supersedesSuggestionId: s.optional(s.integer({ minimum: 1 })),
  },
  { description: 'Delete an existing committed clip after preview and approval.' }
);

export const splitClipSchema = s.object(
  {
    type: s.required(s.literalString('split_clip')),
    clipId: s.required(s.integer({ minimum: 1 })),
    segments: s.required(s.array(
      s.object(
        {
          inPoint: s.required(s.number({ minimum: 0 })),
          outPoint: s.required(s.number({ minimum: 0 })),
          role: s.optional(s.nullable(s.stringEnum(CLIP_ROLE_VALUES))),
          description: s.optional(s.nullable(s.string({ minLength: 1, maxLength: 240 }))),
          isEssential: s.optional(s.boolean()),
        },
        { description: 'One kept chapter-local source window derived from the target clip.' }
      ),
      { minItems: 2 }
    )),
    reasoning: s.optional(s.string({ minLength: 1, maxLength: 400 })),
    supersedesSuggestionId: s.optional(s.integer({ minimum: 1 })),
  },
  {
    description:
      'Replace an existing committed clip with two or more ordered, non-overlapping kept segments. Gaps remove footage.'
  }
);

export const draftRoughCutProposalsSchema = s.object(
  {
    proposals: s.required(
      s.array(
        s.discriminatedUnion("type", [rangeSuggestionSchema, createClipSchema, updateClipSchema, deleteClipSchema, splitClipSchema]),
        {
          minItems: 1,
          maxItems: MAX_PROPOSAL_DRAFTS,
        }
      )
    ),
  },
  { description: "One or more rough-cut proposals for the chapter." }
);

export const transcriptDetailRequestSchema = s.object(
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

export const loadDetailedTranscriptWindowsSchema = s.object(
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

export const analyzeChapterVideoSchema = s.object(
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

export const finalizeConversationTurnSchema = s.object(
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

export const videoEvidenceSchema = z.object({
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

export const loadChapterCutMapSchema = s.object(
  {
    startLocalTime: s.optional(s.number({ minimum: 0 })),
    endLocalTime: s.optional(s.number({ minimum: 0 })),
    clipIds: s.optional(
      s.array(
        s.integer({ minimum: 1 }),
        {
          minItems: 1,
          maxItems: MAX_CHAPTER_CUT_MAP_CLIP_IDS,
        }
      )
    ),
    offset: s.optional(s.integer({ minimum: 0 })),
    limit: s.optional(
      s.integer({
        minimum: 1,
        maximum: MAX_CHAPTER_CUT_MAP_PAGE_SIZE,
      })
    ),
  },
  {
    description:
      "Load a bounded, paginated, filterable view of the current chapter cut map (all input.context.chapterClips) when the 18-line preview in the system prompt is not enough. Optional startLocalTime/endLocalTime filter by chapter-local visible range overlap, clipIds filters to specific clip ids, and offset/limit paginate the filtered result. Defaults to offset=0, limit=" +
      DEFAULT_CHAPTER_CUT_MAP_PAGE_SIZE +
      ".",
  }
);
