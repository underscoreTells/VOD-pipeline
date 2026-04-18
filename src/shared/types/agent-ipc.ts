import { BaseMessage } from "@langchain/core/messages";
import type { Clip, Suggestion } from "./database.js";
import type { TranscriptionSegment } from "./pipeline.js";

export type ClipRole = NonNullable<Clip["role"]>;

export interface CreateClipAction {
  type: "create_clip";
  assetId?: number;
  trackIndex?: number;
  startTime?: number;
  inPoint: number;
  outPoint: number;
  role?: Clip["role"];
  description?: string | null;
  isEssential?: boolean;
  reasoning?: string;
}

export interface UpdateClipAction {
  type: "update_clip";
  clipId: number;
  updates: {
    startTime?: number;
    inPoint?: number;
    outPoint?: number;
    role?: Clip["role"];
    description?: string | null;
    isEssential?: boolean;
  };
  reasoning?: string;
}

export type TimelineAction = CreateClipAction | UpdateClipAction;

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
}

export interface AgentChatData {
  message: string;
  thinkingMarkdown?: string;
  threadId?: string;
  suggestions?: Suggestion[];
  timelineActions?: TimelineAction[];
}

export type AgentInputMessage =
  | ChatInputMessage
  | AnalyzeChaptersInputMessage
  | StopInputMessage;

export type AgentInputMessageWithId = AgentInputMessage;

export type AgentInputMessageWithoutId =
  | ChatInputMessageWithoutId
  | AnalyzeChaptersInputMessageWithoutId
  | StopInputMessageWithoutId;

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

export interface AnalyzeChaptersInputMessage {
  type: "analyze-chapters";
  requestId: string;
  threadId?: string;
  projectId: string;
  chapters: Array<{
    id: string;
    transcript: string;
    videoPath?: string;
  }>;
  instructions: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyzeChaptersInputMessageWithoutId {
  type: "analyze-chapters";
  threadId?: string;
  projectId: string;
  chapters: Array<{
    id: string;
    transcript: string;
    videoPath?: string;
  }>;
  instructions: string;
  metadata?: Record<string, unknown>;
}

export interface StopInputMessage {
  type: "stop";
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface StopInputMessageWithoutId {
  type: "stop";
  metadata?: Record<string, unknown>;
}

export type AgentOutputMessage =
  | ReadyOutputMessage
  | ProgressOutputMessage
  | TokenOutputMessage
  | GraphCompleteOutputMessage
  | ErrorOutputMessage;

export interface ReadyOutputMessage {
  type: "ready";
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface ProgressOutputMessage {
  type: "progress";
  requestId: string;
  status: string;
  progress: number;
  nodeName?: string;
  chapterId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenOutputMessage {
  type: "token";
  requestId: string;
  content: string;
  role: string;
  nodeName: string;
  visibility?: "chat" | "hidden";
  metadata?: Record<string, unknown>;
}

export interface GraphCompleteOutputMessage {
  type: "graph-complete";
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
  passIndex: number;
}

export interface AgentStreamProgressEvent extends AgentStreamContext {
  type: "progress";
  status: string;
  progress: number;
  nodeName?: string;
  message?: string;
  resetDraft?: boolean;
}

export interface AgentStreamTokenEvent extends AgentStreamContext {
  type: "token";
  content: string;
  role: string;
  nodeName: string;
  visibility?: "chat" | "hidden";
}

export type AgentStreamEvent = AgentStreamProgressEvent | AgentStreamTokenEvent;

export interface Message {
  role: string;
  content: string;
}
