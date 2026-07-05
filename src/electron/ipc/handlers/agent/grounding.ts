import { ipcMain } from 'electron';
import type { ProxyOptions } from '../../../../shared/contracts/electron-api.js';
import { getProject } from '../../../database/index.js';
import { getAgentGroundingStatus, toNumberOrNull } from '../../handler-support.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';
import { AgentHandlerError, logger, requireProjectId } from './shared.js';

export function registerAgentGroundingHandler(): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_GROUNDING_STATUS, async (_, payload) => {
    const projectId = toNumberOrNull(payload?.projectId);
    const chapterId = toNumberOrNull(payload?.chapterId);
    const ensureReady = payload?.ensureReady === true;
    const proxyOptions =
      payload?.proxyOptions && typeof payload.proxyOptions === 'object'
        ? payload.proxyOptions as ProxyOptions
        : undefined;

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
        proxyOptions,
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
}
