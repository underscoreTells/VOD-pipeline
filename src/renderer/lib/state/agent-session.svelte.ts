import { v4 as uuidv4 } from "uuid";
import type {
  ChatConversation,
  ChatConversationMessage,
  Clip,
  Suggestion,
} from "../../../shared/types/database";
import type { TimelineAction } from "../../../shared/types/agent-ipc";
import {
  applyAgentActions,
  applyAllSuggestions as applyAllAgentSuggestions,
  applySuggestion as applyAgentSuggestion,
  agentChat,
  cancelSuggestionPreview as cancelAgentSuggestionPreview,
  createAgentConversation,
  deleteAgentConversation,
  getSuggestions,
  getAgentConversationMessages,
  listAgentConversations,
  previewSuggestion as previewAgentSuggestion,
  rejectSuggestion as rejectAgentSuggestion,
} from "../api/agent.js";
import { settingsState } from "./settings.svelte";
import {
  timelineState,
  createClip as createTimelineClip,
  deleteClip as deleteTimelineClip,
  selectClip,
  setPlayhead,
  updateClip as updateTimelineClip,
} from "./timeline.svelte";

export type LLMProviderType = "gemini" | "openai" | "anthropic" | "openrouter" | "kimi";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  id: string;
  timestamp: Date;
}

export interface TimelineActionProposal {
  id: string;
  messageId: string;
  action: TimelineAction;
  status: "pending" | "applied" | "rejected" | "failed";
  error: string | null;
}

export interface AgentState {
  messages: ChatMessage[];
  conversations: ChatConversation[];
  selectedConversationId: number | null;
  isLoadingConversations: boolean;
  suggestions: Suggestion[];
  timelineProposals: TimelineActionProposal[];
  selectedProvider: LLMProviderType;
  isStreaming: boolean;
  currentProjectId: string | null;
  currentChapterId: string | null;
  error: string | null;
}

export const agentState = $state<AgentState>({
  messages: [],
  conversations: [],
  selectedConversationId: null,
  isLoadingConversations: false,
  suggestions: [],
  timelineProposals: [],
  selectedProvider: "gemini",
  isStreaming: false,
  currentProjectId: null,
  currentChapterId: null,
  error: null,
});

let chapterLoadToken = 0;

function buildProviderEnvFromSettings() {
  const providers: Record<string, string> = {};
  const { settings } = settingsState;

  if (settings.geminiApiKey.trim()) {
    providers.gemini = settings.geminiApiKey.trim();
  }
  if (settings.openaiApiKey.trim()) {
    providers.openai = settings.openaiApiKey.trim();
  }
  if (settings.anthropicApiKey.trim()) {
    providers.anthropic = settings.anthropicApiKey.trim();
  }
  if (settings.openrouterApiKey.trim()) {
    providers.openrouter = settings.openrouterApiKey.trim();
  }
  if (settings.kimiApiKey.trim()) {
    providers.kimi = settings.kimiApiKey.trim();
  }

  return {
    defaultProvider: agentState.selectedProvider,
    providers,
  };
}

function sortConversations(items: ChatConversation[]): ChatConversation[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updated_at).getTime();
    const bTime = new Date(b.updated_at).getTime();
    return bTime - aTime;
  });
}

function mapConversationMessages(messages: ChatConversationMessage[]): ChatMessage[] {
  return messages.map((item) => ({
    role: item.role,
    content: item.content,
    id: `db-${item.id}`,
    timestamp: new Date(item.created_at),
  }));
}

async function refreshConversations(autoCreateIfEmpty: boolean, reloadMessages: boolean = true): Promise<void> {
  if (!agentState.currentProjectId || !agentState.currentChapterId) {
    agentState.conversations = [];
    agentState.selectedConversationId = null;
    agentState.messages = [];
    return;
  }

  const response = await listAgentConversations({
    projectId: agentState.currentProjectId,
    chapterId: agentState.currentChapterId,
  });

  if (!response.success) {
    agentState.error = response.error || "Failed to load conversations";
    return;
  }

  const sorted = sortConversations(response.data ?? []);
  agentState.conversations = sorted;

  if (sorted.length === 0) {
    agentState.selectedConversationId = null;
    agentState.messages = [];
    if (autoCreateIfEmpty) {
      await createConversation();
    }
    return;
  }

  const selectedId = agentState.selectedConversationId;
  const hasCurrent = selectedId !== null && sorted.some((conversation) => conversation.id === selectedId);
  const targetId = hasCurrent ? selectedId : sorted[0].id;

  agentState.selectedConversationId = targetId;
  if (reloadMessages) {
    await selectConversation(targetId);
  }
}

async function createConversation(title?: string): Promise<ChatConversation | null> {
  if (!agentState.currentProjectId || !agentState.currentChapterId) {
    agentState.error = "Select a project chapter before creating a conversation.";
    return null;
  }

  const response = await createAgentConversation({
    projectId: agentState.currentProjectId,
    chapterId: agentState.currentChapterId,
    provider: agentState.selectedProvider,
    title,
  });

  if (!response.success || !response.data) {
    agentState.error = response.error || "Failed to create conversation";
    return null;
  }

  const conversation = response.data;
  agentState.conversations = sortConversations([conversation, ...agentState.conversations]);
  agentState.selectedConversationId = conversation.id;
  agentState.messages = [];
  agentState.timelineProposals = [];
  agentState.error = null;
  return conversation;
}

export function setProjectContext(projectId: string | null) {
  if (agentState.currentProjectId === projectId) {
    return;
  }

  agentState.currentProjectId = projectId;
  agentState.currentChapterId = null;
  agentState.conversations = [];
  agentState.selectedConversationId = null;
  agentState.messages = [];
  agentState.timelineProposals = [];
  agentState.suggestions = [];
  agentState.error = null;
}

export async function createNewConversation() {
  return await createConversation();
}

export async function selectConversation(conversationId: number) {
  const response = await getAgentConversationMessages(conversationId);
  if (!response.success || !response.data) {
    agentState.error = response.error || "Failed to load conversation messages";
    return false;
  }

  agentState.selectedConversationId = conversationId;
  agentState.messages = mapConversationMessages(response.data);
  agentState.timelineProposals = [];
  return true;
}

export async function removeConversation(conversationId: number) {
  const response = await deleteAgentConversation(conversationId);
  if (!response.success) {
    agentState.error = response.error || "Failed to delete conversation";
    return false;
  }

  agentState.conversations = agentState.conversations.filter((conversation) => conversation.id !== conversationId);

  if (agentState.selectedConversationId === conversationId) {
    if (agentState.conversations.length > 0) {
      await selectConversation(agentState.conversations[0].id);
    } else {
      agentState.selectedConversationId = null;
      agentState.messages = [];
      await createConversation();
    }
  }

  return true;
}

export async function sendChatMessage(message: string) {
  if (!message.trim()) return;

  if (!agentState.currentProjectId) {
    agentState.error = "No project selected. Please open a project first.";
    return;
  }

  if (!agentState.currentChapterId) {
    agentState.error = "Select a chapter before starting a conversation.";
    return;
  }

  let conversationId = agentState.selectedConversationId;
  if (!conversationId) {
    const created = await createConversation();
    if (!created) {
      return;
    }
    conversationId = created.id;
  }

  const userMessage: ChatMessage = {
    role: "user",
    content: message,
    id: uuidv4(),
    timestamp: new Date(),
  };

  agentState.messages.push(userMessage);
  agentState.isStreaming = true;
  agentState.error = null;

  try {
    const response = await agentChat({
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

      if (Array.isArray(result.suggestions) && result.suggestions.length > 0) {
        agentState.suggestions.push(...(result.suggestions as unknown as Suggestion[]));
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.message || "Analysis complete",
        id: uuidv4(),
        timestamp: new Date(),
      };

      agentState.messages.push(assistantMessage);

      if (Array.isArray(result.timelineActions) && result.timelineActions.length > 0) {
        const proposals = result.timelineActions.map((action) => ({
          id: uuidv4(),
          messageId: assistantMessage.id,
          action,
          status: "pending" as const,
          error: null,
        }));
        agentState.timelineProposals = [...agentState.timelineProposals, ...proposals];
      }

      await refreshConversations(false, false);
      if (agentState.selectedConversationId !== conversationId) {
        await selectConversation(conversationId);
      }
    } else {
      agentState.error = response.error || "Unknown error";
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `Error: ${agentState.error}`,
        id: uuidv4(),
        timestamp: new Date(),
      };
      agentState.messages.push(errorMessage);
    }
  } catch (error) {
    agentState.error = (error as Error).message;
    const errorMessage: ChatMessage = {
      role: "assistant",
      content: `Error: ${agentState.error}`,
      id: uuidv4(),
      timestamp: new Date(),
    };
    agentState.messages.push(errorMessage);
  } finally {
    agentState.isStreaming = false;
  }
}

export function setProvider(provider: LLMProviderType) {
  agentState.selectedProvider = provider;
}

export async function setChapterContext(chapterId: string | null, _proxyPath: string | null) {
  agentState.currentChapterId = chapterId;
  agentState.timelineProposals = [];
  agentState.messages = [];
  agentState.conversations = [];
  agentState.selectedConversationId = null;
  agentState.error = null;

  if (!chapterId || !agentState.currentProjectId) {
    agentState.suggestions = [];
    return;
  }

  const token = ++chapterLoadToken;
  agentState.isLoadingConversations = true;

  try {
    await loadSuggestions(chapterId);
    if (token !== chapterLoadToken) {
      return;
    }
    await refreshConversations(true);
  } finally {
    if (token === chapterLoadToken) {
      agentState.isLoadingConversations = false;
    }
  }
}

export function clearMessages() {
  agentState.messages = [];
}
