import type { AgentStreamStatusEvent } from "../../../shared/types/agent-ipc.js";
import {
  appendExecutionTraceEntry,
  getExecutionActivityStatus,
} from "../../../shared/utils/execution-trace.js";
import type { ChatMessage } from "./agent-session.svelte.js";

export function createDraftAssistantMessage(
  clientRequestId: string,
  timestamp: Date
): ChatMessage {
  return {
    role: "assistant",
    content: "",
    thinkingMarkdown: null,
    trace: [],
    id: `draft-${clientRequestId}`,
    databaseId: null,
    timestamp,
    mentions: [],
    requestId: clientRequestId,
    isStreaming: true,
  };
}

export function appendAssistantTextDeltaToDraft(
  messages: ChatMessage[],
  clientRequestId: string,
  delta: string
): ChatMessage[] {
  return updateDraftMessage(messages, clientRequestId, (message) => ({
    ...message,
    content: `${message.content}${delta}`,
  }));
}

export function appendTraceEventToDraft(
  messages: ChatMessage[],
  clientRequestId: string,
  event: Pick<AgentStreamStatusEvent, "status" | "message" | "nodeName" | "passIndex" | "stepIndex">
): ChatMessage[] {
  return updateDraftMessage(messages, clientRequestId, (message) => ({
    ...message,
    trace: appendExecutionTraceEntry(message.trace, event),
  }));
}

export function getVisibleStreamingStatusLabel(
  message: Pick<ChatMessage, "isStreaming" | "trace">
): string | null {
  if (!message.isStreaming) {
    return null;
  }

  return getExecutionActivityStatus(message.trace);
}

export function finalizeDraftMessage(
  messages: ChatMessage[],
  clientRequestId: string,
  finalContent: string,
  finalThinkingMarkdown: string | null
): ChatMessage[] {
  return updateDraftMessage(messages, clientRequestId, (message) => ({
    ...message,
    content: finalContent,
    thinkingMarkdown: finalThinkingMarkdown,
    isStreaming: false,
  }));
}

export function failDraftMessage(
  messages: ChatMessage[],
  clientRequestId: string,
  error: string
): ChatMessage[] {
  return updateDraftMessage(messages, clientRequestId, (message) => ({
    ...message,
    content: `Error: ${error}`,
    thinkingMarkdown: null,
    isStreaming: false,
  }));
}

function updateDraftMessage(
  messages: ChatMessage[],
  clientRequestId: string,
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  const index = messages.findIndex((message) => message.requestId === clientRequestId);
  if (index < 0) {
    return messages;
  }

  const nextMessages = [...messages];
  nextMessages[index] = updater(nextMessages[index]);
  return nextMessages;
}
