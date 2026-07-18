import { SvelteDate, SvelteMap } from "svelte/reactivity";
import { v4 as uuidv4 } from "uuid";
import {
  agentChat,
  branchAgentMessage,
  cancelAgentTurn,
  editAgentMessage,
  onAgentError,
  onAgentStream,
  rerollAgentMessage,
} from "../api/agent.js";
import {
  agentState,
  buildProviderEnvFromSettings,
  ensureActiveConversation,
  insertConversation,
  refreshConversationListMetadata,
  selectConversation,
  type ChatMessage,
} from "./agent-session.svelte.js";
import {
  appendAssistantTextDeltaToDraft,
  appendTraceEventToDraft,
  createDraftAssistantMessage,
  failDraftMessage,
  finalizeDraftMessage,
} from "./agent-streaming-helpers.js";
import { loadSuggestions } from "./agent-proposals.svelte.js";
import { timelineState } from "./timeline.svelte";
import {
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from "../../../shared/utils/assistant-content.js";
import type { AgentChatData } from "../../../shared/types/agent-ipc.js";
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
} from "../../../shared/utils/conversation-title.js";
import { settingsState } from "./settings.svelte";
import { buildProxyOptions } from "./settings-helpers.js";

type StreamingMutationKind = "send" | "reroll" | "edit";

interface PendingDraft {
  clientRequestId: string;
  conversationId: number;
  projectId: string;
  chapterId: string;
  userMessageDatabaseId?: number;
  userMessageLocalId?: string;
}

const pendingDrafts = new SvelteMap<string, PendingDraft>();
let streamUnsubscribe: (() => void) | null = null;
let errorUnsubscribe: (() => void) | null = null;

function getToolProgressLabel(toolName: string, state: string): string {
  const labels: Record<string, string> = {
    analyzeChapterVideo: 'Analyzing chapter video',
    loadDetailedTranscriptWindows: 'Reading detailed transcript',
    draftRoughCutProposals: 'Drafting suggested cuts',
    finalizeConversationTurn: 'Writing the editing recommendation',
  };
  const label = labels[toolName] ?? 'Checking editing context';
  return state === 'completed' ? `${label} complete` : label;
}

function ensureStreamingSubscriptions(): void {
  if (!streamUnsubscribe) {
    streamUnsubscribe = onAgentStream((event) => {
      const pending = pendingDrafts.get(event.clientRequestId);
      if (
        !pending
        || pending.conversationId !== event.conversationId
        || pending.projectId !== event.projectId
        || pending.chapterId !== event.chapterId
        || agentState.currentProjectId !== event.projectId
        || agentState.currentChapterId !== event.chapterId
        || agentState.selectedConversationId !== event.conversationId
      ) {
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
            message: event.error ?? getToolProgressLabel(event.toolName, event.state),
            nodeName: event.toolName,
            passIndex: event.passIndex,
            stepIndex: event.stepIndex,
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
    databaseId: null,
    timestamp: new SvelteDate(),
  };
}

function updateConversationTitle(conversationId: number, title: string): void {
  agentState.conversations = agentState.conversations.map((conversation) =>
    conversation.id === conversationId
      ? { ...conversation, title }
      : conversation
  );
}

function updateMessagePersistence(
  messages: ChatMessage[],
  matcher: (message: ChatMessage) => boolean,
  metadata: {
    content?: string;
    databaseId?: number;
    thinkingMarkdown?: string | null;
    timestamp?: string;
  }
): ChatMessage[] {
  return messages.map((message) => {
    if (!matcher(message)) {
      return message;
    }

    return {
      ...message,
      content: metadata.content ?? message.content,
      databaseId: metadata.databaseId ?? message.databaseId,
      thinkingMarkdown:
        metadata.thinkingMarkdown !== undefined
          ? metadata.thinkingMarkdown
          : message.thinkingMarkdown,
      timestamp: metadata.timestamp ? new Date(metadata.timestamp) : message.timestamp,
      id: metadata.databaseId ? `db-${metadata.databaseId}` : message.id,
    };
  });
}

function finalizeSuccessfulMutation(
  messages: ChatMessage[],
  pendingDraft: PendingDraft,
  result: AgentChatData
): ChatMessage[] {
  const finalMessage = sanitizeAssistantContent(result.message || "Analysis complete");
  const finalThinkingMarkdown = typeof result.thinkingMarkdown === "string"
    ? sanitizeThinkingMarkdown(result.thinkingMarkdown) || null
    : null;

  let nextMessages = finalizeDraftMessage(
    messages,
    pendingDraft.clientRequestId,
    finalMessage,
    finalThinkingMarkdown
  );

  if (typeof result.assistantMessageId === "number") {
    nextMessages = updateMessagePersistence(
      nextMessages,
      (message) => message.requestId === pendingDraft.clientRequestId,
      {
        databaseId: result.assistantMessageId,
        timestamp: result.assistantCreatedAt,
      }
    );
  }

  if (typeof result.userMessageId === "number") {
    nextMessages = updateMessagePersistence(
      nextMessages,
      (message) =>
        (pendingDraft.userMessageLocalId !== undefined && message.id === pendingDraft.userMessageLocalId)
        || (
          pendingDraft.userMessageDatabaseId !== undefined
          && message.databaseId === pendingDraft.userMessageDatabaseId
        ),
      {
        databaseId: result.userMessageId,
        timestamp: result.userCreatedAt,
      }
    );
  }

  return nextMessages;
}

function getStreamingMutationContext():
  | {
    currentChapterId: string;
    currentProjectId: string;
    selectedClipIds: number[];
    playheadTime: number;
  }
  | null {
  if (!agentState.currentProjectId) {
    agentState.error = "No project selected. Please open a project first.";
    return null;
  }

  if (!agentState.currentChapterId) {
    agentState.error = "Select a chapter before starting a conversation.";
    return null;
  }

  return {
    currentChapterId: agentState.currentChapterId,
    currentProjectId: agentState.currentProjectId,
    selectedClipIds: Array.from(timelineState.selectedClipIds),
    playheadTime: timelineState.playheadTime,
  };
}

async function refreshSuggestions(conversationId: number): Promise<void> {
  if (!agentState.currentChapterId || agentState.selectedConversationId !== conversationId) {
    return;
  }

  try {
    await loadSuggestions(agentState.currentChapterId, conversationId);
  } catch (error) {
    console.error("[AgentStreaming] Failed to refresh suggestions:", error);
  }
}

async function runStreamingMutation(options: {
  conversationId: number;
  kind: StreamingMutationKind;
  optimisticMessages: ChatMessage[];
  pendingDraft: PendingDraft;
  request: (clientRequestId: string) => Promise<{ success: boolean; data?: AgentChatData; error?: string }>;
}): Promise<boolean> {
  ensureStreamingSubscriptions();

  agentState.messages = options.optimisticMessages;
  agentState.isStreaming = true;
  agentState.error = null;
  pendingDrafts.set(options.pendingDraft.clientRequestId, options.pendingDraft);
  agentState.activeTurn = {
    clientRequestId: options.pendingDraft.clientRequestId,
    projectId: options.pendingDraft.projectId,
    chapterId: options.pendingDraft.chapterId,
    conversationId: options.pendingDraft.conversationId,
    kind: options.kind,
    status: 'running',
  };

  let shouldReloadConversation = false;

  try {
    const response = await options.request(options.pendingDraft.clientRequestId);
    const isCurrentContext =
      agentState.currentProjectId === options.pendingDraft.projectId
      && agentState.currentChapterId === options.pendingDraft.chapterId
      && agentState.selectedConversationId === options.pendingDraft.conversationId;

    if (!isCurrentContext) {
      return response.success;
    }
    if (response.success && response.data) {
      agentState.messages = finalizeSuccessfulMutation(
        agentState.messages,
        options.pendingDraft,
        response.data
      );

      if (options.kind === "send") {
        if (Array.isArray(response.data.suggestions) && response.data.suggestions.length > 0) {
          agentState.suggestions.push(...response.data.suggestions);
        }
      } else {
        await refreshSuggestions(options.conversationId);
      }

      return true;
    }

    const errorMessage = response.error || "Unknown error";
    const wasCancelled = agentState.activeTurn?.clientRequestId === options.pendingDraft.clientRequestId
      && agentState.activeTurn.status === 'cancelling';
    if (wasCancelled) {
      agentState.messages = agentState.messages.filter(
        (message) => message.requestId !== options.pendingDraft.clientRequestId
      );
      agentState.error = null;
      shouldReloadConversation = true;
      return false;
    }
    agentState.error = errorMessage;
    agentState.messages = failDraftMessage(
      agentState.messages,
      options.pendingDraft.clientRequestId,
      errorMessage
    );
    shouldReloadConversation = options.kind !== "send";
    return false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    agentState.error = errorMessage;
    agentState.messages = failDraftMessage(
      agentState.messages,
      options.pendingDraft.clientRequestId,
      errorMessage
    );
    shouldReloadConversation = options.kind !== "send";
    return false;
  } finally {
    pendingDrafts.delete(options.pendingDraft.clientRequestId);
    agentState.isStreaming = false;
    if (agentState.activeTurn?.clientRequestId === options.pendingDraft.clientRequestId) {
      agentState.activeTurn = null;
    }

    if (shouldReloadConversation) {
      try {
        await selectConversation(options.conversationId);
      } catch (error) {
        console.error("[AgentStreaming] Failed to reload conversation after mutation error:", error);
      }
    }

    try {
      await refreshConversationListMetadata();
    } catch (error) {
      console.error("[AgentStreaming] Failed to refresh conversation metadata:", error);
    }
  }
}

function getRetainedUserMessage(targetMessage: ChatMessage): ChatMessage | null {
  if (targetMessage.role === "user") {
    return targetMessage;
  }

  const targetIndex = agentState.messages.findIndex((message) => message.id === targetMessage.id);
  if (targetIndex < 0) {
    return null;
  }

  return [...agentState.messages.slice(0, targetIndex)]
    .reverse()
    .find((message) => message.role === "user") ?? null;
}

export async function sendChatMessage(message: string) {
  if (!message.trim() || agentState.isStreaming) {
    return false;
  }

  const mutationContext = getStreamingMutationContext();
  if (!mutationContext) {
    return false;
  }

  const conversationId = await ensureActiveConversation();
  if (!conversationId) {
    return false;
  }

  const clientRequestId = uuidv4();
  const shouldOptimisticallyRenameConversation =
    agentState.messages.length === 0
    && agentState.conversations.some(
      (conversation) =>
        conversation.id === conversationId
        && conversation.title === DEFAULT_CONVERSATION_TITLE
    );
  const userMessage = buildUserMessage(message);
  const assistantDraft = createDraftAssistantMessage(clientRequestId, new SvelteDate());

  if (shouldOptimisticallyRenameConversation) {
    updateConversationTitle(conversationId, deriveConversationTitle(message));
  }

  return await runStreamingMutation({
    conversationId,
    kind: "send",
    optimisticMessages: [...agentState.messages, userMessage, assistantDraft],
    pendingDraft: {
      clientRequestId,
      conversationId,
      projectId: mutationContext.currentProjectId,
      chapterId: mutationContext.currentChapterId,
      userMessageLocalId: userMessage.id,
    },
    request: async (requestId) => await agentChat({
      clientRequestId: requestId,
      projectId: mutationContext.currentProjectId,
      conversationId,
      message,
      provider: agentState.selectedProvider,
      selectedClipIds: mutationContext.selectedClipIds,
      playheadTime: mutationContext.playheadTime,
      proxyOptions: buildProxyOptions(settingsState.settings),
      threadNamingModel: settingsState.settings.autoThreadNamingModel,
      agentConfig: buildProviderEnvFromSettings(),
    }),
  });
}

export async function rerollMessage(targetMessage: ChatMessage) {
  if (
    agentState.isStreaming
    || targetMessage.role === "system"
    || targetMessage.databaseId === null
  ) {
    return false;
  }

  const mutationContext = getStreamingMutationContext();
  if (!mutationContext) {
    return false;
  }

  const conversationId = agentState.selectedConversationId;
  if (!conversationId) {
    agentState.error = "No conversation selected.";
    return false;
  }

  const retainedUserMessage = getRetainedUserMessage(targetMessage);
  if (!retainedUserMessage || retainedUserMessage.databaseId === null) {
    agentState.error = "Reroll requires a user message anchor.";
    return false;
  }

  const retainedIndex = agentState.messages.findIndex(
    (message) => message.id === retainedUserMessage.id
  );
  if (retainedIndex < 0) {
    agentState.error = "Message not found.";
    return false;
  }

  const clientRequestId = uuidv4();
  const assistantDraft = createDraftAssistantMessage(clientRequestId, new SvelteDate());

  return await runStreamingMutation({
    conversationId,
    kind: "reroll",
    optimisticMessages: [
      ...agentState.messages.slice(0, retainedIndex + 1),
      assistantDraft,
    ],
    pendingDraft: {
      clientRequestId,
      conversationId,
      projectId: mutationContext.currentProjectId,
      chapterId: mutationContext.currentChapterId,
      userMessageDatabaseId: retainedUserMessage.databaseId,
    },
    request: async (requestId) => await rerollAgentMessage({
      clientRequestId: requestId,
      projectId: mutationContext.currentProjectId,
      conversationId,
      messageId: targetMessage.databaseId,
      provider: agentState.selectedProvider,
      selectedClipIds: mutationContext.selectedClipIds,
      playheadTime: mutationContext.playheadTime,
      proxyOptions: buildProxyOptions(settingsState.settings),
      agentConfig: buildProviderEnvFromSettings(),
    }),
  });
}

export async function editMessage(targetMessage: ChatMessage, message: string) {
  if (
    agentState.isStreaming
    || targetMessage.role !== "user"
    || targetMessage.databaseId === null
    || !message.trim()
  ) {
    return false;
  }

  const mutationContext = getStreamingMutationContext();
  if (!mutationContext) {
    return false;
  }

  const conversationId = agentState.selectedConversationId;
  if (!conversationId) {
    agentState.error = "No conversation selected.";
    return false;
  }

  const targetIndex = agentState.messages.findIndex((item) => item.id === targetMessage.id);
  if (targetIndex < 0) {
    agentState.error = "Message not found.";
    return false;
  }

  const clientRequestId = uuidv4();
  const assistantDraft = createDraftAssistantMessage(clientRequestId, new SvelteDate());
  const updatedUserMessage: ChatMessage = {
    ...targetMessage,
    content: message,
  };

  return await runStreamingMutation({
    conversationId,
    kind: "edit",
    optimisticMessages: [
      ...agentState.messages.slice(0, targetIndex),
      updatedUserMessage,
      assistantDraft,
    ],
    pendingDraft: {
      clientRequestId,
      conversationId,
      projectId: mutationContext.currentProjectId,
      chapterId: mutationContext.currentChapterId,
      userMessageDatabaseId: targetMessage.databaseId,
    },
    request: async (requestId) => await editAgentMessage({
      clientRequestId: requestId,
      projectId: mutationContext.currentProjectId,
      conversationId,
      messageId: targetMessage.databaseId,
      message,
      provider: agentState.selectedProvider,
      selectedClipIds: mutationContext.selectedClipIds,
      playheadTime: mutationContext.playheadTime,
      proxyOptions: buildProxyOptions(settingsState.settings),
      threadNamingModel: settingsState.settings.autoThreadNamingModel,
      agentConfig: buildProviderEnvFromSettings(),
    }),
  });
}

export async function branchMessage(targetMessage: ChatMessage) {
  if (agentState.isStreaming || targetMessage.databaseId === null || targetMessage.role === "system") {
    return false;
  }

  if (!agentState.currentProjectId) {
    agentState.error = "No project selected. Please open a project first.";
    return false;
  }

  const conversationId = agentState.selectedConversationId;
  if (!conversationId) {
    agentState.error = "No conversation selected.";
    return false;
  }

  agentState.error = null;

  try {
    const response = await branchAgentMessage({
      projectId: agentState.currentProjectId,
      conversationId,
      messageId: targetMessage.databaseId,
    });

    if (!response.success || !response.data) {
      agentState.error = response.error || "Failed to branch conversation";
      return false;
    }

    insertConversation(response.data);
    await selectConversation(response.data.id);
    return true;
  } catch (error) {
    agentState.error = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export async function cancelActiveAgentTurn(): Promise<boolean> {
  const activeTurn = agentState.activeTurn;
  if (!activeTurn || activeTurn.status === 'cancelling') {
    return !activeTurn;
  }

  agentState.activeTurn = { ...activeTurn, status: 'cancelling' };
  const response = await cancelAgentTurn(activeTurn.clientRequestId);
  if (!response.success) {
    if (agentState.activeTurn?.clientRequestId === activeTurn.clientRequestId) {
      agentState.activeTurn = { ...activeTurn, status: 'running' };
    }
    agentState.error = response.error || 'Failed to cancel the agent response.';
    return false;
  }

  const deadline = Date.now() + 5000;
  while (
    agentState.activeTurn?.clientRequestId === activeTurn.clientRequestId
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  if (agentState.activeTurn?.clientRequestId === activeTurn.clientRequestId) {
    agentState.error = 'The agent did not stop in time. The chapter was not changed.';
    return false;
  }

  return true;
}
