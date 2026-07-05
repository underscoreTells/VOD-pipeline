import { ipcMain } from 'electron';
import type { getAgentBridge } from '../../../agent-bridge.js';
import {
  deleteChatMessagesAfter,
  getChatMessagesByConversation,
} from '../../../database/index.js';
import { toNumberOrNull } from '../../handler-support.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';
import {
  AgentHandlerError,
  assertChapterGroundingReady,
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

export function registerAgentRerollHandler(agentBridge: ReturnType<typeof getAgentBridge>): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_REROLL_MESSAGE, async (_, payload) => {
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
}
