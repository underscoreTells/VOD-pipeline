import { ZodError } from "zod";
import { isExecutableToolValidationError } from "../../tools/binding.js";
import { AgentToolDefinition } from "../../tools/define-tool.js";
import type {
  AgentSuggestionDraft,
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from "../../../shared/types/agent-ipc.js";
import type { Transcript } from '../../../shared/types/database.js';
import type {
  ConversationTurnInput,
  ConversationWriter,
  EditingIntent,
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
import { createLoadChapterCutMapTool } from "./chapter-cut-map.js";
import {
  createFindTranscriptEditCandidatesTool,
  createLoadFullTranscriptTool,
  loadChapterTranscriptEvidence,
  type ConversationEvidenceReference,
} from './transcript-evidence.js';

export interface ConversationToolDependencies {
  analyzeChapterVideo?: (
    input: ConversationTurnInput,
    request: AnalyzeChapterVideoInput,
    options?: { signal?: AbortSignal }
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
    requests: TranscriptDetailRequest[],
    options?: { signal?: AbortSignal }
  ) => Promise<DetailedTranscriptWindow[]>;
  loadChapterTranscript?: (chapterId: number) => Promise<Transcript[]>;
}

export interface ConversationToolAccumulator {
  suggestionDrafts: AgentSuggestionDraft[];
  timelineActions: TimelineAction[];
  transcriptDetailRequests: TranscriptDetailRequest[];
  loadedDetailedTranscripts: DetailedTranscriptWindow[];
  evidenceReferences: ConversationEvidenceReference[];
  currentStepIndex: number;
  editingIntent?: EditingIntent;
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
  const loadChapterTranscriptImpl =
    dependencies.loadChapterTranscript ?? loadChapterTranscriptEvidence;

  const tools: AgentToolDefinition[] = [
    ...(input.selectedModelSupportsVideo === false
      ? []
      : [createAnalyzeChapterVideoTool(input, writer, accumulator, analyzeChapterVideoImpl)]),
    createLoadDetailedTranscriptWindowsTool(
      input,
      writer,
      accumulator,
      loadDetailedTranscriptWindowsImpl
    ),
    createLoadFullTranscriptTool(input, accumulator, loadChapterTranscriptImpl),
    createFindTranscriptEditCandidatesTool(input, accumulator, loadChapterTranscriptImpl),
    createLoadChapterCutMapTool(input, writer),
    createDraftRoughCutProposalsTool(input, accumulator),
    createFinalizeConversationTurnTool(accumulator),
  ];

  return tools;
}
