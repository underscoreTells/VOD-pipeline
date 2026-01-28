import { contextBridge, ipcRenderer } from 'electron';

export interface CreateProjectResult {
  success: boolean;
  data?: { id: number; name: string; created_at: string; updated_at: string };
  error?: string;
}

export interface GetProjectsResult {
  success: boolean;
  data?: Array<{ id: number; name: string; created_at: string; updated_at: string }>;
  error?: string;
}

export interface GetProjectResult {
  success: boolean;
  data?: { id: number; name: string; created_at: string; updated_at: string };
  error?: string;
}

export interface AgentChatResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface Message {
  role: string;
  content: string;
}

export interface ElectronAPI {
  projects: {
    create: (name: string) => Promise<CreateProjectResult>;
    getAll: () => Promise<GetProjectsResult>;
    get: (id: number) => Promise<GetProjectResult>;
  };
  agent: {
    chat: (projectId: string, message: string, threadId?: string) => Promise<AgentChatResult>;
  };
}

const electronAPI: ElectronAPI = {
  projects: {
    create: (name) => ipcRenderer.invoke('project:create', { name }),
    getAll: () => ipcRenderer.invoke('project:get-all'),
    get: (id) => ipcRenderer.invoke('project:get', { id }),
  },
  agent: {
    chat: (projectId, message, threadId) =>
      ipcRenderer.invoke('agent:chat', { projectId, message, threadId }),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
