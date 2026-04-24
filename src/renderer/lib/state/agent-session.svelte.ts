import type {
  AgentGroundingStatus,
  AgentGroundingStatusData,
  ProviderConfigPayload,
} from "../../../shared/contracts/electron-api.js";
import type {
  ChatConversation,
  ChatConversationMessage,
  ExecutionTraceEntry,
  Suggestion,
} from "../../../shared/types/database";
import type { TimelineAction } from "../../../shared/types/agent-ipc";
import {
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from "../../../shared/utils/assistant-content.js";
import { parseExecutionTraceJson } from "../../../shared/utils/execution-trace.js";
import {
  buildConversationContextKey,
  isConversationContextRequestCurrent,
  resolveConversationSelection,
  shouldChangeChapterContext,
} from "./agent-session-helpers.js";
import { buildProviderConfig } from "./settings-helpers.js";
import {
  createAgentConversation,
  deleteAgentConversation,
  getAgentGroundingStatus,
  getAgentConversationMessages,
  getSuggestions,
  listAgentConversations,
} from "../api/agent.js";
import { settingsState } from "./settings.svelte";

export type LLMProviderType = "gemini" | "openai" | "anthropic" | "openrouter" | "kimi";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinkingMarkdown: string | null;
  trace: ExecutionTraceEntry[];
  id: string;
  databaseId: number | null;
  timestamp: Date;
  requestId?: string;
  isStreaming?: boolean;
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
  groundingStatus: AgentGroundingStatus;
  groundingMessage: string | null;
  groundingRequiredVideoAssetCount: number;
  groundingReadyVideoAssetCount: number;
  groundingErrorDetail: string | null;
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
  groundingStatus: "idle",
  groundingMessage: null,
  groundingRequiredVideoAssetCount: 0,
  groundingReadyVideoAssetCount: 0,
  groundingErrorDetail: null,
  error: null,
});

let chapterLoadToken = 0;
let groundingLoadToken = 0;
let groundingPollTimeout: ReturnType<typeof setTimeout> | null = null;

function setStreamingBlockedError() {
  agentState.error = "Wait for the current response to finish before changing chat context.";
}

function isStreamingBlocked(): boolean {
  if (!agentState.isStreaming) {
    return false;
  }

  setStreamingBlockedError();
  return true;
}

export function buildProviderEnvFromSettings() {
  return buildProviderConfig(settingsState.settings, agentState.selectedProvider) as ProviderConfigPayload;
}

export function mapConversationMessages(messages: ChatConversationMessage[]): ChatMessage[] {
  return messages.map((item) => ({
    role: item.role,
    content: item.role === "assistant"
      ? sanitizeAssistantContent(item.content)
      : item.content,
    thinkingMarkdown: item.role === "assistant" && typeof item.thinking_markdown === "string"
      ? sanitizeThinkingMarkdown(item.thinking_markdown) || null
      : null,
    trace: parseExecutionTraceJson(item.trace_json),
    id: `db-${item.id}`,
    databaseId: item.id,
    timestamp: new Date(item.created_at),
  }));
}

export function insertConversation(conversation: ChatConversation): void {
  agentState.conversations = resolveConversationSelection(
    [conversation, ...agentState.conversations],
    {
      hasLoadedMessages: agentState.messages.length > 0,
      preserveSelection: false,
      selectedConversationId: agentState.selectedConversationId,
    }
  ).sortedConversations;
}

function getCurrentConversationContextKey(): string {
  return buildConversationContextKey(
    agentState.currentProjectId,
    agentState.currentChapterId
  );
}

function isCurrentConversationContextRequest(
  token: number,
  contextKey: string
): boolean {
  return isConversationContextRequestCurrent(
    { token, contextKey },
    { token: chapterLoadToken, contextKey: getCurrentConversationContextKey() }
  );
}

function clearGroundingPoll(): void {
  if (groundingPollTimeout) {
    clearTimeout(groundingPollTimeout);
    groundingPollTimeout = null;
  }
}

function resetGroundingState(status: AgentGroundingStatus = "idle"): void {
  clearGroundingPoll();
  agentState.groundingStatus = status;
  agentState.groundingMessage = status === "generating"
    ? "Video proxy is still preparing. Agent chat is locked until grounding is ready."
    : null;
  agentState.groundingRequiredVideoAssetCount = 0;
  agentState.groundingReadyVideoAssetCount = 0;
  agentState.groundingErrorDetail = null;
}

function getCurrentGroundingContextKey(): string {
  return buildConversationContextKey(
    agentState.currentProjectId,
    agentState.currentChapterId
  );
}

function isCurrentGroundingContextRequest(
  token: number,
  contextKey: string
): boolean {
  return isConversationContextRequestCurrent(
    { token, contextKey },
    { token: groundingLoadToken, contextKey: getCurrentGroundingContextKey() }
  );
}

function applyGroundingStatus(data: AgentGroundingStatusData): void {
  agentState.groundingStatus = data.status;
  agentState.groundingMessage = data.message;
  agentState.groundingRequiredVideoAssetCount = data.requiredVideoAssetCount;
  agentState.groundingReadyVideoAssetCount = data.readyVideoAssetCount;
  agentState.groundingErrorDetail =
    data.assets.find((asset) => asset.status === "error" && asset.error)?.error ?? null;
}

async function refreshGroundingStatus(options: {
  chapterId: string;
  projectId: string;
  requestContextKey: string;
  requestToken: number;
  ensureReady: boolean;
}): Promise<void> {
  let response;
  try {
    response = await getAgentGroundingStatus({
      projectId: options.projectId,
      chapterId: options.chapterId,
      ensureReady: options.ensureReady,
    });
  } catch (error) {
    if (!isCurrentGroundingContextRequest(options.requestToken, options.requestContextKey)) {
      return;
    }

    clearGroundingPoll();
    agentState.groundingStatus = "error";
    agentState.groundingMessage = error instanceof Error
      ? error.message
      : "Failed to load agent grounding status.";
    agentState.groundingRequiredVideoAssetCount = 0;
    agentState.groundingReadyVideoAssetCount = 0;
    agentState.groundingErrorDetail = null;
    return;
  }

  if (!isCurrentGroundingContextRequest(options.requestToken, options.requestContextKey)) {
    return;
  }

  if (!response.success || !response.data) {
    clearGroundingPoll();
    agentState.groundingStatus = "error";
    agentState.groundingMessage = response.error || "Failed to load agent grounding status.";
    agentState.groundingRequiredVideoAssetCount = 0;
    agentState.groundingReadyVideoAssetCount = 0;
    agentState.groundingErrorDetail = null;
    return;
  }

  applyGroundingStatus(response.data);

  if (response.data.status === "generating") {
    clearGroundingPoll();
    groundingPollTimeout = setTimeout(() => {
      void refreshGroundingStatus({
        chapterId: options.chapterId,
        projectId: options.projectId,
        requestContextKey: options.requestContextKey,
        requestToken: options.requestToken,
        ensureReady: false,
      });
    }, 5000);
    return;
  }

  clearGroundingPoll();
}

function clearChapterConversationState(clearSuggestions: boolean): void {
  agentState.timelineProposals = [];
  agentState.messages = [];
  agentState.conversations = [];
  agentState.selectedConversationId = null;
  agentState.error = null;

  if (clearSuggestions) {
    agentState.suggestions = [];
  }
}

async function loadConversationSuggestions(
  chapterId: string,
  conversationId: number,
  requestToken?: number,
  requestContextKey?: string
): Promise<void> {
  const response = await getSuggestions({
    chapterId,
    conversationId,
  });

  if (
    requestToken !== undefined &&
    requestContextKey !== undefined &&
    !isCurrentConversationContextRequest(requestToken, requestContextKey)
  ) {
    return;
  }

  if (!response.success) {
    agentState.error = response.error || "Failed to load suggestions";
    agentState.suggestions = [];
    return;
  }

  agentState.suggestions = response.data ?? [];
}

async function loadChapterConversations(options: {
  chapterId: string;
  preserveSelection: boolean;
  projectId: string;
  requestContextKey?: string;
  requestToken?: number;
}): Promise<void> {
  const response = await listAgentConversations({
    projectId: options.projectId,
    chapterId: options.chapterId,
  });

  if (
    options.requestToken !== undefined &&
    options.requestContextKey !== undefined &&
    !isCurrentConversationContextRequest(options.requestToken, options.requestContextKey)
  ) {
    return;
  }

  if (!response.success) {
    agentState.error = response.error || "Failed to load conversations";
    return;
  }

  const selectionState = resolveConversationSelection(response.data ?? [], {
    hasLoadedMessages: agentState.messages.length > 0,
    preserveSelection: options.preserveSelection,
    selectedConversationId: agentState.selectedConversationId,
  });

  agentState.conversations = selectionState.sortedConversations;

  if (selectionState.shouldClearMessages) {
    agentState.selectedConversationId = null;
    agentState.messages = [];
    agentState.timelineProposals = [];
    agentState.suggestions = [];
    return;
  }

  if (selectionState.targetConversationId !== null && selectionState.shouldReloadMessages) {
    await selectConversation(selectionState.targetConversationId, {
      requestContextKey: options.requestContextKey,
      requestToken: options.requestToken,
    });
    return;
  }

  agentState.selectedConversationId = selectionState.targetConversationId;
}

async function createConversation(title?: string): Promise<ChatConversation | null> {
  if (!agentState.currentProjectId || !agentState.currentChapterId) {
    agentState.error = "Select a project chapter before creating a conversation.";
    return null;
  }

  const requestContextKey = buildConversationContextKey(
    agentState.currentProjectId,
    agentState.currentChapterId
  );

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
  if (requestContextKey !== getCurrentConversationContextKey()) {
    return conversation;
  }

  insertConversation(conversation);
  agentState.selectedConversationId = conversation.id;
  agentState.messages = [];
  agentState.timelineProposals = [];
  agentState.suggestions = [];
  agentState.error = null;
  return conversation;
}

export async function syncAgentContext(
  projectId: string | null,
  chapterId: string | null
) {
  if (isStreamingBlocked()) {
    return;
  }

  const nextContextKey = buildConversationContextKey(projectId, chapterId);
  if (nextContextKey === getCurrentConversationContextKey()) {
    return;
  }

  const token = ++chapterLoadToken;
  const groundingToken = ++groundingLoadToken;
  agentState.currentProjectId = projectId;
  agentState.currentChapterId = chapterId;
  clearChapterConversationState(true);

  if (!projectId || !chapterId) {
    agentState.isLoadingConversations = false;
    resetGroundingState("idle");
    return;
  }

  resetGroundingState("generating");
  agentState.isLoadingConversations = true;

  try {
    await Promise.all([
      loadChapterConversations({
        chapterId,
        preserveSelection: false,
        projectId,
        requestContextKey: nextContextKey,
        requestToken: token,
      }),
      refreshGroundingStatus({
        chapterId,
        projectId,
        requestContextKey: nextContextKey,
        requestToken: groundingToken,
        ensureReady: true,
      }),
    ]);
  } finally {
    if (isCurrentConversationContextRequest(token, nextContextKey)) {
      agentState.isLoadingConversations = false;
    }
  }
}

export function setProjectContext(projectId: string | null) {
  if (isStreamingBlocked()) {
    return;
  }

  const nextChapterId = agentState.currentProjectId === projectId
    ? agentState.currentChapterId
    : null;

  void syncAgentContext(projectId, nextChapterId);
}

export async function createNewConversation() {
  if (isStreamingBlocked()) {
    return null;
  }

  return await createConversation();
}

export async function selectConversation(
  conversationId: number,
  options?: {
    requestContextKey?: string;
    requestToken?: number;
  }
) {
  if (isStreamingBlocked()) {
    return false;
  }

  const response = await getAgentConversationMessages(conversationId);
  if (
    options?.requestToken !== undefined &&
    options.requestContextKey !== undefined &&
    !isCurrentConversationContextRequest(options.requestToken, options.requestContextKey)
  ) {
    return false;
  }

  if (!response.success || !response.data) {
    agentState.error = response.error || "Failed to load conversation messages";
    return false;
  }

  agentState.selectedConversationId = conversationId;
  agentState.messages = mapConversationMessages(response.data);
  agentState.timelineProposals = [];
  agentState.suggestions = [];

  if (!agentState.currentChapterId) {
    return true;
  }

  await loadConversationSuggestions(
    agentState.currentChapterId,
    conversationId,
    options?.requestToken,
    options?.requestContextKey
  );
  return true;
}

export async function removeConversation(conversationId: number) {
  if (isStreamingBlocked()) {
    return false;
  }

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
      agentState.timelineProposals = [];
      agentState.suggestions = [];
    }
  }

  return true;
}

export function setProvider(provider: LLMProviderType) {
  if (isStreamingBlocked()) {
    return;
  }

  agentState.selectedProvider = provider;
}

export async function setChapterContext(chapterId: string | null, _proxyPath: string | null) {
  if (isStreamingBlocked()) {
    return;
  }

  if (!shouldChangeChapterContext(agentState.currentChapterId, chapterId)) {
    return;
  }

  await syncAgentContext(agentState.currentProjectId, chapterId);
}

export function clearMessages() {
  agentState.messages = [];
}

export async function ensureActiveConversation(): Promise<number | null> {
  if (!agentState.currentProjectId) {
    agentState.error = "No project selected. Please open a project first.";
    return null;
  }

  if (!agentState.currentChapterId) {
    agentState.error = "Select a chapter before starting a conversation.";
    return null;
  }

  if (agentState.selectedConversationId) {
    return agentState.selectedConversationId;
  }

  const created = await createConversation();
  return created?.id ?? null;
}

export async function refreshConversationListMetadata(): Promise<void> {
  if (!agentState.currentProjectId || !agentState.currentChapterId) {
    return;
  }

  const requestContextKey = getCurrentConversationContextKey();
  const requestToken = ++chapterLoadToken;

  await loadChapterConversations({
    chapterId: agentState.currentChapterId,
    preserveSelection: true,
    projectId: agentState.currentProjectId,
    requestContextKey,
    requestToken,
  });
}
