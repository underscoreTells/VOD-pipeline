import { SvelteDate, SvelteMap } from "svelte/reactivity";
import { v4 as uuidv4 } from "uuid";
import { agentChat, onAgentError, onAgentStream } from "../api/agent.js";
import {
  agentState,
  buildProviderEnvFromSettings,
  ensureActiveConversation,
  refreshConversationListMetadata,
  type ChatMessage,
} from "./agent-session.svelte.js";
import {
  appendAssistantTextDeltaToDraft,
  appendTraceEventToDraft,
  createDraftAssistantMessage,
  failDraftMessage,
  finalizeDraftMessage,
} from "./agent-streaming-helpers.js";
import { timelineState } from "./timeline.svelte";
import {
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from "../../../shared/utils/assistant-content.js";

interface PendingDraft {
  clientRequestId: string;
  conversationId: number;
}

const pendingDrafts = new SvelteMap<string, PendingDraft>();
let streamUnsubscribe: (() => void) | null = null;
let errorUnsubscribe: (() => void) | null = null;

function ensureStreamingSubscriptions(): void {
  if (!streamUnsubscribe) {
    streamUnsubscribe = onAgentStream((event) => {
      const pending = pendingDrafts.get(event.clientRequestId);
      if (!pending || pending.conversationId !== event.conversationId) {
        return;
      }

      if (event.type === "assistant_text_delta") {
        const normalizedRole = event.role.toLowerCase();
        if (normalizedRole !== "assistant" && normalizedRole !== "ai") {
          return;
        }

        agentState.messages = appendAssistantTextDeltaToDraft(
          agentState.messages,
          event.clientRequestId,
          event.delta
        );
        return;
      }

      if (event.type === "tool_state") {
        agentState.messages = appendTraceEventToDraft(
          agentState.messages,
          event.clientRequestId,
          {
            status: `tool_${event.state}`,
            message: event.message ?? event.error ?? `${event.toolName} ${event.state}`,
            nodeName: event.toolName,
            passIndex: event.passIndex,
          }
        );
        return;
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

function buildUserMessage(message: string): ChatMessage {
  return {
    role: "user",
    content: message,
    thinkingMarkdown: null,
    trace: [],
    id: uuidv4(),
    timestamp: new SvelteDate(),
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
  const assistantDraft = createDraftAssistantMessage(clientRequestId, new SvelteDate());

  pendingDrafts.set(clientRequestId, {
    clientRequestId,
    conversationId,
  });

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
    agentState.isStreaming = false;
  }
}
