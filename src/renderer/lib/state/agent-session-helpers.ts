import type { ChatConversation } from "../../../shared/types/database.js";
import {
  getProviderMetadata,
  providerModelSupportsVideo,
  providerSupportsVideo,
  type LLMProviderType,
  type ReasoningEffort,
} from "../../../shared/llm/provider-registry.js";

export interface ConversationSelectionState {
  sortedConversations: ChatConversation[];
  targetConversationId: number | null;
  shouldReloadMessages: boolean;
  shouldClearMessages: boolean;
}

export interface ResolveConversationSelectionOptions {
  hasLoadedMessages: boolean;
  preserveSelection: boolean;
  selectedConversationId: number | null;
}

export interface ConversationContextRequest {
  token: number;
  contextKey: string;
}

export interface VideoModelConfiguration {
  provider: LLMProviderType;
  model: string;
  reasoningEffort: ReasoningEffort | null;
}

export function resolveVideoModelConfiguration(options: {
  conversation?: ChatConversation;
  configuredProviders: readonly LLMProviderType[];
  defaultProvider: LLMProviderType;
  providerModels: Partial<Record<LLMProviderType, string>>;
  providerReasoningEfforts: Partial<Record<LLMProviderType, ReasoningEffort>>;
}): VideoModelConfiguration {
  const configuredVideoProviders = options.configuredProviders.filter(providerSupportsVideo);
  const preferredDefault = providerSupportsVideo(options.defaultProvider)
    ? options.defaultProvider
    : 'gemini';
  const conversationProvider = options.conversation?.provider;
  const provider = conversationProvider
    && configuredVideoProviders.includes(conversationProvider)
    ? conversationProvider
    : configuredVideoProviders.includes(preferredDefault)
      ? preferredDefault
      : configuredVideoProviders[0] ?? preferredDefault;
  const conversationModel = conversationProvider === provider
    ? options.conversation?.model
    : null;
  const preferredModel = conversationModel || options.providerModels[provider];
  const model = preferredModel && providerModelSupportsVideo(provider, preferredModel)
    ? preferredModel
    : getProviderMetadata(provider).defaultModel;
  const reasoningEffort = conversationModel === model
    ? options.conversation?.reasoning_effort ?? null
    : options.providerReasoningEfforts[provider] ?? null;

  return { provider, model, reasoningEffort };
}

export function shouldChangeChapterContext(
  currentChapterId: string | null,
  nextChapterId: string | null
): boolean {
  return currentChapterId !== nextChapterId;
}

export function buildConversationContextKey(
  projectId: string | null,
  chapterId: string | null
): string {
  return `${projectId ?? "none"}:${chapterId ?? "none"}`;
}

export function isConversationContextRequestCurrent(
  request: ConversationContextRequest,
  current: ConversationContextRequest
): boolean {
  return request.token === current.token && request.contextKey === current.contextKey;
}

export function sortChatConversations(items: ChatConversation[]): ChatConversation[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updated_at).getTime();
    const bTime = new Date(b.updated_at).getTime();
    return bTime - aTime;
  });
}

export function resolveConversationSelection(
  conversations: ChatConversation[],
  options: ResolveConversationSelectionOptions
): ConversationSelectionState {
  const sortedConversations = sortChatConversations(conversations);

  if (sortedConversations.length === 0) {
    return {
      sortedConversations,
      targetConversationId: null,
      shouldReloadMessages: false,
      shouldClearMessages: true,
    };
  }

  const canPreserveSelection =
    options.preserveSelection
    && options.selectedConversationId !== null
    && sortedConversations.some(
      (conversation) => conversation.id === options.selectedConversationId
    );

  const targetConversationId = canPreserveSelection
    ? options.selectedConversationId
    : sortedConversations[0].id;

  const shouldReloadMessages =
    targetConversationId !== null
    && (targetConversationId !== options.selectedConversationId || !options.hasLoadedMessages);

  return {
    sortedConversations,
    targetConversationId,
    shouldReloadMessages,
    shouldClearMessages: false,
  };
}
