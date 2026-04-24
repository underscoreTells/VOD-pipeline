import type { BaseMessage } from "@langchain/core/messages";
import type { LLMProviderType } from "../providers/index.js";
import type {
  AgentSuggestionDraft,
  ConversationTurnResult,
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from "../../shared/types/agent-ipc.js";

export type TurnOutcome = ConversationTurnResult["outcome"];

export type ProposalDraft =
  | ({
      type: "range_suggestion";
    } & AgentSuggestionDraft)
  | ({
      type: "create_clip";
    } & Extract<TimelineAction, { type: "create_clip" }>)
  | ({
      type: "update_clip";
    } & Extract<TimelineAction, { type: "update_clip" }>);

export interface ConversationChapterContext {
  id: string;
  title?: string;
  startTime: number;
  endTime: number;
}

export interface ConversationClipContext {
  id: number;
  assetId: number;
  trackIndex: number;
  startTime: number;
  inPoint: number;
  outPoint: number;
  role: string | null;
  description: string | null;
  isEssential: boolean;
}

export interface ConversationContextPayload {
  chapter?: ConversationChapterContext;
  chapterAssetIds: number[];
  chapterClips: ConversationClipContext[];
  transcript?: string;
  detailedTranscripts: DetailedTranscriptWindow[];
  videoAnalysisAssets: Array<{
    assetId: number;
    proxyPath: string;
  }>;
  suggestionSummary?: string;
}

export interface ConversationTurnInput {
  messages: BaseMessage[];
  selectedProvider?: LLMProviderType;
  selectedClipIds: number[];
  playheadTime?: number;
  context: ConversationContextPayload;
}

export interface ConversationWriter {
  writeStatus(event: {
    status: string;
    message?: string;
    progress?: number;
    nodeName?: string;
  }): void;
  writeAssistantTextDelta(delta: string): void;
  writeToolState(event: {
    toolCallId: string;
    toolName: string;
    state: "pending" | "running" | "completed" | "error";
    message?: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
  }): void;
}

export interface ConversationRunResult extends ConversationTurnResult {
  suggestionDrafts?: AgentSuggestionDraft[];
  timelineActions?: TimelineAction[];
  transcriptDetailRequests?: TranscriptDetailRequest[];
}
