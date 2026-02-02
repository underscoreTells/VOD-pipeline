import { contextBridge, ipcRenderer, webUtils, dialog } from 'electron';
import type { Asset, Clip, TimelineState, Suggestion, Chapter } from '../shared/types/database';
import type { AgentOutputMessage } from '../shared/types/agent-ipc';

// ============================================================================
// Type Definitions
// ============================================================================

type ProxyEncodingMode = 'cpu' | 'gpu' | 'auto';
type ProxyQuality = 'high' | 'balanced' | 'fast';

interface ProxyOptions {
  encodingMode?: ProxyEncodingMode;
  quality?: ProxyQuality;
}

type ProxyProgressCallback = (data: { assetId: number; progress: number }) => void;
type ProxyCompleteCallback = (data: { assetId: number; proxyPath: string }) => void;
type ProxyErrorCallback = (data: { assetId: number; error: string }) => void;

// ============================================================================
// Result Types
// ============================================================================

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
  data?: AgentOutputMessage;
  error?: string;
}

export interface GetAssetsResult {
  success: boolean;
  data?: Asset[];
  error?: string;
}

export interface AddAssetResult {
  success: boolean;
  data?: Asset;
  error?: string;
}

export interface GetClipsResult {
  success: boolean;
  data?: Clip[];
  error?: string;
}

export interface CreateClipInput {
  projectId: number;
  assetId: number;
  trackIndex: number;
  startTime: number;
  inPoint: number;
  outPoint: number;
  role?: string;
  description?: string;
  isEssential?: boolean;
}

export interface CreateClipResult {
  success: boolean;
  data?: Clip;
  error?: string;
}

export interface UpdateClipResult {
  success: boolean;
  error?: string;
}

export interface DeleteClipResult {
  success: boolean;
  error?: string;
}

export interface TimelineStateResult {
  success: boolean;
  data?: TimelineState | null;
  error?: string;
}

export interface SaveTimelineStateResult {
  success: boolean;
  error?: string;
}

export interface WaveformResult {
  success: boolean;
  data?: {
    peaks: Array<{ min: number; max: number }>;
    sampleRate: number;
    duration: number;
    generatedAt: string;
  };
  error?: string;
}

export interface WaveformGenerationResult {
  success: boolean;
  data?: {
    assetId: number;
    trackIndex: number;
    tiers: Array<{
      level: 1 | 2 | 3;
      peaks: Array<{ min: number; max: number }>;
      sampleRate: number;
      duration: number;
    }>;
  };
  error?: string;
}

export interface ExportResult {
  success: boolean;
  data?: {
    filePath: string;
    format: string;
    clipCount: number;
  };
  error?: string;
}

export interface CreateChapterInput {
  projectId: number;
  title: string;
  startTime: number;
  endTime: number;
}

export interface CreateChapterResult {
  success: boolean;
  data?: Chapter;
  error?: string;
}

export interface GetChaptersResult {
  success: boolean;
  data?: Chapter[];
  error?: string;
}

export interface UpdateChapterInput {
  title?: string;
  startTime?: number;
  endTime?: number;
}

export interface UpdateChapterResult {
  success: boolean;
  error?: string;
}

export interface DeleteChapterResult {
  success: boolean;
  error?: string;
}

export interface AddAssetToChapterResult {
  success: boolean;
  error?: string;
}

export interface GetChapterAssetsResult {
  success: boolean;
  data?: number[];
  error?: string;
}

// ============================================================================
// Electron API Interface
// ============================================================================

export interface ElectronAPI {
  projects: {
    create: (name: string) => Promise<CreateProjectResult>;
    getAll: () => Promise<GetProjectsResult>;
    get: (id: number) => Promise<GetProjectResult>;
  };
  agent: {
    chat: (params: { projectId: string; message: string; provider?: string; chapterId?: string; threadId?: string }) => Promise<AgentChatResult>;
    getSuggestions: (chapterId: string) => Promise<{ success: boolean; data?: Suggestion[]; error?: string }>;
    applySuggestion: (suggestionId: number) => Promise<{ success: boolean; data?: { applied: boolean; clip?: Clip }; error?: string }>;
    rejectSuggestion: (suggestionId: number) => Promise<{ success: boolean; error?: string }>;
  };
  settings: {
    encrypt: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    decrypt: (encrypted: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  };
  assets: {
    getByProject: (projectId: number) => Promise<GetAssetsResult>;
    add: (projectId: number, filePath: string, proxyOptions?: ProxyOptions) => Promise<AddAssetResult>;
  };
  proxy: {
    onProgress: (callback: ProxyProgressCallback) => () => void;
    onComplete: (callback: ProxyCompleteCallback) => () => void;
    onError: (callback: ProxyErrorCallback) => () => void;
  };
  chapters: {
    create: (input: CreateChapterInput) => Promise<CreateChapterResult>;
    getByProject: (projectId: number) => Promise<GetChaptersResult>;
    update: (id: number, updates: UpdateChapterInput) => Promise<UpdateChapterResult>;
    delete: (id: number) => Promise<DeleteChapterResult>;
    addAsset: (chapterId: number, assetId: number) => Promise<AddAssetToChapterResult>;
    getAssets: (chapterId: number) => Promise<GetChapterAssetsResult>;
  };
  clips: {
    getByProject: (projectId: number) => Promise<GetClipsResult>;
    create: (input: CreateClipInput) => Promise<CreateClipResult>;
    update: (id: number, updates: Partial<Clip>) => Promise<UpdateClipResult>;
    delete: (id: number) => Promise<DeleteClipResult>;
  };
  timeline: {
    loadState: (projectId: number) => Promise<TimelineStateResult>;
    saveState: (state: TimelineState) => Promise<SaveTimelineStateResult>;
  };
  waveforms: {
    get: (assetId: number, trackIndex: number, tierLevel: number) => Promise<WaveformResult>;
    generate: (assetId: number, trackIndex: number) => Promise<WaveformGenerationResult>;
  };
  exports: {
    generate: (projectId: number, format: string, filePath: string) => Promise<ExportResult>;
  };
  dialog: {
    showSaveDialog: (options: any) => Promise<{ canceled: boolean; filePath?: string }>;
  };
  webUtils: {
    getPathForFile: (file: File) => string;
  };
}

// ============================================================================
// API Implementation
// ============================================================================

const electronAPI: ElectronAPI = {
  projects: {
    create: (name) => ipcRenderer.invoke('project:create', { name }),
    getAll: () => ipcRenderer.invoke('project:get-all'),
    get: (id) => ipcRenderer.invoke('project:get', { id }),
  },
  agent: {
    chat: (params) =>
      ipcRenderer.invoke('agent:chat', params),
    getSuggestions: (chapterId) =>
      ipcRenderer.invoke('suggestion:get-by-chapter', { chapterId }),
    applySuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:apply', { id: suggestionId }),
    rejectSuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:reject', { id: suggestionId }),
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
    getByProject: (projectId: number) => ipcRenderer.invoke('asset:get-by-project', { projectId }),
    add: (projectId: number, filePath: string, proxyOptions?: ProxyOptions) => ipcRenderer.invoke('asset:add', { projectId, filePath, proxyOptions }),
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
  },
  proxy: {
    onProgress: (callback) => {
      const handler = (_: any, data: { assetId: number; progress: number }) => callback(data);
      ipcRenderer.on('proxy:progress', handler);
      return () => ipcRenderer.removeListener('proxy:progress', handler);
    },
    onComplete: (callback) => {
      const handler = (_: any, data: { assetId: number; proxyPath: string }) => callback(data);
      ipcRenderer.on('proxy:complete', handler);
      return () => ipcRenderer.removeListener('proxy:complete', handler);
    },
    onError: (callback) => {
      const handler = (_: any, data: { assetId: number; error: string }) => callback(data);
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

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declarations for TypeScript
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
