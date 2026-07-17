import { ipcMain } from 'electron';
import { createProject, deleteProject, getProject, listProjects, updateProject } from '../../database/index.js';
import { createLogger } from '../../logger.js';
import type { ProxyOptions } from '../../../shared/contracts/electron-api.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { scheduleProjectProxyPrewarm } from '../handler-support.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import {
  projectCreateSchema,
  projectDeleteSchema,
  projectGetSchema,
  projectUpdateSchema,
} from '../schemas.js';

const logger = createLogger('ProjectHandlers');

export const PROJECT_HANDLER_CHANNELS = [
  IPC_CHANNELS.PROJECT_CREATE,
  IPC_CHANNELS.PROJECT_GET_ALL,
  IPC_CHANNELS.PROJECT_GET,
  IPC_CHANNELS.PROJECT_UPDATE,
  IPC_CHANNELS.PROJECT_DELETE,
  IPC_CHANNELS.PROJECT_PROXY_PREWARM,
];

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE, async (_, payload) => {
    const parsed = projectCreateSchema.safeParse(payload);
    const name = parsed.success ? parsed.data.name : payload?.name;
    logger.info('project:create', name);
    try {
      if (!parsed.success) {
        return createErrorResponse('Invalid project payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      return createSuccessResponse(await createProject(parsed.data.name as string));
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_ALL, async () => {
    logger.info('project:get-all');
    try {
      return createSuccessResponse(await listProjects());
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET, async (_, payload) => {
    const id = payload?.id;
    logger.info('project:get', id);
    try {
      const parsed = projectGetSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid project payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const project = await getProject(parsed.data.id as number);
      return project
        ? createSuccessResponse(project)
        : createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_UPDATE, async (_, payload) => {
    const id = payload?.id;
    logger.info('project:update', id);
    try {
      const parsed = projectUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid project payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const updated = await updateProject(parsed.data.id as number, parsed.data.name as string);
      return updated
        ? createSuccessResponse(null)
        : createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_DELETE, async (_, payload) => {
    const id = payload?.id;
    logger.info('project:delete', id);
    try {
      const parsed = projectDeleteSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid project payload', IPC_ERROR_CODES.DATABASE_ERROR);
      }
      const deleted = await deleteProject(parsed.data.id as number);
      return deleted
        ? createSuccessResponse(null)
        : createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_PROXY_PREWARM, async (_, payload) => {
    const id = payload?.id;
    logger.info('project:proxy-prewarm', id);
    try {
      const parsed = projectGetSchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse('Invalid project payload', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const project = await getProject(parsed.data.id as number);
      if (!project) {
        return createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
      }
      const rawProxyOptions = payload?.proxyOptions;
      if (rawProxyOptions !== undefined && (
        !rawProxyOptions
        || typeof rawProxyOptions !== 'object'
        || !['cpu', 'gpu', 'auto'].includes(rawProxyOptions.encodingMode)
        || !['high', 'balanced', 'fast'].includes(rawProxyOptions.quality)
      )) {
        return createErrorResponse('Invalid proxy options', IPC_ERROR_CODES.VALIDATION_ERROR);
      }
      const proxyOptions = rawProxyOptions as ProxyOptions | undefined;
      return createSuccessResponse(
        await scheduleProjectProxyPrewarm(project.id, proxyOptions)
      );
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
}
