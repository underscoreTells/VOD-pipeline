import type {
  AgentGroundingStatus,
  AgentGroundingStatusData,
  ProviderConfigPayload,
} from "../../../shared/contracts/electron-api.js";
import type {
  ChatConversation,
  ChatConversationMessage,
  ChatEntityMention,
  ExecutionTraceEntry,
  Suggestion,
} from "../../../shared/types/database";
import type { TimelineAction } from "../../../shared/types/agent-ipc";
import {
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from "../../../shared/utils/assistant-content.js";
import { parseExecutionTraceJson } from "../../../shared/utils/execution-trace.js";
import { parseChatMentions } from '../../../shared/utils/chat-mentions.js';
import {
  buildConversationContextKey,
  isConversationContextRequestCurrent,
  resolveConversationSelection,
  resolveChatModelConfiguration,
  setProviderReasoningEffort,
  shouldChangeChapterContext,
} from "./agent-session-helpers.js";
import {
  buildProviderConfig,
  buildProxyOptions,
  getConfiguredProviders,
} from "./settings-helpers.js";
import {
  createAgentConversation,
  deleteAgentConversation,
  getAgentGroundingStatus,
  getAgentConversationMessages,
  getSuggestions,
  listAgentConversations,
  updateAgentConversation,
} from "../api/agent.js";
import { onProxyProgress } from "../api/proxies.js";
import { saveSettings, settingsState } from "./settings.svelte";
import {
  getProviderMetadata,
  type LLMProviderType,
  type ReasoningEffort,
} from "../../../shared/llm/provider-registry.js";

export type { LLMProviderType };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinkingMarkdown: string | null;
  trace: ExecutionTraceEntry[];
  id: string;
  databaseId: number | null;
  timestamp: Date;
  mentions: ChatEntityMention[];
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

export interface ActiveAgentTurn {
  clientRequestId: string;
  projectId: string;
  chapterId: string;
  conversationId: number;
  kind: 'send' | 'reroll' | 'edit';
  status: 'running' | 'cancelling';
}

export interface AgentState {
  messages: ChatMessage[];
  conversations: ChatConversation[];
  selectedConversationId: number | null;
  isLoadingConversations: boolean;
  suggestions: Suggestion[];
  selectedSuggestionId: number | null;
  composerDrafts: Record<string, string>;
  composerMentionDrafts: Record<string, ChatEntityMention[]>;
  timelineProposals: TimelineActionProposal[];
  selectedProvider: LLMProviderType;
  selectedModel: string;
  selectedReasoningEffort: ReasoningEffort | null;
  isStreaming: boolean;
  activeTurn: ActiveAgentTurn | null;
  currentProjectId: string | null;
  currentChapterId: string | null;
  isGroundingStatusLoading: boolean;
  groundingStatus: AgentGroundingStatus;
  groundingMessage: string | null;
  groundingRequiredVideoAssetCount: number;
  groundingReadyVideoAssetCount: number;
  groundingErrorDetail: string | null;
  proxyProgressPercent: number | null;
  error: string | null;
}

export const agentState = $state<AgentState>({
  messages: [],
  conversations: [],
  selectedConversationId: null,
  isLoadingConversations: false,
  suggestions: [],
  selectedSuggestionId: null,
  composerDrafts: {},
  composerMentionDrafts: {},
  timelineProposals: [],
  selectedProvider: "gemini",
  selectedModel: getProviderMetadata('gemini').defaultModel,
  selectedReasoningEffort: null,
  isStreaming: false,
  activeTurn: null,
  currentProjectId: null,
  currentChapterId: null,
  isGroundingStatusLoading: false,
  groundingStatus: "idle",
  groundingMessage: null,
  groundingRequiredVideoAssetCount: 0,
  groundingReadyVideoAssetCount: 0,
  groundingErrorDetail: null,
  proxyProgressPercent: null,
  error: null,
});

let chapterLoadToken = 0;
let groundingLoadToken = 0;
let groundingPollTimeout: ReturnType<typeof setTimeout> | null = null;
let proxyProgressUnsubscribe: (() => void) | null = null;

/**
 * Subscribe to proxy generation progress events from the main process.
 * Updates `agentState.proxyProgressPercent` so the chat UI can render a real
 * progress bar instead of the previous indeterminate "preparing" text. Only
 * progress for the currently-loaded chapter is applied; events for other
 * chapters are ignored.
 *
 * Called once on app init; returns a no-op if already subscribed.
 */
export function initProxyProgressSubscription(): void {
  if (proxyProgressUnsubscribe) {
    return;
  }
  proxyProgressUnsubscribe = onProxyProgress((data) => {
    if (agentState.currentChapterId !== String(data.chapterId)) {
      return;
    }
    agentState.proxyProgressPercent = data.percent;
    if (data.percent >= 100 && agentState.currentProjectId && agentState.currentChapterId) {
      clearGroundingPoll();
      const requestToken = groundingLoadToken;
      const requestContextKey = getCurrentGroundingContextKey();
      const chapterId = agentState.currentChapterId;
      const projectId = agentState.currentProjectId;
      groundingPollTimeout = setTimeout(() => {
        void refreshGroundingStatus({
          chapterId,
          projectId,
          requestContextKey,
          requestToken,
          ensureReady: false,
          pollDelayMs: 500,
        });
      }, 150);
    }
  });
}

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
  const config = buildProviderConfig(settingsState.settings, agentState.selectedProvider) as ProviderConfigPayload;
  config.models = {
    ...config.models,
    [agentState.selectedProvider]: agentState.selectedModel,
  };
  config.reasoningEfforts = setProviderReasoningEffort(
    config.reasoningEfforts ?? {},
    agentState.selectedProvider,
    agentState.selectedReasoningEffort
  );
  return config;
}

function applyConversationModelConfiguration(conversation: ChatConversation | undefined): void {
  const configuration = resolveChatModelConfiguration({
    conversation,
    configuredProviders: getConfiguredProviders(settingsState.settings),
    defaultProvider: settingsState.settings.defaultVideoProvider ?? 'gemini',
    providerModels: settingsState.settings.providerModels ?? {},
    providerReasoningEfforts: settingsState.settings.providerReasoningEfforts ?? {},
  });
  agentState.selectedProvider = configuration.provider;
  agentState.selectedModel = configuration.model;
  agentState.selectedReasoningEffort = configuration.reasoningEffort;
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
    mentions: parseChatMentions(item.mentions_json),
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
  agentState.isGroundingStatusLoading = false;
  agentState.groundingStatus = status;
  agentState.groundingMessage = null;
  agentState.groundingRequiredVideoAssetCount = 0;
  agentState.groundingReadyVideoAssetCount = 0;
  agentState.groundingErrorDetail = null;
  agentState.proxyProgressPercent = null;
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
  if (data.status !== "generating") {
    agentState.proxyProgressPercent = data.status === "ready" ? 100 : null;
  }
}

async function refreshGroundingStatus(options: {
  chapterId: string;
  projectId: string;
  requestContextKey: string;
  requestToken: number;
  ensureReady: boolean;
  pollDelayMs?: number;
}): Promise<void> {
  let response;
  try {
    response = await getAgentGroundingStatus({
      projectId: options.projectId,
      chapterId: options.chapterId,
      ensureReady: options.ensureReady,
      proxyOptions: buildProxyOptions(settingsState.settings),
    });
  } catch (error) {
    if (!isCurrentGroundingContextRequest(options.requestToken, options.requestContextKey)) {
      return;
    }

    clearGroundingPoll();
    agentState.isGroundingStatusLoading = false;
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
    agentState.isGroundingStatusLoading = false;
    agentState.groundingStatus = "error";
    agentState.groundingMessage = response.error || "Failed to load agent grounding status.";
    agentState.groundingRequiredVideoAssetCount = 0;
    agentState.groundingReadyVideoAssetCount = 0;
    agentState.groundingErrorDetail = null;
    return;
  }

  agentState.isGroundingStatusLoading = false;
  applyGroundingStatus(response.data);

  if (import.meta.env.DEV) {
    console.debug(
      "[AgentSession] grounding-status",
      options.chapterId,
      response.data.status,
      `${response.data.readyVideoAssetCount}/${response.data.requiredVideoAssetCount}`
    );
  }

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
    }, options.pollDelayMs ?? 5000);
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
    agentState.selectedSuggestionId = null;
  }
}

async function loadConversationSuggestions(
  chapterId: string,
  conversationId: number,
  requestToken?: number,
  requestContextKey?: string,
  isStillValid?: () => boolean
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

  if (isStillValid && !isStillValid()) {
    return;
  }

  if (!response.success) {
    agentState.error = response.error || "Failed to load suggestions";
    agentState.suggestions = [];
    return;
  }

  agentState.suggestions = response.data ?? [];
  agentState.selectedSuggestionId = null;
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
    applyConversationModelConfiguration(undefined);
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
  applyConversationModelConfiguration(
    selectionState.sortedConversations.find((conversation) => conversation.id === selectionState.targetConversationId)
  );
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
    model: agentState.selectedModel,
    reasoningEffort: agentState.selectedReasoningEffort,
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
  applyConversationModelConfiguration(conversation);
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

  resetGroundingState("idle");
  agentState.isGroundingStatusLoading = true;
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
    allowWhileStreaming?: boolean;
    isStillValid?: () => boolean;
  }
) {
  if (!options?.allowWhileStreaming && isStreamingBlocked()) {
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

  // Reconciliation reloads can race a queued chapter change or a replacement
  // send while the messages IPC is in flight; bail before touching shared
  // state when the caller's context is no longer current.
  if (options?.isStillValid && !options.isStillValid()) {
    return false;
  }

  if (!response.success || !response.data) {
    agentState.error = response.error || "Failed to load conversation messages";
    return false;
  }

  agentState.selectedConversationId = conversationId;
  applyConversationModelConfiguration(
    agentState.conversations.find((conversation) => conversation.id === conversationId)
  );
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
    options?.requestContextKey,
    options?.isStillValid
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
  agentState.selectedModel = settingsState.settings.providerModels[provider]
    || getProviderMetadata(provider).defaultModel;
  agentState.selectedReasoningEffort = settingsState.settings.providerReasoningEfforts?.[provider] ?? null;
}

export async function setChatModelConfiguration(
  provider: LLMProviderType,
  model: string,
  reasoningEffort: ReasoningEffort | null
): Promise<boolean> {
  if (
    isStreamingBlocked()
    || !model.trim()
  ) return false;
  agentState.selectedProvider = provider;
  agentState.selectedModel = model.trim();
  agentState.selectedReasoningEffort = reasoningEffort;
  settingsState.settings.providerModels = {
    ...settingsState.settings.providerModels,
    [provider]: model.trim(),
  };
  settingsState.settings.providerReasoningEfforts = setProviderReasoningEffort(
    settingsState.settings.providerReasoningEfforts,
    provider,
    reasoningEffort
  );
  void saveSettings().catch((error) => console.error('[AgentSession] Failed to save model default:', error));

  const conversationId = agentState.selectedConversationId;
  if (!conversationId) return true;
  const response = await updateAgentConversation({
    conversationId,
    provider,
    model: model.trim(),
    reasoningEffort,
  });
  if (!response.success || !response.data) {
    agentState.error = response.error || 'Failed to update conversation model';
    return false;
  }
  agentState.conversations = agentState.conversations.map((conversation) =>
    conversation.id === conversationId ? response.data! : conversation
  );
  return true;
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
