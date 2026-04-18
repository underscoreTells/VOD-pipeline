import type { AgentStreamProgressEvent } from "../../../shared/types/agent-ipc.js";
import { appendExecutionTraceEntry } from "../../../shared/utils/execution-trace.js";
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
    timestamp,
    requestId: clientRequestId,
    isStreaming: true,
  };
}

export function appendTokenToDraft(
  messages: ChatMessage[],
  clientRequestId: string,
  token: string,
  visibility: "chat" | "hidden" = "chat"
): ChatMessage[] {
  if (visibility === "hidden") {
    return messages;
  }

  return updateDraftMessage(messages, clientRequestId, (message) => ({
    ...message,
    content: `${message.content}${token}`,
  }));
}

export function appendTraceEventToDraft(
  messages: ChatMessage[],
  clientRequestId: string,
  event: Pick<AgentStreamProgressEvent, "status" | "message" | "nodeName" | "passIndex" | "resetDraft">
): ChatMessage[] {
  return updateDraftMessage(messages, clientRequestId, (message) => ({
    ...message,
    content: event.resetDraft ? "" : message.content,
    trace: appendExecutionTraceEntry(message.trace, event),
  }));
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
