import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import {
  createChatConversation,
  deleteChatConversation,
  getChapter,
  getChatConversation,
  getChatConversationsByChapter,
  getChatMessagesByConversation,
  getProject,
  updateChatConversation,
} from '../../../database/index.js';
import { DEFAULT_CONVERSATION_TITLE } from '../../../../shared/utils/conversation-title.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';
import { normalizeConversationProvider, toNumberOrNull } from '../../handler-support.js';
import { logger } from './shared.js';
import { normalizeProvider, normalizeReasoningEffort } from '../../../../shared/llm/provider-registry.js';

export function registerAgentConversationHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_CREATE, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const provider = typeof payload?.provider === 'string' ? payload.provider : null;
    const model = typeof payload?.model === 'string' ? payload.model.trim() : '';
    const reasoningEffort = normalizeReasoningEffort(payload?.reasoningEffort);
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
        model: model || null,
        reasoning_effort: reasoningEffort,
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

  ipcMain.handle(IPC_CHANNELS.AGENT_CONVERSATION_UPDATE, async (_, payload) => {
    const conversationId = toNumberOrNull(payload?.conversationId);
    const provider = normalizeProvider(payload?.provider);
    const model = typeof payload?.model === 'string' ? payload.model.trim() : '';
    const reasoningEffort = payload?.reasoningEffort === null
      ? null
      : normalizeReasoningEffort(payload?.reasoningEffort);
    try {
      if (!conversationId || !provider || !model) {
        return createErrorResponse('Conversation, provider, and model are required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const conversation = await getChatConversation(conversationId);
      if (!conversation) return createErrorResponse('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
      await updateChatConversation(conversationId, {
        provider,
        model,
        reasoning_effort: reasoningEffort,
      });
      return createSuccessResponse({ ...conversation, provider, model, reasoning_effort: reasoningEffort });
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });
}
