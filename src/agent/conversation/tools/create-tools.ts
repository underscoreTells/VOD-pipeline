import { ZodError } from "zod";
import { isExecutableToolValidationError } from "../../tools/binding.js";
import { AgentToolDefinition } from "../../tools/define-tool.js";
import type {
  AgentSuggestionDraft,
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from "../../../shared/types/agent-ipc.js";
import type {
  ConversationTurnInput,
  ConversationWriter,
  TurnOutcome,
} from "../types.js";
import type { AnalyzeChapterVideoInput } from "./schemas.js";
import {
  analyzeChapterVideoEvidence,
  createAnalyzeChapterVideoTool,
} from "./video-evidence.js";
import {
  loadDetailedTranscriptToolEvidence,
  createLoadDetailedTranscriptWindowsTool,
} from "./transcript-windows.js";
import { createDraftRoughCutProposalsTool } from "./proposals.js";
import { createFinalizeConversationTurnTool } from "./finalize.js";

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
    createAnalyzeChapterVideoTool(input, writer, accumulator, analyzeChapterVideoImpl),
    createLoadDetailedTranscriptWindowsTool(
      input,
      writer,
      accumulator,
      loadDetailedTranscriptWindowsImpl
    ),
    createDraftRoughCutProposalsTool(input, accumulator),
    createFinalizeConversationTurnTool(accumulator),
  ];

  return tools;
}
