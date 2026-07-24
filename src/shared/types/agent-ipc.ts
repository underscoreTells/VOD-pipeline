import type { Clip, Suggestion } from "./database.js";
import type { TranscriptionSegment } from "./pipeline.js";

export type ClipRole = NonNullable<Clip["role"]>;

export interface CreateClipAction {
  type: "create_clip";
  assetId?: number;
  trackIndex?: number;
  inPoint: number;
  outPoint: number;
  role?: Clip["role"];
  description?: string | null;
  isEssential?: boolean;
  reasoning?: string;
  supersedesSuggestionId?: number;
  evidenceIds?: string[];
}

export interface UpdateClipAction {
  type: "update_clip";
  clipId: number;
  updates: {
    inPoint?: number;
    outPoint?: number;
    role?: Clip["role"];
    description?: string | null;
    isEssential?: boolean;
  };
  reasoning?: string;
  supersedesSuggestionId?: number;
  evidenceIds?: string[];
}

export interface DeleteClipAction {
  type: 'delete_clip';
  clipId: number;
  reasoning?: string;
  supersedesSuggestionId?: number;
  evidenceIds?: string[];
}

export interface SplitClipSegment {
  inPoint: number;
  outPoint: number;
  role?: Clip['role'];
  description?: string | null;
  isEssential?: boolean;
}

export interface SplitClipAction {
  type: 'split_clip';
  clipId: number;
  segments: SplitClipSegment[];
  reasoning?: string;
  supersedesSuggestionId?: number;
  evidenceIds?: string[];
}

export type TimelineAction = CreateClipAction | UpdateClipAction | DeleteClipAction | SplitClipAction;

export interface TranscriptDetailRequest {
  windowStart: number;
  windowEnd: number;
  assetId?: number;
  reason?: string;
}

export interface DetailedTranscriptWindow {
  assetId: number;
  windowStart: number;
  windowEnd: number;
  reason?: string;
  text: string;
  segments: TranscriptionSegment[];
}

export interface AgentSuggestionDraft {
  in_point: number;
  out_point: number;
  description?: string;
  reasoning?: string;
  supersedesSuggestionId?: number;
  evidenceIds?: string[];
}

export interface ConversationTurnResult {
  assistantResponse?: string;
  thinkingMarkdown?: string;
  outcome: "discussion" | "clarification" | "proposal";
  suggestionDrafts?: AgentSuggestionDraft[];
  // Deprecated for renderer-facing chat flows. Persisted suggestions are canonical.
  timelineActions?: TimelineAction[];
  transcriptDetailRequests?: TranscriptDetailRequest[];
  editingIntent?: {
    scope: 'playhead_region' | 'selected_clips' | 'whole_chapter';
    compression: 'light' | 'balanced' | 'aggressive';
    protectedBeats: string[];
  };
}

export interface AgentChatData {
  message: string;
  thinkingMarkdown?: string;
  threadId?: string;
  userMessageId?: number;
  assistantMessageId?: number;
  userCreatedAt?: string;
  assistantCreatedAt?: string;
  suggestions?: Suggestion[];
  outcome?: ConversationTurnResult["outcome"];
  // Deprecated for renderer-facing chat flows. Persisted suggestions are canonical.
  timelineActions?: TimelineAction[];
}

export type AgentInputMessage =
  | ChatInputMessage
  | CancelInputMessage;

export type AgentInputMessageWithId = AgentInputMessage;

export type AgentInputMessageWithoutId =
  | ChatInputMessageWithoutId
  | CancelInputMessageWithoutId;

export interface ChatInputMessage {
  type: "chat";
  requestId: string;
  threadId?: string;
  messages: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface ChatInputMessageWithoutId {
  type: "chat";
  threadId?: string;
  messages: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface CancelInputMessage {
  type: "cancel";
  requestId: string;
  targetRequestId: string;
}

export interface CancelInputMessageWithoutId {
  type: "cancel";
  targetRequestId: string;
}

export type AgentOutputMessage =
  | ReadyOutputMessage
  | StatusOutputMessage
  | AssistantTextDeltaOutputMessage
  | ToolStateOutputMessage
  | TurnCompleteOutputMessage
  | ErrorOutputMessage;

export interface ReadyOutputMessage {
  type: "ready";
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface StatusOutputMessage {
  type: "status";
  requestId: string;
  status: string;
  progress?: number;
  nodeName?: string;
  stepIndex?: number;
  chapterId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface AssistantTextDeltaOutputMessage {
  type: "assistant_text_delta";
  requestId: string;
  delta: string;
  role: string;
  metadata?: Record<string, unknown>;
}

export interface ToolStateOutputMessage {
  type: "tool_state";
  requestId: string;
  toolCallId: string;
  toolName: string;
  state: "pending" | "running" | "completed" | "error";
  stepIndex?: number;
  message?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TurnCompleteOutputMessage {
  type: "turn_complete";
  requestId: string;
  result: Record<string, unknown>;
  threadId: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorOutputMessage {
  type: "error";
  requestId: string;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface AgentStreamContext {
  clientRequestId: string;
  projectId: string;
  chapterId: string;
  conversationId: number;
  passIndex?: number;
}

export interface AgentStreamStatusEvent extends AgentStreamContext {
  type: "status";
  status: string;
  progress?: number;
  nodeName?: string;
  stepIndex?: number;
  message?: string;
}

export interface AgentStreamAssistantTextDeltaEvent extends AgentStreamContext {
  type: "assistant_text_delta";
  delta: string;
  role: string;
}

export interface AgentStreamToolStateEvent extends AgentStreamContext {
  type: "tool_state";
  toolCallId: string;
  toolName: string;
  state: "pending" | "running" | "completed" | "error";
  stepIndex?: number;
  message?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export type AgentStreamEvent =
  | AgentStreamStatusEvent
  | AgentStreamAssistantTextDeltaEvent
  | AgentStreamToolStateEvent;

export interface Message {
  role: string;
  content: string;
}
