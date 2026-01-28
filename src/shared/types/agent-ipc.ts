import { BaseMessage } from "@langchain/core/messages";

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
  metadata?: Record<string, unknown>;
}

export interface TokenOutputMessage {
  type: "token";
  requestId: string;
  content: string;
  role: string;
  nodeName: string;
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

export interface Message {
  role: string;
  content: string;
}
