import { v4 as uuidv4 } from "uuid";
import type { TimelineAction } from "../../../shared/types/agent-ipc.js";
import { agentChat, onAgentError, onAgentStream } from "../api/agent.js";
import {
  agentState,
  buildProviderEnvFromSettings,
  ensureActiveConversation,
  refreshConversationListMetadata,
  type ChatMessage,
  type TimelineActionProposal,
} from "./agent-session.svelte.js";
import {
  appendTraceEventToDraft,
  appendTokenToDraft,
  createDraftAssistantMessage,
  failDraftMessage,
  finalizeDraftMessage,
  updateDraftPreview,
} from "./agent-streaming-helpers.js";
import { timelineState } from "./timeline.svelte";
import {
  parseStructuredAssistantPreview,
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from "../../../shared/utils/assistant-content.js";

interface PendingDraft {
  clientRequestId: string;
  conversationId: number;
  messageId: string;
}

const pendingDrafts = new Map<string, PendingDraft>();
const structuredDraftBuffers = new Map<string, { raw: string }>();
let streamUnsubscribe: (() => void) | null = null;
let errorUnsubscribe: (() => void) | null = null;

function ensureStreamingSubscriptions(): void {
  if (!streamUnsubscribe) {
    streamUnsubscribe = onAgentStream((event) => {
      const pending = pendingDrafts.get(event.clientRequestId);
      if (!pending || pending.conversationId !== event.conversationId) {
        return;
      }

      if (event.type === "token") {
        const normalizedRole = event.role.toLowerCase();
        if (normalizedRole !== "assistant" && normalizedRole !== "ai") {
          return;
        }

        if (event.visibility === "hidden") {
          const existing = structuredDraftBuffers.get(event.clientRequestId);
          const raw = `${existing?.raw ?? ""}${event.content}`;
          structuredDraftBuffers.set(event.clientRequestId, { raw });

          const preview = parseStructuredAssistantPreview(raw);
          agentState.messages = updateDraftPreview(
            agentState.messages,
            event.clientRequestId,
            preview.assistantResponse,
            preview.thinkingMarkdown
          );
          return;
        }

        agentState.messages = appendTokenToDraft(
          agentState.messages,
          event.clientRequestId,
          event.content,
          event.visibility ?? "chat"
        );
        return;
      }

      if (event.resetDraft) {
        structuredDraftBuffers.delete(event.clientRequestId);
      }

      agentState.messages = appendTraceEventToDraft(
        agentState.messages,
        event.clientRequestId,
        event
      );
    });
  }

  if (!errorUnsubscribe) {
    errorUnsubscribe = onAgentError((payload) => {
      agentState.error = payload.error;
    });
  }
}

function createTimelineProposals(
  messageId: string,
  actions: TimelineAction[] | undefined
): TimelineActionProposal[] {
  if (!Array.isArray(actions) || actions.length === 0) {
    return [];
  }

  return actions.map((action) => ({
    id: uuidv4(),
    messageId,
    action,
    status: "pending",
    error: null,
  }));
}

function buildUserMessage(message: string): ChatMessage {
  return {
    role: "user",
    content: message,
    thinkingMarkdown: null,
    trace: [],
    id: uuidv4(),
    timestamp: new Date(),
  };
}

export async function sendChatMessage(message: string) {
  if (!message.trim() || agentState.isStreaming) {
    return;
  }

  ensureStreamingSubscriptions();

  if (!agentState.currentProjectId) {
    agentState.error = "No project selected. Please open a project first.";
    return;
  }

  if (!agentState.currentChapterId) {
    agentState.error = "Select a chapter before starting a conversation.";
    return;
  }

  const conversationId = await ensureActiveConversation();
  if (!conversationId) {
    return;
  }

  const clientRequestId = uuidv4();
  const userMessage = buildUserMessage(message);
  const assistantDraft = createDraftAssistantMessage(clientRequestId, new Date());

  pendingDrafts.set(clientRequestId, {
    clientRequestId,
    conversationId,
    messageId: assistantDraft.id,
  });
  structuredDraftBuffers.set(clientRequestId, { raw: "" });

  agentState.messages = [...agentState.messages, userMessage, assistantDraft];
  agentState.isStreaming = true;
  agentState.error = null;

  try {
    const response = await agentChat({
      clientRequestId,
      projectId: agentState.currentProjectId,
      conversationId,
      message,
      provider: agentState.selectedProvider,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      playheadTime: timelineState.playheadTime,
      agentConfig: buildProviderEnvFromSettings(),
    });

    if (response.success && response.data) {
      const result = response.data;
      const finalMessage = sanitizeAssistantContent(result.message || "Analysis complete");
      const finalThinkingMarkdown = typeof result.thinkingMarkdown === "string"
        ? sanitizeThinkingMarkdown(result.thinkingMarkdown) || null
        : null;

      agentState.messages = finalizeDraftMessage(
        agentState.messages,
        clientRequestId,
        finalMessage,
        finalThinkingMarkdown
      );

      if (Array.isArray(result.suggestions) && result.suggestions.length > 0) {
        agentState.suggestions.push(...result.suggestions);
      }

      const pending = pendingDrafts.get(clientRequestId);
      const proposals = createTimelineProposals(pending?.messageId ?? assistantDraft.id, result.timelineActions);
      if (proposals.length > 0) {
        agentState.timelineProposals = [...agentState.timelineProposals, ...proposals];
      }

      await refreshConversationListMetadata();
    } else {
      const errorMessage = response.error || "Unknown error";
      agentState.error = errorMessage;
      agentState.messages = failDraftMessage(
        agentState.messages,
        clientRequestId,
        errorMessage
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    agentState.error = errorMessage;
    agentState.messages = failDraftMessage(
      agentState.messages,
      clientRequestId,
      errorMessage
    );
  } finally {
    pendingDrafts.delete(clientRequestId);
    structuredDraftBuffers.delete(clientRequestId);
    agentState.isStreaming = false;
  }
}
