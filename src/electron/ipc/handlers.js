import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels';
import { createProject, getProject, listProjects } from '../database/db';
export function registerIpcHandlers() {
    console.log('Registering IPC handlers...');
    ipcMain.handle(IPC_CHANNELS.PROJECT_CREATE, async (_, { name }) => {
        console.log('IPC: project:create', name);
        try {
            const project = createProject(name);
            return { success: true, data: project };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle(IPC_CHANNELS.PROJECT_GET_ALL, async () => {
        console.log('IPC: project:get-all');
        try {
            const projects = listProjects();
            return { success: true, data: projects };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    ipcMain.handle(IPC_CHANNELS.PROJECT_GET, async (_, { id }) => {
        console.log('IPC: project:get', id);
        try {
            const project = getProject(id);
            if (project) {
                return { success: true, data: project };
            }
            else {
                return { success: false, error: 'Project not found' };
            }
        }
        catch (error) {
            return { success: false, error: error.message };
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
        return { success: false, error: 'Agent worker not initialized yet' };
    });
}
