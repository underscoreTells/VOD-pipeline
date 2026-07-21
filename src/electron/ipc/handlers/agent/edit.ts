import { ipcMain } from 'electron';
import type { getAgentBridge } from '../../../agent-bridge.js';
import {
  deleteChatMessagesAfter,
  getChatMessageByConversation,
  getChatMessagesByConversation,
  updateChatConversation,
  updateUserChatMessageContent,
} from '../../../database/index.js';
import { normalizeNamingModel } from '../../../../shared/llm/naming-models.js';
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
} from '../../../../shared/utils/conversation-title.js';
import { toNumberOrNull } from '../../handler-support.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';
import {
  AgentHandlerError,
  generateConversationTitle,
  logger,
  parseConversationTurnPayload,
  requireConversationId,
  requireMessageId,
  requireProjectId,
  resolveConversationContext,
  resolveConversationThreadId,
  runConversationTurn,
  sanitizeConversationHistory,
  syncConversationProvider,
} from './shared.js';

export function registerAgentEditHandler(agentBridge: ReturnType<typeof getAgentBridge>): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_EDIT_MESSAGE, async (_, payload) => {
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
    const messageId = toNumberOrNull(payload?.messageId);
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    const threadNamingModel = normalizeNamingModel(payload?.threadNamingModel);

    logger.info('agent:edit-message', projectId, conversationId, messageId, provider);
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
            agentConfig,
            signal
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
