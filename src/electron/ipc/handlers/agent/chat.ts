import { ipcMain } from 'electron';
import type { getAgentBridge } from '../../../agent-bridge.js';
import {
  createChatMessage,
  getChatMessagesByConversation,
  updateChatConversation,
} from '../../../database/index.js';
import { normalizeNamingModel } from '../../../../shared/llm/naming-models.js';
import { DEFAULT_CONVERSATION_TITLE } from '../../../../shared/utils/conversation-title.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';
import {
  AgentHandlerError,
  generateConversationTitle,
  logger,
  parseConversationTurnPayload,
  requireConversationId,
  requireProjectId,
  resolveConversationContext,
  resolveConversationThreadId,
  runConversationTurn,
  sanitizeConversationHistory,
  syncConversationProvider,
} from './shared.js';

export function registerAgentChatHandler(agentBridge: ReturnType<typeof getAgentBridge>): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_, payload) => {
    const {
      clientRequestId,
      projectId,
      conversationId,
      provider,
      selectedClipIds,
      playheadTime,
      proxyOptions,
      agentConfig,
    } = parseConversationTurnPayload(payload);
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    const threadNamingModel = normalizeNamingModel(payload?.threadNamingModel);

    logger.info('agent:chat', projectId, conversationId, provider);
    const signal = clientRequestId ? agentBridge.registerClientRequest(clientRequestId) : undefined;

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
            agentConfig,
            signal
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
        signal,
      });

      return createSuccessResponse(normalized);
    } catch (error) {
      return createErrorResponse(
        error,
        error instanceof AgentHandlerError ? error.code : IPC_ERROR_CODES.UNKNOWN_ERROR
      );
    } finally {
      if (clientRequestId) agentBridge.finishClientRequest(clientRequestId);
    }
  });
}
