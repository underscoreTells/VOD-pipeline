import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import {
  createChatConversation,
  createChatMessage,
  createClip,
  deleteChatConversation,
  getAssetsByProject,
  getAssetsForChapter,
  getChapter,
  getChatConversation,
  getChatConversationsByChapter,
  getChatMessagesByConversation,
  getClip,
  getProject,
  updateChatConversation,
  updateClip,
} from '../../database/index.js';
import type {
  Clip,
  ExecutionTraceEntry,
} from '../../../shared/types/database.js';
import type {
  AgentChatData,
  AgentStreamEvent,
  TimelineAction,
} from '../../../shared/types/agent-ipc.js';
import { getAgentBridge } from '../../agent-bridge.js';
import { createLogger } from '../../logger.js';
import {
  appendExecutionTraceEntry,
  serializeExecutionTrace,
} from '../../../shared/utils/execution-trace.js';
import { sanitizeAssistantContent } from '../../../shared/utils/assistant-content.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import {
  appendHiddenReasoningChunk,
  applyNearLimitTokenGuard,
  buildAgentChatContext,
  deriveConversationTitle,
  generateDetailedTranscriptsForRequests,
  hasVideoIntent,
  hydratedConversationIds,
  normalizeConversationProvider,
  normalizeTimelineActions,
  parseAgentGraphResult,
  persistAgentSuggestions,
  scheduleChapterMediaPrewarm,
  serializeHiddenReasoning,
  toNumberOrNull,
} from '../handler-support.js';

const logger = createLogger('AgentHandlers');

export const AGENT_HANDLER_CHANNELS = [
  IPC_CHANNELS.AGENT_CONVERSATION_CREATE,
  IPC_CHANNELS.AGENT_CONVERSATION_LIST,
  IPC_CHANNELS.AGENT_CONVERSATION_MESSAGES,
  IPC_CHANNELS.AGENT_CONVERSATION_DELETE,
  IPC_CHANNELS.AGENT_CHAT,
  IPC_CHANNELS.AGENT_APPLY_ACTIONS,
];

export function registerAgentHandlers(): void {
  const agentBridge = getAgentBridge();
  agentBridge.on('exit', () => {
    hydratedConversationIds.clear();
  });
  agentBridge.on('error', () => {
    hydratedConversationIds.clear();
  });

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
        title: titleRaw || 'New conversation',
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

      hydratedConversationIds.delete(conversationId);
      return createSuccessResponse(null);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (event, payload) => {
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
    const agentConfig = payload?.agentConfig && typeof payload.agentConfig === 'object'
      ? payload.agentConfig
      : undefined;

    logger.info('agent:chat', projectId, conversationId, provider);

    try {
      if (!clientRequestId) {
        return createErrorResponse('Client request ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!projectId) {
        return createErrorResponse('Project ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!conversationId) {
        return createErrorResponse('Conversation ID is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      if (!message) {
        return createErrorResponse('Message is required', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const project = await getProject(projectId);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }

      const conversation = await getChatConversation(conversationId);
      if (!conversation) {
        return createErrorResponse('Conversation not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (conversation.project_id !== projectId) {
        return createErrorResponse('Conversation does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const chapter = await getChapter(conversation.chapter_id);
      if (!chapter) {
        return createErrorResponse('Conversation chapter not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      if (chapter.project_id !== projectId) {
        return createErrorResponse('Conversation chapter does not belong to project', IPC_ERROR_CODES.VALIDATION_ERROR);
      }

      const effectiveProvider = provider ?? conversation.provider ?? undefined;
      if (provider && provider !== conversation.provider) {
        await updateChatConversation(conversation.id, {
          provider: normalizeConversationProvider(provider),
        });
      }

      await createChatMessage({
        conversation_id: conversation.id,
        role: 'user',
        content: message,
        thinking_markdown: null,
        trace_json: null,
      });

      const existingMessages = await getChatMessagesByConversation(conversation.id);
      if (conversation.title === 'New conversation' && existingMessages.length === 1) {
        await updateChatConversation(conversation.id, {
          title: deriveConversationTitle(message),
        });
      }

      const threadId = conversation.thread_id?.trim() || randomUUID();
      if (!conversation.thread_id || conversation.thread_id !== threadId) {
        await updateChatConversation(conversation.id, { thread_id: threadId });
      }

      const chapterAssetIds = await getAssetsForChapter(chapter.id);
      const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
      const wantsVideoContext = hasVideoIntent(message);
      const initialContext = await buildAgentChatContext(projectId, chapter.id, {
        ensureChapterProxyReady: false,
      });

      if (wantsVideoContext && chapterAssetIds.length > 0) {
        const primaryAssetId = chapterAssetIds[0];
        void scheduleChapterMediaPrewarm(chapter.id, primaryAssetId).catch((error) => {
          console.warn(
            `[ChapterPrewarm] Failed scheduling from chat chapter=${chapter.id} asset=${primaryAssetId}:`,
            error
          );
        });
      }

      const latestUserTurn = [{ role: 'user', content: message }];
      const conversationHistory = conversation.thread_id?.trim()
        ? latestUserTurn
        : existingMessages.map((item) => ({
            role: item.role,
            content: item.role === 'assistant'
              ? sanitizeAssistantContent(item.content)
              : item.content,
          }));
      const guardedInitialPayload = applyNearLimitTokenGuard(
        conversationHistory,
        initialContext,
        effectiveProvider
      );

      if (guardedInitialPayload.compressed) {
        logger.info(
          'agent:token-guard',
          conversation.id,
          effectiveProvider || 'default',
          `${guardedInitialPayload.estimatedTotalTokens}/${guardedInitialPayload.effectiveContextLimit}`
        );
      }

      await agentBridge.ensureStarted();
      let executionTrace: ExecutionTraceEntry[] = [];
      let hiddenReasoningChunks: import('../handler-support.js').HiddenReasoningChunk[] = [];

      const sendChatPass = async (
        messagesPayload: Array<{ role: string; content: string }>,
        contextPayload: Awaited<ReturnType<typeof buildAgentChatContext>> | undefined,
        passIndex: number
      ): Promise<Record<string, unknown>> => {
        const response = await agentBridge.send({
          type: 'chat',
          threadId,
          messages: messagesPayload,
          metadata: {
            projectId: String(projectId),
            provider: effectiveProvider,
            chapterId: String(chapter.id),
            selectedClipIds,
            playheadTime,
            agentConfig,
            context: contextPayload,
          },
        }, {
          streamContext: {
            clientRequestId,
            projectId: String(projectId),
            chapterId: String(chapter.id),
            conversationId: conversation.id,
            passIndex,
          },
          onStreamEvent: (streamMessage) => {
            if (streamMessage.type === 'token' && streamMessage.visibility === 'hidden') {
              hiddenReasoningChunks = appendHiddenReasoningChunk(hiddenReasoningChunks, streamMessage, passIndex);
              return;
            }

            if (streamMessage.type !== 'progress') {
              return;
            }

            executionTrace = appendExecutionTraceEntry(executionTrace, {
              status: streamMessage.status,
              message: streamMessage.message,
              nodeName: streamMessage.nodeName,
              passIndex,
            });
          },
        });

        if (response.type === 'error') {
          throw new Error(response.error);
        }
        if (response.type !== 'graph-complete') {
          throw new Error('Unexpected agent response type');
        }

        return response.result && typeof response.result === 'object'
          ? (response.result as Record<string, unknown>)
          : {};
      };

      const firstPassResult = await sendChatPass(guardedInitialPayload.messages, initialContext, 1);
      let finalPassResult = firstPassResult;

      const firstParsed = parseAgentGraphResult(firstPassResult, chapterDuration, chapterAssetIds);
      if (firstParsed.transcriptDetailRequests.length > 0) {
        const detailedTranscriptEvent: AgentStreamEvent = {
          type: 'progress',
          clientRequestId,
          projectId: String(projectId),
          chapterId: String(chapter.id),
          conversationId: conversation.id,
          passIndex: 2,
          status: 'loading_detailed_transcript_context',
          progress: 0,
          message: 'Fetching detailed transcript for a better answer...',
          resetDraft: true,
        };
        event.sender.send(IPC_CHANNELS.AGENT_STREAM, detailedTranscriptEvent);
        executionTrace = appendExecutionTraceEntry(executionTrace, detailedTranscriptEvent);

        const detailedTranscripts = await generateDetailedTranscriptsForRequests(
          chapter,
          chapterAssetIds,
          firstParsed.transcriptDetailRequests
        );

        if (detailedTranscripts.length > 0) {
          const detailedContext = await buildAgentChatContext(projectId, chapter.id, {
            detailedTranscripts,
          });
          const guardedDetailedPayload = applyNearLimitTokenGuard([], detailedContext, effectiveProvider);

          if (guardedDetailedPayload.compressed) {
            logger.info(
              'agent:token-guard-detailed',
              conversation.id,
              effectiveProvider || 'default',
              `${guardedDetailedPayload.estimatedTotalTokens}/${guardedDetailedPayload.effectiveContextLimit}`
            );
          }

          finalPassResult = await sendChatPass(guardedDetailedPayload.messages, detailedContext, 2);
        }
      }

      const finalParsed = parseAgentGraphResult(finalPassResult, chapterDuration, chapterAssetIds);
      const assistantMessage = finalParsed.message || 'Analysis complete';
      const thinkingMarkdown = finalParsed.thinkingMarkdown ?? serializeHiddenReasoning(hiddenReasoningChunks);
      const persistedAssistantMessage = await createChatMessage({
        conversation_id: conversation.id,
        role: 'assistant',
        content: assistantMessage,
        thinking_markdown: thinkingMarkdown,
        trace_json: serializeExecutionTrace(executionTrace),
      });
      const persistedSuggestions = await persistAgentSuggestions(
        chapter.id,
        conversation.id,
        persistedAssistantMessage.id,
        effectiveProvider,
        finalParsed.suggestionDrafts
      );

      hydratedConversationIds.add(conversation.id);

      const normalized: AgentChatData = {
        message: assistantMessage,
        thinkingMarkdown: thinkingMarkdown ?? undefined,
        threadId,
        suggestions: persistedSuggestions,
        timelineActions: undefined,
      };

      return createSuccessResponse(normalized);
    } catch (error) {
      console.error('[IPC] agent:chat error:', error);
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
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
