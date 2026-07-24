import type { BaseMessage } from "@langchain/core/messages";
import type { LLMProviderType } from "../providers/index.js";
import type {
  AgentSuggestionDraft,
  ConversationTurnResult,
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from "../../shared/types/agent-ipc.js";
import type { ChatEntityMention } from '../../shared/types/database.js';

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
    } & Extract<TimelineAction, { type: "update_clip" }>)
  | Extract<TimelineAction, { type: 'delete_clip' | 'split_clip' }>
  | {
      type: 'remove_range';
      clipId: number;
      removeStart: number;
      removeEnd: number;
      reasoning?: string;
      supersedesSuggestionId?: number;
      evidenceIds?: string[];
    };

export type EditingIntent = NonNullable<ConversationTurnResult['editingIntent']>;

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
  inPoint: number;
  outPoint: number;
  role: string | null;
  description: string | null;
  isEssential: boolean;
  visibleDuration?: number;
  transcriptExcerpt?: string;
  previousClipId?: number | null;
  nextClipId?: number | null;
  omittedBeforeDuration?: number;
  omittedAfterDuration?: number;
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
  referencedEntities?: ChatEntityMention[];
}

export interface ConversationTurnInput {
  messages: BaseMessage[];
  selectedProvider?: LLMProviderType;
  selectedModelSupportsVideo?: boolean;
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
    stepIndex?: number;
  }): void;
  writeAssistantTextDelta(delta: string): void;
  writeToolState(event: {
    toolCallId: string;
    toolName: string;
    state: "pending" | "running" | "completed" | "error";
    stepIndex?: number;
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
