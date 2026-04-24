import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ElectronAPI,
  ProxyOptions,
  TranscriptionProgressEvent,
  WaveformProgressEvent,
} from '../shared/contracts/electron-api.js';
import type { AgentStreamEvent } from '../shared/types/agent-ipc.js';

const electronAPI: ElectronAPI = {
  projects: {
    create: (name) => ipcRenderer.invoke('project:create', { name }),
    getAll: () => ipcRenderer.invoke('project:get-all'),
    get: (id) => ipcRenderer.invoke('project:get', { id }),
    delete: (id) => ipcRenderer.invoke('project:delete', { id }),
  },
  agent: {
    chat: (params) => ipcRenderer.invoke('agent:chat', params),
    getGroundingStatus: (params) => ipcRenderer.invoke('agent:grounding-status', params),
    rerollMessage: (params) => ipcRenderer.invoke('agent:reroll-message', params),
    editMessage: (params) => ipcRenderer.invoke('agent:edit-message', params),
    branchMessage: (params) => ipcRenderer.invoke('agent:branch-message', params),
    createConversation: (params) => ipcRenderer.invoke('agent:conversation-create', params),
    listConversations: (params) => ipcRenderer.invoke('agent:conversation-list', params),
    getConversationMessages: (conversationId) =>
      ipcRenderer.invoke('agent:conversation-messages', { conversationId }),
    deleteConversation: (conversationId) =>
      ipcRenderer.invoke('agent:conversation-delete', { conversationId }),
    applyActions: (params) => ipcRenderer.invoke('agent:apply-actions', params),
    onStream: (callback) => {
      const handler = (_event: unknown, data: AgentStreamEvent) => callback(data);
      ipcRenderer.on('agent:stream', handler);
      return () => ipcRenderer.removeListener('agent:stream', handler);
    },
    onError: (callback) => {
      const handler = (_event: unknown, data: { error: string }) => callback(data);
      ipcRenderer.on('agent:error', handler);
      return () => ipcRenderer.removeListener('agent:error', handler);
    },
    getSuggestions: (params) => ipcRenderer.invoke('suggestion:get-by-chapter', params),
    previewSuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:preview', { id: suggestionId }),
    cancelSuggestionPreview: (suggestionId) =>
      ipcRenderer.invoke('suggestion:cancel-preview', { id: suggestionId }),
    applySuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:apply', { id: suggestionId }),
    rejectSuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:reject', { id: suggestionId }),
    applyAllSuggestions: (params) => ipcRenderer.invoke('suggestion:apply-all', params),
  },
  settings: {
    encrypt: async (text) => {
      try {
        return await ipcRenderer.invoke('settings:encrypt', { text });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Preload] settings.encrypt error:', error);
        return { success: false, error: message };
      }
    },
    decrypt: async (encrypted) => {
      try {
        return await ipcRenderer.invoke('settings:decrypt', { encrypted });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Preload] settings.decrypt error:', error);
        return { success: false, error: message };
      }
    },
  },
  assets: {
    get: (id) => ipcRenderer.invoke('asset:get', { id }),
    getByProject: (projectId) => ipcRenderer.invoke('asset:get-by-project', { projectId }),
    add: (projectId, filePath, proxyOptions?: ProxyOptions) =>
      ipcRenderer.invoke('asset:add', { projectId, filePath, proxyOptions }),
  },
  chapters: {
    create: (input) =>
      ipcRenderer.invoke('chapter:create', {
        projectId: input.projectId,
        title: input.title,
        startTime: input.startTime,
        endTime: input.endTime,
      }),
    getByProject: (projectId) => ipcRenderer.invoke('chapter:get-by-project', { projectId }),
    update: (id, updates) => ipcRenderer.invoke('chapter:update', { id, updates }),
    delete: (id) => ipcRenderer.invoke('chapter:delete', { id }),
    addAsset: (chapterId, assetId, options) =>
      ipcRenderer.invoke('chapter:add-asset', { chapterId, assetId, ...options }),
    getAssets: (chapterId) => ipcRenderer.invoke('chapter:get-assets', { chapterId }),
    getReverseProxy: (chapterId, assetId, options) =>
      ipcRenderer.invoke('chapter:reverse-proxy-get', {
        chapterId,
        assetId,
        ensureReady: options?.ensureReady === true,
        proxyOptions: options?.proxyOptions,
        requestMode: options?.requestMode,
      }),
  },
  clips: {
    getByProject: (projectId) => ipcRenderer.invoke('clip:get-by-project', { projectId }),
    create: (input) =>
      ipcRenderer.invoke('clip:create', {
        id: input.id,
        createdAt: input.createdAt,
        projectId: input.projectId,
        assetId: input.assetId,
        trackIndex: input.trackIndex,
        startTime: input.startTime,
        inPoint: input.inPoint,
        outPoint: input.outPoint,
        role: input.role,
        description: input.description,
        isEssential: input.isEssential,
      }),
    update: (id, updates) => ipcRenderer.invoke('clip:update', { id, updates }),
    delete: (id) => ipcRenderer.invoke('clip:delete', { id }),
    batchUpdate: (updates) => ipcRenderer.invoke('clip:batch-update', { updates }),
    suggestName: (input) => ipcRenderer.invoke('clip:suggest-name', input),
  },
  timeline: {
    loadState: (projectId) => ipcRenderer.invoke('timeline:state-load', { projectId }),
    saveState: (state) => ipcRenderer.invoke('timeline:state-save', state),
  },
  waveforms: {
    get: (assetId, trackIndex, tierLevel) =>
      ipcRenderer.invoke('waveform:get', { assetId, trackIndex, tierLevel }),
    generate: (assetId, trackIndex, options) =>
      ipcRenderer.invoke('waveform:generate', { assetId, trackIndex, ...(options ?? {}) }),
    onProgress: (callback) => {
      const handler = (_event: unknown, data: WaveformProgressEvent) => callback(data);
      ipcRenderer.on('waveform:progress', handler);
      return () => ipcRenderer.removeListener('waveform:progress', handler);
    },
  },
  transcription: {
    getStatus: (options) =>
      ipcRenderer.invoke('transcription:status', { autoSetup: options?.autoSetup === true }),
    transcribe: (chapterId, options) =>
      ipcRenderer.invoke('transcribe:chapter', { chapterId, options }),
    onProgress: (callback) => {
      const handler = (_event: unknown, data: TranscriptionProgressEvent) => callback(data);
      ipcRenderer.on('transcribe:progress', handler);
      return () => ipcRenderer.removeListener('transcribe:progress', handler);
    },
  },
  exports: {
    generate: (projectId, format, filePath) =>
      ipcRenderer.invoke('export:generate', { projectId, format, filePath }),
  },
  dialog: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
  },
  webUtils: {
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
