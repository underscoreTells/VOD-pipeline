import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import {
  cloneChatMessagesThrough,
  createChatConversation,
  createChatMessage,
  createClip,
  deleteChatMessagesAfter,
  deleteChatConversation,
  getAssetsByProject,
  getAssetsForChapter,
  getChapter,
  getChatConversation,
  getChatConversationsByChapter,
  getChatMessageByConversation,
  getChatMessagesByConversation,
  getClip,
  getProject,
  getSuggestionsByConversation,
  updateUserChatMessageContent,
  updateChatConversation,
  updateClip,
} from '../../database/index.js';
import type {
  ChatConversation,
  ChatConversationMessage,
  Clip,
  ExecutionTraceEntry,
  Suggestion,
} from '../../../shared/types/database.js';
import type {
  AgentChatData,
  TimelineAction,
} from '../../../shared/types/agent-ipc.js';
import type { ProviderConfigPayload, ProxyOptions } from '../../../shared/contracts/electron-api.js';
import { normalizeNamingModel } from '../../../shared/llm/naming-models.js';
import { getAgentBridge } from '../../agent-bridge.js';
import { getBackendRuntimeStaleness } from '../../dev-runtime.js';
import { createLogger } from '../../logger.js';
import { suggestConversationTitle } from '../../services/naming-service.js';
import {
  appendExecutionTraceEntry,
  serializeExecutionTrace,
} from '../../../shared/utils/execution-trace.js';
import { sanitizeAssistantContent } from '../../../shared/utils/assistant-content.js';
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
} from '../../../shared/utils/conversation-title.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import {
  applyNearLimitTokenGuard,
  buildAgentChatContext,
  getAgentGroundingStatus,
  normalizeConversationProvider,
  normalizeTimelineActions,
  parseConversationTurnResult,
  persistAgentSuggestions,
  toNumberOrNull,
} from '../handler-support.js';

const logger = createLogger('AgentHandlers');

class AgentHandlerError extends Error {
  constructor(
    message: string,
    readonly code: typeof IPC_ERROR_CODES[keyof typeof IPC_ERROR_CODES]
  ) {
    super(message);
    this.name = 'AgentHandlerError';
  }
}

function requireProjectId(projectId: number | null): number {
  if (!projectId) {
    throw new AgentHandlerError('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
  }

  return projectId;
}

function requireConversationId(conversationId: number | null): number {
  if (!conversationId) {
    throw new AgentHandlerError('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
  }

  return conversationId;
}

function requireMessageId(messageId: number | null): number {
  if (!messageId) {
    throw new AgentHandlerError('Message ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
  }

  return messageId;
}

async function resolveConversationContext(
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

async function syncConversationProvider(
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

async function resolveConversationThreadId(
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

async function assertChapterGroundingReady(
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

function sanitizeConversationHistory(
  messages: ChatConversationMessage[]
): Array<{ role: string; content: string }> {
  return messages.map((item) => ({
    role: item.role,
    content: item.role === 'assistant'
      ? sanitizeAssistantContent(item.content)
      : item.content,
  }));
}

async function generateConversationTitle(
  message: string,
  chapterTitle: string | undefined,
  threadNamingModel: ReturnType<typeof normalizeNamingModel>,
  agentConfig: ProviderConfigPayload | undefined
): Promise<string> {
  let generatedTitle: string | null = null;

  try {
    generatedTitle = await suggestConversationTitle({
      message,
      chapterTitle,
      model: threadNamingModel,
      providerConfig: agentConfig,
    });
  } catch (error) {
    logger.warn('agent:thread-title fallback', error);
  }

  return generatedTitle ?? deriveConversationTitle(message);
}

async function runConversationTurn(
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
  }
): Promise<AgentChatData> {
  const chapterAssetIds = await getAssetsForChapter(options.chapter.id);
  const chapterDuration = Math.max(0.01, options.chapter.end_time - options.chapter.start_time);
  const existingSuggestions = await getSuggestionsByConversation(
    options.conversation.id,
    options.chapter.id
  );
  const initialContext = await buildAgentChatContext(options.projectId, options.chapter.id, {
    ensureChapterProxyReady: true,
    proxyOptions: options.proxyOptions,
  });
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

  await agentBridge.ensureStarted();
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
        });
        return;
      }

      if (streamMessage.type === 'status') {
        executionTrace = appendExecutionTraceEntry(executionTrace, {
          status: streamMessage.status,
          message: streamMessage.message,
          nodeName: streamMessage.nodeName,
        });
      }
    },
  });

  if (response.type === 'error') {
    throw new Error(response.error);
  }
  if (response.type !== 'turn_complete') {
    throw new Error('Unexpected agent response type');
  }

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

function summarizeSuggestions(suggestions: Suggestion[]): string {
  if (suggestions.length === 0) {
    return '- none';
  }

  return suggestions
    .slice(0, 12)
    .map((suggestion) => {
      const prefix = suggestion.action_type === 'update_clip'
        ? `update clip #${suggestion.target_clip_id ?? 'unknown'}`
        : 'create proposal';
      return `- ${prefix} ${suggestion.in_point.toFixed(2)}-${suggestion.out_point.toFixed(
        2
      )}s status=${suggestion.status} desc=${suggestion.description ?? ''}`.trim();
    })
    .join('\n');
}

export const AGENT_HANDLER_CHANNELS = [
  IPC_CHANNELS.AGENT_CONVERSATION_CREATE,
  IPC_CHANNELS.AGENT_CONVERSATION_LIST,
  IPC_CHANNELS.AGENT_CONVERSATION_MESSAGES,
  IPC_CHANNELS.AGENT_CONVERSATION_DELETE,
  IPC_CHANNELS.AGENT_CHAT,
  IPC_CHANNELS.AGENT_GROUNDING_STATUS,
  IPC_CHANNELS.AGENT_REROLL_MESSAGE,
  IPC_CHANNELS.AGENT_EDIT_MESSAGE,
  IPC_CHANNELS.AGENT_BRANCH_MESSAGE,
  IPC_CHANNELS.AGENT_APPLY_ACTIONS,
];

export function registerAgentHandlers(): void {
  const agentBridge = getAgentBridge();

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_CREATE, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const provider = typeof payload?.provider === 'string' ? payload.provider : null;
    const titleRaw = typeof payload?.title === 'string' ? payload.title.trim() : '';

    logger.info('agent:conversation-create', projectId, chapterId, provider);

    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!chapterId) {
        return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const chapter = await getChapter(chapterId);
      if (!chapter) {
        return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (chapter.project_id !== projectId) {
        return createErrorResponse('Chapter does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const conversation = await createChatConversation({
        project_id: projectId,
        chapter_id: chapterId,
        title: titleRaw || DEFAULT_CONVERSATION_TITLE,
        provider: normalizeConversationProvider(provider),
        thread_id: randomUUID(),
      });

      return createSuccessResponse(conversation);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_LIST, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);

    logger.info('agent:conversation-list', projectId, chapterId);

    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!chapterId) {
        return createErrorResponse('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      return createSuccessResponse(await getChatConversationsByChapter(projectId, chapterId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_MESSAGES, async (_, payload) => {
    const conversationId = toNumberOrNull(payload?.conversationId);
    logger.info('agent:conversation-messages', conversationId);

    try {
      if (!conversationId) {
        return createErrorResponse('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const conversation = await getChatConversation(conversationId);
      if (!conversation) {
        return createErrorResponse('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      return createSuccessResponse(await getChatMessagesByConversation(conversationId));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_DELETE, async (_, payload) => {
    const conversationId = toNumberOrNull(payload?.conversationId);
    logger.info('agent:conversation-delete', conversationId);

    try {
      if (!conversationId) {
        return createErrorResponse('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const success = await deleteChatConversation(conversationId);
      if (!success) {
        return createErrorResponse('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_, payload) => {
    const clientRequestId =
      typeof payload?.clientRequestId === 'string' ? payload.clientRequestId.trim() : '';
    const projectId = toNumberOrNull(payload?.projectId);
    const conversationId = toNumberOrNull(payload?.conversationId);
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    const provider = typeof payload?.provider === 'string' ? payload.provider : undefined;
    const selectedClipIds = Array.isArray(payload?.selectedClipIds)
      ? payload.selectedClipIds.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
      : [];
    const playheadTime = toNumberOrNull(payload?.playheadTime) ?? undefined;
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions as ProxyOptions
        : undefined;
    const threadNamingModel = normalizeNamingModel(payload?.threadNamingModel);
    const agentConfig = payload?.agentConfig && typeof payload.agentConfig === 'object'
      ? payload.agentConfig as ProviderConfigPayload
      : undefined;

    logger.info('agent:chat', projectId, conversationId, provider);

    try {
      if (!clientRequestId) {
        throw new AgentHandlerError(
          'Client request ID is required',
          IPC_ERROR_CODES.VALIDATION_ERROR
        );
      }
      if (!message) {
        throw new AgentHandlerError('Message is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const normalizedProjectId = requireProjectId(projectId);
      const normalizedConversationId = requireConversationId(conversationId);
      const {
        chapter,
        conversation,
        effectiveProvider,
      } = await resolveConversationContext(
        normalizedProjectId,
        normalizedConversationId,
        provider,
        { requireFreshRuntime: true }
      );
      await assertChapterGroundingReady(normalizedProjectId, chapter.id);
      const syncedConversation = await syncConversationProvider(conversation, provider);
      const existingMessages = await getChatMessagesByConversation(syncedConversation.id);
      const persistedUserMessage = await createChatMessage({
        conversation_id: syncedConversation.id,
        role: 'user',
        content: message,
        thinking_markdown: null,
        trace_json: null,
      });

      if (
        syncedConversation.title === DEFAULT_CONVERSATION_TITLE &&
        existingMessages.length === 0
      ) {
        await updateChatConversation(syncedConversation.id, {
          title: await generateConversationTitle(
            message,
            chapter.title,
            threadNamingModel,
            agentConfig
          ),
        });
      }

      const threadId = await resolveConversationThreadId(syncedConversation);
      const normalized = await runConversationTurn(agentBridge, {
        agentConfig,
        chapter,
        clientRequestId,
        conversation: syncedConversation,
        conversationHistory: sanitizeConversationHistory([
          ...existingMessages,
          persistedUserMessage,
        ]),
        effectiveProvider,
        playheadTime,
        projectId: normalizedProjectId,
        proxyOptions,
        selectedClipIds,
        threadId,
        userMessageId: persistedUserMessage.id,
        userCreatedAt: persistedUserMessage.created_at,
      });

      return createSuccessResponse(normalized);
    } catch (error) {
      return createErrorResponse(
        error,
        error instanceof AgentHandlerError ? error.code : IPC_ERROR_CODES.UNKNOWN_ERROR
      );
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_GROUNDING_STATUS, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const ensureReady = payload?.ensureReady === true;

    logger.info('agent:grounding-status', projectId, chapterId, ensureReady);

    try {
      const normalizedProjectId = requireProjectId(projectId);
      const normalizedChapterId = chapterId;
      if (!normalizedChapterId) {
        throw new AgentHandlerError('Chapter ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(normalizedProjectId);
      if (!project) {
        throw new AgentHandlerError('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const groundingStatus = await getAgentGroundingStatus(normalizedProjectId, normalizedChapterId, {
        ensureReady,
      });

      logger.info(
        'agent:grounding-status:result',
        normalizedChapterId,
        groundingStatus.status,
        `${groundingStatus.readyVideoAssetCount}/${groundingStatus.requiredVideoAssetCount}`
      );

      return createSuccessResponse(groundingStatus);
    } catch (error) {
      return createErrorResponse(
        error,
        error instanceof AgentHandlerError ? error.code : IPC_ERROR_CODES.UNKNOWN_ERROR
      );
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_REROLL_MESSAGE, async (_, payload) => {
    const clientRequestId =
      typeof payload?.clientRequestId === 'string' ? payload.clientRequestId.trim() : '';
    const projectId = toNumberOrNull(payload?.projectId);
    const conversationId = toNumberOrNull(payload?.conversationId);
    const messageId = toNumberOrNull(payload?.messageId);
    const provider = typeof payload?.provider === 'string' ? payload.provider : undefined;
    const selectedClipIds = Array.isArray(payload?.selectedClipIds)
      ? payload.selectedClipIds.filter(
        (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
      )
      : [];
    const playheadTime = toNumberOrNull(payload?.playheadTime) ?? undefined;
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions as ProxyOptions
        : undefined;
    const agentConfig = payload?.agentConfig && typeof payload.agentConfig === 'object'
      ? payload.agentConfig as ProviderConfigPayload
      : undefined;

    logger.info('agent:reroll-message', projectId, conversationId, messageId, provider);

    try {
      if (!clientRequestId) {
        throw new AgentHandlerError(
          'Client request ID is required',
          IPC_ERROR_CODES.VALIDATION_ERROR
        );
      }

      const normalizedProjectId = requireProjectId(projectId);
      const normalizedConversationId = requireConversationId(conversationId);
      const normalizedMessageId = requireMessageId(messageId);
      const {
        chapter,
        conversation,
        effectiveProvider,
      } = await resolveConversationContext(
        normalizedProjectId,
        normalizedConversationId,
        provider,
        { requireFreshRuntime: true }
      );
      await assertChapterGroundingReady(normalizedProjectId, chapter.id);
      const syncedConversation = await syncConversationProvider(conversation, provider);
      const existingMessages = await getChatMessagesByConversation(syncedConversation.id);
      const targetIndex = existingMessages.findIndex((item) => item.id === normalizedMessageId);
      if (targetIndex < 0) {
        throw new AgentHandlerError('Message not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const targetMessage = existingMessages[targetIndex];
      if (targetMessage.role === 'system') {
        throw new AgentHandlerError(
          'System messages cannot be rerolled',
          IPC_ERROR_CODES.VALIDATION_ERROR
        );
      }

      const retainedUserMessage = targetMessage.role === 'user'
        ? targetMessage
        : [...existingMessages.slice(0, targetIndex)]
          .reverse()
          .find((item) => item.role === 'user');

      if (!retainedUserMessage) {
        throw new AgentHandlerError(
          'Reroll requires a preceding user message',
          IPC_ERROR_CODES.VALIDATION_ERROR
        );
      }

      await deleteChatMessagesAfter(syncedConversation.id, retainedUserMessage.id);
      const threadId = await resolveConversationThreadId(syncedConversation, {
        forceRotate: true,
      });

      const retainedIndex = existingMessages.findIndex(
        (item) => item.id === retainedUserMessage.id
      );
      const normalized = await runConversationTurn(agentBridge, {
        agentConfig,
        chapter,
        clientRequestId,
        conversation: syncedConversation,
        conversationHistory: sanitizeConversationHistory(
          existingMessages.slice(0, retainedIndex + 1)
        ),
        effectiveProvider,
        playheadTime,
        projectId: normalizedProjectId,
        proxyOptions,
        selectedClipIds,
        threadId,
        userMessageId: retainedUserMessage.id,
        userCreatedAt: retainedUserMessage.created_at,
      });

      return createSuccessResponse(normalized);
    } catch (error) {
      return createErrorResponse(
        error,
        error instanceof AgentHandlerError ? error.code : IPC_ERROR_CODES.UNKNOWN_ERROR
      );
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_EDIT_MESSAGE, async (_, payload) => {
    const clientRequestId =
      typeof payload?.clientRequestId === 'string' ? payload.clientRequestId.trim() : '';
    const projectId = toNumberOrNull(payload?.projectId);
    const conversationId = toNumberOrNull(payload?.conversationId);
    const messageId = toNumberOrNull(payload?.messageId);
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    const provider = typeof payload?.provider === 'string' ? payload.provider : undefined;
    const selectedClipIds = Array.isArray(payload?.selectedClipIds)
      ? payload.selectedClipIds.filter(
        (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
      )
      : [];
    const playheadTime = toNumberOrNull(payload?.playheadTime) ?? undefined;
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions as ProxyOptions
        : undefined;
    const threadNamingModel = normalizeNamingModel(payload?.threadNamingModel);
    const agentConfig = payload?.agentConfig && typeof payload.agentConfig === 'object'
      ? payload.agentConfig as ProviderConfigPayload
      : undefined;

    logger.info('agent:edit-message', projectId, conversationId, messageId, provider);

    try {
      if (!clientRequestId) {
        throw new AgentHandlerError(
          'Client request ID is required',
          IPC_ERROR_CODES.VALIDATION_ERROR
        );
      }
      if (!message) {
        throw new AgentHandlerError('Message is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const normalizedProjectId = requireProjectId(projectId);
      const normalizedConversationId = requireConversationId(conversationId);
      const normalizedMessageId = requireMessageId(messageId);
      const {
        chapter,
        conversation,
        effectiveProvider,
      } = await resolveConversationContext(
        normalizedProjectId,
        normalizedConversationId,
        provider,
        { requireFreshRuntime: true }
      );
      await assertChapterGroundingReady(normalizedProjectId, chapter.id);
      const syncedConversation = await syncConversationProvider(conversation, provider);
      const targetMessage = await getChatMessageByConversation(
        syncedConversation.id,
        normalizedMessageId
      );
      if (!targetMessage) {
        throw new AgentHandlerError('Message not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (targetMessage.role !== 'user') {
        throw new AgentHandlerError(
          'Only user messages can be edited',
          IPC_ERROR_CODES.VALIDATION_ERROR
        );
      }

      const existingMessages = await getChatMessagesByConversation(syncedConversation.id);
      const targetIndex = existingMessages.findIndex((item) => item.id === targetMessage.id);
      if (targetIndex < 0) {
        throw new AgentHandlerError('Message not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const firstUserMessage = existingMessages.find((item) => item.role === 'user');
      const shouldRetitleConversation =
        firstUserMessage?.id === targetMessage.id &&
        (
          syncedConversation.title === DEFAULT_CONVERSATION_TITLE ||
          syncedConversation.title === deriveConversationTitle(targetMessage.content)
        );

      if (shouldRetitleConversation) {
        await updateChatConversation(syncedConversation.id, {
          title: await generateConversationTitle(
            message,
            chapter.title,
            threadNamingModel,
            agentConfig
          ),
        });
      }

      const updated = await updateUserChatMessageContent(
        syncedConversation.id,
        targetMessage.id,
        message
      );
      if (!updated) {
        throw new AgentHandlerError(
          'Failed to update user message',
          IPC_ERROR_CODES.DATABASE_ERROR
        );
      }

      await deleteChatMessagesAfter(syncedConversation.id, targetMessage.id);
      const threadId = await resolveConversationThreadId(syncedConversation, {
        forceRotate: true,
      });

      const updatedMessages = existingMessages
        .slice(0, targetIndex + 1)
        .map((item) => item.id === targetMessage.id ? { ...item, content: message } : item);
      const normalized = await runConversationTurn(agentBridge, {
        agentConfig,
        chapter,
        clientRequestId,
        conversation: syncedConversation,
        conversationHistory: sanitizeConversationHistory(updatedMessages),
        effectiveProvider,
        playheadTime,
        projectId: normalizedProjectId,
        proxyOptions,
        selectedClipIds,
        threadId,
        userMessageId: targetMessage.id,
        userCreatedAt: targetMessage.created_at,
      });

      return createSuccessResponse(normalized);
    } catch (error) {
      return createErrorResponse(
        error,
        error instanceof AgentHandlerError ? error.code : IPC_ERROR_CODES.UNKNOWN_ERROR
      );
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_BRANCH_MESSAGE, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const conversationId = toNumberOrNull(payload?.conversationId);
    const messageId = toNumberOrNull(payload?.messageId);

    logger.info('agent:branch-message', projectId, conversationId, messageId);

    try {
      const normalizedProjectId = requireProjectId(projectId);
      const normalizedConversationId = requireConversationId(conversationId);
      const normalizedMessageId = requireMessageId(messageId);
      const { chapter, conversation } = await resolveConversationContext(
        normalizedProjectId,
        normalizedConversationId
      );
      const targetMessage = await getChatMessageByConversation(
        conversation.id,
        normalizedMessageId
      );
      if (!targetMessage) {
        throw new AgentHandlerError('Message not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const branchedConversation = await createChatConversation({
        project_id: normalizedProjectId,
        chapter_id: chapter.id,
        title: `${conversation.title} (Branch)`,
        provider: conversation.provider,
        thread_id: randomUUID(),
      });
      const clonedCount = await cloneChatMessagesThrough(
        conversation.id,
        branchedConversation.id,
        targetMessage.id
      );
      if (clonedCount === 0) {
        throw new AgentHandlerError(
          'Failed to branch conversation history',
          IPC_ERROR_CODES.DATABASE_ERROR
        );
      }

      return createSuccessResponse(branchedConversation);
    } catch (error) {
      return createErrorResponse(
        error,
        error instanceof AgentHandlerError ? error.code : IPC_ERROR_CODES.UNKNOWN_ERROR
      );
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_APPLY_ACTIONS, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const actionsRaw = Array.isArray(payload?.actions) ? payload.actions : [];

    logger.info('agent:apply-actions', projectId, chapterId, actionsRaw.length);

    try {
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      let chapter = null as Awaited<ReturnType<typeof getChapter>> | null;
      let chapterAssetIds: number[] = [];
      let chapterDuration: number | null = null;

      if (chapterId !== null) {
        chapter = await getChapter(chapterId);
        if (!chapter) {
          return createErrorResponse('Chapter not found', IPC_ERROR_CODES.NOT_FOUND);
        }
        if (chapter.project_id !== projectId) {
          return createErrorResponse('Chapter does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
        }

        chapterAssetIds = await getAssetsForChapter(chapter.id);
        chapterDuration = Math.max(0, chapter.end_time - chapter.start_time);
      }

      const projectAssets = await getAssetsByProject(projectId);
      const projectAssetIdSet = new Set(projectAssets.map((asset) => asset.id));
      const chapterAssetIdSet = new Set(chapterAssetIds);

      const results: Array<{
        index: number;
        action: TimelineAction;
        success: boolean;
        clip?: Clip;
        error?: string;
      }> = [];

      const toGlobalTime = (localSeconds: number): number => {
        if (!chapter) return localSeconds;
        return chapter.start_time + localSeconds;
      };

      const ensureChapterLocalTime = (value: number, fieldName: string) => {
        if (!chapter || chapterDuration === null) return;
        if (value < 0 || value > chapterDuration) {
          throw new Error(`${fieldName} (${value}) must be within chapter range 0-${chapterDuration.toFixed(2)}s`);
        }
      };

      for (let index = 0; index < actionsRaw.length; index += 1) {
        const rawAction = actionsRaw[index];
        const [action] = normalizeTimelineActions([rawAction]);

        if (!action) {
          results.push({
            index,
            action: {
              type: 'create_clip',
              inPoint: 0,
              outPoint: 0.01,
              reasoning: 'Invalid action payload',
            },
            success: false,
            error: 'Invalid timeline action payload',
          });
          continue;
        }

        try {
          if (action.type === 'create_clip') {
            const chapterLocalInPoint = action.inPoint;
            const chapterLocalOutPoint = action.outPoint;
            const chapterLocalStartTime = action.startTime ?? chapterLocalInPoint;

            ensureChapterLocalTime(chapterLocalStartTime, 'startTime');
            ensureChapterLocalTime(chapterLocalInPoint, 'inPoint');
            ensureChapterLocalTime(chapterLocalOutPoint, 'outPoint');

            const startTime = toGlobalTime(chapterLocalStartTime);
            const inPoint = toGlobalTime(chapterLocalInPoint);
            const outPoint = toGlobalTime(chapterLocalOutPoint);

            if (outPoint <= inPoint) {
              throw new Error('Out point must be greater than in point');
            }
            if (startTime < 0 || inPoint < 0) {
              throw new Error('Times must be non-negative');
            }

            let assetId = action.assetId;
            if (!assetId) {
              const fallbackAssets = chapter ? chapterAssetIds : projectAssets.map((asset) => asset.id);
              if (fallbackAssets.length === 1) {
                assetId = fallbackAssets[0];
              }
            }

            if (!assetId) {
              throw new Error('assetId is required when multiple assets are available');
            }
            if (!projectAssetIdSet.has(assetId)) {
              throw new Error(`Asset ${assetId} does not belong to project ${projectId}`);
            }
            if (chapter && !chapterAssetIdSet.has(assetId)) {
              throw new Error(`Asset ${assetId} is not linked to chapter ${chapter.id}`);
            }

            const clip = await createClip({
              project_id: projectId,
              asset_id: assetId,
              track_index: action.trackIndex ?? 0,
              start_time: startTime,
              in_point: inPoint,
              out_point: outPoint,
              role: action.role ?? null,
              description: action.description ?? null,
              is_essential: action.isEssential ?? false,
            });

            results.push({ index, action, success: true, clip });
            continue;
          }

          const existingClip = await getClip(action.clipId);
          if (!existingClip) {
            throw new Error(`Clip not found: ${action.clipId}`);
          }
          if (existingClip.project_id !== projectId) {
            throw new Error(`Clip ${action.clipId} does not belong to project ${projectId}`);
          }
          if (chapter && !chapterAssetIdSet.has(existingClip.asset_id)) {
            throw new Error(`Clip ${action.clipId} is not linked to chapter ${chapter.id}`);
          }

          const updates: Partial<Clip> = {};
          if (action.updates.startTime !== undefined) {
            ensureChapterLocalTime(action.updates.startTime, 'startTime');
            updates.start_time = toGlobalTime(action.updates.startTime);
          }
          if (action.updates.inPoint !== undefined) {
            ensureChapterLocalTime(action.updates.inPoint, 'inPoint');
            updates.in_point = toGlobalTime(action.updates.inPoint);
          }
          if (action.updates.outPoint !== undefined) {
            ensureChapterLocalTime(action.updates.outPoint, 'outPoint');
            updates.out_point = toGlobalTime(action.updates.outPoint);
          }
          if (action.updates.role !== undefined) {
            updates.role = action.updates.role;
          }
          if (action.updates.description !== undefined) {
            updates.description = action.updates.description;
          }
          if (action.updates.isEssential !== undefined) {
            updates.is_essential = action.updates.isEssential;
          }

          const effectiveIn = updates.in_point ?? existingClip.in_point;
          const effectiveOut = updates.out_point ?? existingClip.out_point;
          if (effectiveOut <= effectiveIn) {
            throw new Error('Out point must be greater than in point');
          }
          if ((updates.start_time ?? existingClip.start_time) < 0 || effectiveIn < 0) {
            throw new Error('Times must be non-negative');
          }

          const updated = await updateClip(action.clipId, updates);
          if (!updated) {
            throw new Error(`Failed to update clip ${action.clipId}`);
          }

          const refreshed = await getClip(action.clipId);
          results.push({ index, action, success: true, clip: refreshed ?? undefined });
        } catch (error) {
          results.push({
            index,
            action,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return createSuccessResponse({ results });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
