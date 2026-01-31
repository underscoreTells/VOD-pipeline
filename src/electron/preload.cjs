const { contextBridge, ipcRenderer, webUtils } = require('electron');

const electronAPI = {
  projects: {
    create: (name) => ipcRenderer.invoke('project:create', { name }),
    getAll: () => ipcRenderer.invoke('project:get-all'),
    get: (id) => ipcRenderer.invoke('project:get', { id }),
  },
  agent: {
    chat: (projectId, message, threadId) => ipcRenderer.invoke('agent:chat', { projectId, message, threadId }),
  },
  assets: {
    getByProject: (projectId) => ipcRenderer.invoke('asset:get-by-project', { projectId }),
    add: (projectId, filePath) => ipcRenderer.invoke('asset:add', { projectId, filePath }),
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
    get: (assetId, trackIndex, tierLevel) => ipcRenderer.invoke('waveform:get', { assetId, trackIndex, tierLevel }),
    generate: (assetId, trackIndex) => ipcRenderer.invoke('waveform:generate', { assetId, trackIndex }),
  },
  exports: {
    generate: (projectId, format, filePath) => ipcRenderer.invoke('export:generate', { projectId, format, filePath }),
  },
  dialog: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
  },
  webUtils: {
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
