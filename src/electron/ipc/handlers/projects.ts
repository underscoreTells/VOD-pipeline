import { ipcMain } from 'electron';
import { createProject, deleteProject, getProject, listProjects, updateProject } from '../../database/index.js';
import { createLogger } from '../../logger.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';

const logger = createLogger('ProjectHandlers');

export const PROJECT_HANDLER_CHANNELS = [
  IPC_CHANNELS.PROJECT_CREATE,
  IPC_CHANNELS.PROJECT_GET_ALL,
  IPC_CHANNELS.PROJECT_GET,
  IPC_CHANNELS.PROJECT_UPDATE,
  IPC_CHANNELS.PROJECT_DELETE,
];

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE, async (_, { name }) => {
    logger.info('project:create', name);
    try {
      return createSuccessResponse(await createProject(name));
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

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET, async (_, { id }) => {
    logger.info('project:get', id);
    try {
      const project = await getProject(id);
      return project
        ? createSuccessResponse(project)
        : createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_UPDATE, async (_, { id, name }) => {
    logger.info('project:update', id);
    try {
      const updated = await updateProject(id, name);
      return updated
        ? createSuccessResponse(null)
        : createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_DELETE, async (_, { id }) => {
    logger.info('project:delete', id);
    try {
      const deleted = await deleteProject(id);
      return deleted
        ? createSuccessResponse(null)
        : createErrorResponse('Project not found', IPC_ERROR_CODES.NOT_FOUND);
    } catch (error) {
      return createErrorResponse(error, IPC_ERROR_CODES.DATABASE_ERROR);
    }
  });
}
