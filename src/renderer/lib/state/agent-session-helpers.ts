import type { ChatConversation } from "../../../shared/types/database.js";

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
