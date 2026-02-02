const { contextBridge, ipcRenderer, webUtils } = require('electron');

const electronAPI = {
  projects: {
    create: (name) => ipcRenderer.invoke('project:create', { name }),
    getAll: () => ipcRenderer.invoke('project:get-all'),
    get: (id) => ipcRenderer.invoke('project:get', { id }),
  },
  agent: {
    chat: (params) => ipcRenderer.invoke('agent:chat', params),
    getSuggestions: (chapterId) => ipcRenderer.invoke('suggestion:get-by-chapter', { chapterId }),
    applySuggestion: (suggestionId) => ipcRenderer.invoke('suggestion:apply', { id: suggestionId }),
    rejectSuggestion: (suggestionId) => ipcRenderer.invoke('suggestion:reject', { id: suggestionId }),
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
    getByProject: (projectId) => ipcRenderer.invoke('asset:get-by-project', { projectId }),
    add: (projectId, filePath, proxyOptions) => ipcRenderer.invoke('asset:add', { projectId, filePath, proxyOptions }),
  },
  chapters: {
    create: (input) => ipcRenderer.invoke('chapter:create', {
      projectId: input.projectId,
      title: input.title,
      startTime: input.startTime,
      endTime: input.endTime,
    }),
    getByProject: (projectId) => ipcRenderer.invoke('chapter:get-by-project', { projectId }),
    update: (id, updates) => ipcRenderer.invoke('chapter:update', { id, updates }),
    delete: (id) => ipcRenderer.invoke('chapter:delete', { id }),
    addAsset: (chapterId, assetId) => ipcRenderer.invoke('chapter:add-asset', { chapterId, assetId }),
    getAssets: (chapterId) => ipcRenderer.invoke('chapter:get-assets', { chapterId }),
  },
  clips: {
    getByProject: (projectId) => ipcRenderer.invoke('clip:get-by-project', { projectId }),
    create: (input) => ipcRenderer.invoke('clip:create', {
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
  },
  timeline: {
    loadState: (projectId) => ipcRenderer.invoke('timeline:state-load', { projectId }),
    saveState: (state) => ipcRenderer.invoke('timeline:state-save', state),
  },
  waveforms: {
    get: (assetId, trackIndex, tierLevel) =>
      ipcRenderer.invoke('waveform:get', { assetId, trackIndex, tierLevel }),
    generate: (assetId, trackIndex) =>
      ipcRenderer.invoke('waveform:generate', { assetId, trackIndex }),
    onProgress: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('waveform:progress', handler);
      return () => ipcRenderer.removeListener('waveform:progress', handler);
    },
  },
  proxy: {
    onProgress: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('proxy:progress', handler);
      return () => ipcRenderer.removeListener('proxy:progress', handler);
    },
    onComplete: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('proxy:complete', handler);
      return () => ipcRenderer.removeListener('proxy:complete', handler);
    },
    onError: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('proxy:error', handler);
      return () => ipcRenderer.removeListener('proxy:error', handler);
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
