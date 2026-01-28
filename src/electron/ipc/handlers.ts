import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels';
import { createProject, getProject, listProjects, deleteProject, updateProject } from '../database/db';
import { getAgentBridge } from '../agent-bridge.js';

export function registerIpcHandlers() {
  console.log('Registering IPC handlers...');

  ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE, async (_, { name }) => {
    console.log('IPC: project:create', name);
    try {
      const project = createProject(name);
      return { success: true, data: project };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_ALL, async () => {
    console.log('IPC: project:get-all');
    try {
      const projects = listProjects();
      return { success: true, data: projects };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET, async (_, { id }) => {
    console.log('IPC: project:get', id);
    try {
      const project = getProject(id);
      if (project) {
        return { success: true, data: project };
      } else {
        return { success: false, error: 'Project not found' };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_UPDATE, async (_, { id, name }) => {
    console.log('IPC: project:update', id, name);
    try {
      const success = updateProject(id, name);
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: 'Project not found' };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_DELETE, async (_, { id }) => {
    console.log('IPC: project:delete', id);
    try {
      const success = deleteProject(id);
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: 'Project not found' };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_ADD, async (_, { projectId, filePath }) => {
    console.log('IPC: asset:add', projectId, filePath);
    return { success: false, error: 'Asset management not implemented yet' };
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_CREATE, async (_, { projectId, title, start, end }) => {
    console.log('IPC: chapter:create', projectId, title, start, end);
    return { success: false, error: 'Chapter management not implemented yet' };
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_, { projectId, message }) => {
    console.log('IPC: agent:chat', projectId, message);
    try {
      const agentBridge = getAgentBridge();

      const response = await agentBridge.send({
        type: 'chat',
        projectId,
        messages: [{ role: 'user', content: message }],
      });

      return { success: true, data: response };
    } catch (error) {
      console.error('[IPC] agent:chat error:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
