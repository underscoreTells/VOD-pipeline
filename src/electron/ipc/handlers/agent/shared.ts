import { randomUUID } from 'node:crypto';
import {
  getAssetsForChapter,
  getChapter,
  getChatConversation,
  getProject,
  getSuggestionsByConversation,
  updateChatConversation,
  createChatMessage,
} from '../../../database/index.js';
import type {
  ChatConversation,
  ChatConversationMessage,
  ExecutionTraceEntry,
  Suggestion,
} from '../../../../shared/types/database.js';
import type { AgentChatData } from '../../../../shared/types/agent-ipc.js';
import type {
  ProviderConfigPayload,
  ProxyOptions,
} from '../../../../shared/contracts/electron-api.js';
import { normalizeNamingModel } from '../../../../shared/llm/naming-models.js';
import type { getAgentBridge } from '../../../agent-bridge.js';
import { getBackendRuntimeStaleness } from '../../../dev-runtime.js';
import { createLogger } from '../../../logger.js';
import { suggestConversationTitle } from '../../../services/naming-service.js';
import {
  appendExecutionTraceEntry,
  serializeExecutionTrace,
} from '../../../../shared/utils/execution-trace.js';
import { sanitizeAssistantContent } from '../../../../shared/utils/assistant-content.js';
import { deriveConversationTitle } from '../../../../shared/utils/conversation-title.js';
import { IPC_ERROR_CODES } from '../../channels.js';
import {
  applyNearLimitTokenGuard,
  buildAgentChatContext,
  getAgentGroundingStatus,
  normalizeConversationProvider,
  parseConversationTurnResult,
  persistAgentSuggestions,
  toNumberOrNull,
} from '../../handler-support.js';

export const logger = createLogger('AgentHandlers');

export class AgentHandlerError extends Error {
  constructor(
    message: string,
    readonly code: typeof IPC_ERROR_CODES[keyof typeof IPC_ERROR_CODES]
  ) {
    super(message);
    this.name = 'AgentHandlerError';
  }
}

export function requireProjectId(projectId: number | null): number {
  if (!projectId) {
    throw new AgentHandlerError('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
  }

  return projectId;
}

export function requireConversationId(conversationId: number | null): number {
  if (!conversationId) {
    throw new AgentHandlerError('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
  }

  return conversationId;
}

export function requireMessageId(messageId: number | null): number {
  if (!messageId) {
    throw new AgentHandlerError('Message ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
  }

  return messageId;
}

export async function resolveConversationContext(
  projectId: number,
  conversationId: number,
  provider?: string,
  options: { requireFreshRuntime?: boolean } = {}
): Promise<{
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>;
  conversation: ChatConversation;
  effectiveProvider: string | undefined;
}> {
  const project = await getProject(projectId);
  if (!project) {
    throw new AgentHandlerError('Project not found', IPC_ERROR_CODES.NOT_FOUND);
  }

  const conversation = await getChatConversation(conversationId);
  if (!conversation) {
    throw new AgentHandlerError('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
  }
  if (conversation.project_id !== projectId) {
    throw new AgentHandlerError(
      'Conversation does not belong to project',
      IPC_ERROR_CODES.VALIDATION_ERROR
    );
  }

  const chapter = await getChapter(conversation.chapter_id);
  if (!chapter) {
    throw new AgentHandlerError('Conversation chapter not found', IPC_ERROR_CODES.NOT_FOUND);
  }
  if (chapter.project_id !== projectId) {
    throw new AgentHandlerError(
      'Conversation chapter does not belong to project',
      IPC_ERROR_CODES.VALIDATION_ERROR
    );
  }

  if (options.requireFreshRuntime) {
    const staleRuntime = await getBackendRuntimeStaleness();
    if (staleRuntime) {
      logger.warn(
        'agent:chat stale dev runtime',
        staleRuntime.runtimeSessionId,
        staleRuntime.startupFingerprint,
        staleRuntime.currentFingerprint
      );
      throw new AgentHandlerError(
        'Backend code changed since this Electron session started. Restarting is required.',
        IPC_ERROR_CODES.STALE_DEV_RUNTIME
      );
    }
  }

  return {
    chapter,
    conversation,
    effectiveProvider: provider ?? conversation.provider ?? undefined,
  };
}

export async function syncConversationProvider(
  conversation: ChatConversation,
  provider?: string
): Promise<ChatConversation> {
  if (!provider || provider === conversation.provider) {
    return conversation;
  }

  const normalizedProvider = normalizeConversationProvider(provider);
  await updateChatConversation(conversation.id, {
    provider: normalizedProvider,
  });

  return {
    ...conversation,
    provider: normalizedProvider,
  };
}

export async function resolveConversationThreadId(
  conversation: ChatConversation,
  options: { forceRotate?: boolean } = {}
): Promise<string> {
  const existingThreadId = conversation.thread_id?.trim();
  const threadId = options.forceRotate || !existingThreadId
    ? randomUUID()
    : existingThreadId;

  if (options.forceRotate || !existingThreadId || existingThreadId !== threadId) {
    await updateChatConversation(conversation.id, { thread_id: threadId });
  }

  return threadId;
}

export async function assertChapterGroundingReady(
  projectId: number,
  chapterId: number
): Promise<void> {
  const grounding = await getAgentGroundingStatus(projectId, chapterId, {
    ensureReady: false,
  });

  if (grounding.status === 'ready') {
    return;
  }

  const assetError = grounding.assets.find((asset) => asset.status === 'error')?.error;
  const message = assetError
    ? `${grounding.message} ${assetError}`
    : grounding.message;

  throw new AgentHandlerError(
    message,
    IPC_ERROR_CODES.AGENT_PROXY_NOT_READY
  );
}

export function sanitizeConversationHistory(
  messages: ChatConversationMessage[]
): Array<{ role: string; content: string }> {
  return messages.map((item) => ({
    role: item.role,
    content: item.role === 'assistant'
      ? sanitizeAssistantContent(item.content)
      : item.content,
  }));
}

export async function generateConversationTitle(
  message: string,
  chapterTitle: string | undefined,
  threadNamingModel: ReturnType<typeof normalizeNamingModel>,
  agentConfig: ProviderConfigPayload | undefined,
  signal?: AbortSignal
): Promise<string> {
  let generatedTitle: string | null = null;

  try {
    generatedTitle = await suggestConversationTitle({
      message,
      chapterTitle,
      model: threadNamingModel,
      providerConfig: agentConfig,
      signal,
    });
  } catch (error) {
    signal?.throwIfAborted();
    logger.warn('agent:thread-title fallback', error);
  }

  return generatedTitle ?? deriveConversationTitle(message);
}

export async function runConversationTurn(
  agentBridge: ReturnType<typeof getAgentBridge>,
  options: {
    agentConfig?: ProviderConfigPayload;
    chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>;
    clientRequestId: string;
    conversation: ChatConversation;
    conversationHistory: Array<{ role: string; content: string }>;
    effectiveProvider?: string;
    playheadTime?: number;
    projectId: number;
    proxyOptions?: ProxyOptions;
    selectedClipIds: number[];
    threadId: string;
    userMessageId: number;
    userCreatedAt: string;
    signal?: AbortSignal;
  }
): Promise<AgentChatData> {
  options.signal?.throwIfAborted();
  const chapterAssetIds = await getAssetsForChapter(options.chapter.id);
  const chapterDuration = Math.max(0.01, options.chapter.end_time - options.chapter.start_time);
  const existingSuggestions = await getSuggestionsByConversation(
    options.conversation.id,
    options.chapter.id
  );
  const initialContext = await buildAgentChatContext(options.projectId, options.chapter.id, {
    ensureChapterProxyReady: false,
  });
  options.signal?.throwIfAborted();
  const contextWithSuggestions = {
    ...initialContext,
    suggestionSummary: summarizeSuggestions(existingSuggestions),
  };

  const guardedInitialPayload = applyNearLimitTokenGuard(
    options.conversationHistory,
    contextWithSuggestions,
    options.effectiveProvider
  );

  if (guardedInitialPayload.compressed) {
    logger.info(
      'agent:token-guard',
      options.conversation.id,
      options.effectiveProvider || 'default',
      `${guardedInitialPayload.estimatedTotalTokens}/${guardedInitialPayload.effectiveContextLimit}`
    );
  }

  await waitForAbortable(agentBridge.ensureStarted(), options.signal);
  let executionTrace: ExecutionTraceEntry[] = [];
  const response = await agentBridge.send({
    type: 'chat',
    threadId: options.threadId,
    messages: guardedInitialPayload.messages,
    metadata: {
      projectId: String(options.projectId),
      provider: options.effectiveProvider,
      chapterId: String(options.chapter.id),
      selectedClipIds: options.selectedClipIds,
      playheadTime: options.playheadTime,
      agentConfig: options.agentConfig,
      context: contextWithSuggestions,
    },
  }, {
    streamContext: {
      clientRequestId: options.clientRequestId,
      projectId: String(options.projectId),
      chapterId: String(options.chapter.id),
      conversationId: options.conversation.id,
    },
    onStreamEvent: (streamMessage) => {
      if (streamMessage.type === 'assistant_text_delta') {
        return;
      }

      if (streamMessage.type === 'tool_state') {
        executionTrace = appendExecutionTraceEntry(executionTrace, {
          status: `tool_${streamMessage.state}`,
          message:
            streamMessage.message ??
            streamMessage.error ??
            `${streamMessage.toolName} ${streamMessage.state}`,
          nodeName: streamMessage.toolName,
          stepIndex: streamMessage.stepIndex,
        });
        return;
      }

      if (streamMessage.type === 'status') {
        executionTrace = appendExecutionTraceEntry(executionTrace, {
          status: streamMessage.status,
          message: streamMessage.message,
          nodeName: streamMessage.nodeName,
          stepIndex: streamMessage.stepIndex,
        });
      }
    },
    signal: options.signal,
  });

  if (response.type === 'error') {
    throw new Error(response.error);
  }
  if (response.type !== 'turn_complete') {
    throw new Error('Unexpected agent response type');
  }
  options.signal?.throwIfAborted();

  const finalResult = response.result && typeof response.result === 'object'
    ? (response.result as Record<string, unknown>)
    : {};
  const finalParsed = parseConversationTurnResult(finalResult, chapterDuration, chapterAssetIds);
  const assistantMessage = finalParsed.message || 'Analysis complete';
  const thinkingMarkdown = finalParsed.thinkingMarkdown;
  const persistedAssistantMessage = await createChatMessage({
    conversation_id: options.conversation.id,
    role: 'assistant',
    content: assistantMessage,
    thinking_markdown: thinkingMarkdown,
    trace_json: serializeExecutionTrace(executionTrace),
  });
  const persistedSuggestions = await persistAgentSuggestions(
    options.chapter.id,
    options.conversation.id,
    persistedAssistantMessage.id,
    options.effectiveProvider,
    finalParsed.suggestionDrafts
  );

  return {
    message: assistantMessage,
    thinkingMarkdown: thinkingMarkdown ?? undefined,
    threadId: options.threadId,
    userMessageId: options.userMessageId,
    assistantMessageId: persistedAssistantMessage.id,
    userCreatedAt: options.userCreatedAt,
    assistantCreatedAt: persistedAssistantMessage.created_at,
    suggestions: persistedSuggestions,
    outcome: finalParsed.outcome,
  };
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function summarizeSuggestions(suggestions: Suggestion[]): string {
  if (suggestions.length === 0) {
    return '- none';
  }

  return suggestions
    .slice(0, 12)
    .map((suggestion) => {
      const prefix = suggestion.action_type === 'update_clip'
        ? `update clip #${suggestion.target_clip_id ?? 'unknown'}`
        : 'keep window';
      return `- ${prefix} ${suggestion.in_point.toFixed(2)}-${suggestion.out_point.toFixed(
        2
      )}s status=${suggestion.status} desc=${suggestion.description ?? ''}`.trim();
    })
    .join('\n');
}

export interface ConversationTurnPayload {
  clientRequestId: string;
  projectId: number | null;
  conversationId: number | null;
  provider: string | undefined;
  selectedClipIds: number[];
  playheadTime: number | undefined;
  proxyOptions: ProxyOptions | undefined;
  agentConfig: ProviderConfigPayload | undefined;
}

export function parseConversationTurnPayload(payload: unknown): ConversationTurnPayload {
  const value = (payload ?? {}) as Record<string, unknown>;

  const clientRequestId =
    typeof value.clientRequestId === 'string' ? value.clientRequestId.trim() : '';
  const projectId = toNumberOrNull(value.projectId);
  const conversationId = toNumberOrNull(value.conversationId);
  const provider = typeof value.provider === 'string' ? value.provider : undefined;
  const selectedClipIds = Array.isArray(value.selectedClipIds)
    ? value.selectedClipIds.filter(
      (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item)
    )
    : [];
  const playheadTime = toNumberOrNull(value.playheadTime) ?? undefined;
  const proxyOptions =
    value.proxyOptions && typeof value.proxyOptions === 'object'
      ? value.proxyOptions as ProxyOptions
      : undefined;
  const agentConfig = value.agentConfig && typeof value.agentConfig === 'object'
    ? value.agentConfig as ProviderConfigPayload
    : undefined;

  return {
    clientRequestId,
    projectId,
    conversationId,
    provider,
    selectedClipIds,
    playheadTime,
    proxyOptions,
    agentConfig,
  };
}
