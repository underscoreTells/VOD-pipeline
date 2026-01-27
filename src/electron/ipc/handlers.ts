import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels';

export function registerIpcHandlers() {
  console.log('Registering IPC handlers...');

  ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE, async (_, { name }) => {
    console.log('IPC: project:create', name);
    return { success: false, error: 'Database not initialized yet' };
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_ALL, async () => {
    console.log('IPC: project:get-all');
    return { success: false, data: [], error: 'Database not initialized yet' };
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET, async (_, { id }) => {
    console.log('IPC: project:get', id);
    return { success: false, error: 'Database not initialized yet' };
  });

  ipcMain.handle(IPC_CHANNELS.ASSET_ADD, async (_, { projectId, filePath }) => {
    console.log('IPC: asset:add', projectId, filePath);
    return { success: false, error: 'Database not initialized yet' };
  });

  ipcMain.handle(IPC_CHANNELS.CHAPTER_CREATE, async (_, { projectId, title, start, end }) => {
    console.log('IPC: chapter:create', projectId, title, start, end);
    return { success: false, error: 'Database not initialized yet' };
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_, { projectId, message }) => {
    console.log('IPC: agent:chat', projectId, message);
    return { success: false, error: 'Agent worker not initialized yet' };
  });
}
