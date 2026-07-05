import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import {
  cloneChatMessagesThrough,
  createChatConversation,
  getChatMessageByConversation,
} from '../../../database/index.js';
import { toNumberOrNull } from '../../handler-support.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';
import {
  AgentHandlerError,
  logger,
  requireConversationId,
  requireMessageId,
  requireProjectId,
  resolveConversationContext,
} from './shared.js';

export function registerAgentBranchHandler(): void {
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
}
