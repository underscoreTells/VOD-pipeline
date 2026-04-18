import { contextBridge, ipcRenderer, webUtils, dialog } from 'electron';
import type { Asset, Clip, TimelineState, Suggestion, Chapter, ChatConversation, ChatConversationMessage } from '../shared/types/database';
import type { AgentChatData, AgentStreamEvent, TimelineAction } from '../shared/types/agent-ipc';
import type { ProjectAsset } from '../shared/contracts/ipc.js';

// ============================================================================
// Type Definitions
// ============================================================================

type ProxyEncodingMode = 'cpu' | 'gpu' | 'auto';
type ProxyQuality = 'high' | 'balanced' | 'fast';

interface ProxyOptions {
  encodingMode?: ProxyEncodingMode;
  quality?: ProxyQuality;
}

interface WaveformGenerateOptions {
  includeSourceTracks?: boolean;
  playbackActive?: boolean;
}

type ProxyProgressCallback = (data: { assetId: number; progress: number }) => void;
type ProxyCompleteCallback = (data: { assetId: number; proxyPath: string }) => void;
type ProxyErrorCallback = (data: { assetId: number; error: string }) => void;
type WaveformProgressCallback = (data: {
  assetId: number;
  trackIndex?: number;
  progress: { tier: number; percent: number; status: string; trackIndex?: number };
}) => void;
type TranscriptionProgressCallback = (data: { chapterId: number; progress: { percent: number; status: string } }) => void;
type AgentStreamCallback = (data: AgentStreamEvent) => void;
type AgentErrorCallback = (data: { error: string }) => void;

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

export interface DeleteProjectResult {
  success: boolean;
  error?: string;
}

export interface AgentChatResult {
  success: boolean;
  data?: AgentChatData;
  error?: string;
}

export interface AgentConversationListResult {
  success: boolean;
  data?: ChatConversation[];
  error?: string;
}

export interface AgentConversationCreateResult {
  success: boolean;
  data?: ChatConversation;
  error?: string;
}

export interface AgentConversationMessagesResult {
  success: boolean;
  data?: ChatConversationMessage[];
  error?: string;
}

export interface AgentApplyActionsResult {
  success: boolean;
  data?: {
    results: Array<{
      index: number;
      action: TimelineAction;
      success: boolean;
      clip?: Clip;
      error?: string;
    }>;
  };
  error?: string;
}

export interface GetAssetsResult {
  success: boolean;
  data?: ProjectAsset[];
  error?: string;
}

export interface GetAssetResult {
  success: boolean;
  data?: ProjectAsset;
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
  id?: number;
  createdAt?: string;
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

export interface BatchUpdateClipsResult {
  success: boolean;
  data?: {
    updatedCount: number;
  };
  error?: string;
}

export interface SuggestClipNameResult {
  success: boolean;
  data?: {
    name: string | null;
  };
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

export interface GetChapterReverseProxyResult {
  success: boolean;
  data?: {
    status: 'missing' | 'generating' | 'ready' | 'error';
    url?: string;
    quality?: 'quick' | 'full';
    isFinal?: boolean;
    error?: string;
  };
  error?: string;
}

export interface TranscriptionResult {
  success: boolean;
  data?: {
    chapterId: number;
    language: string;
    duration: number;
    segmentCount: number;
    skipped?: boolean;
  };
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
    delete: (id: number) => Promise<DeleteProjectResult>;
  };
  agent: {
    chat: (params: {
      clientRequestId: string;
      projectId: string;
      conversationId: number;
      message: string;
      provider?: string;
      selectedClipIds?: number[];
      playheadTime?: number;
      agentConfig?: {
        defaultProvider?: string;
        providers?: Record<string, string>;
      };
    }) => Promise<AgentChatResult>;
    createConversation: (params: {
      projectId: string;
      chapterId: string;
      provider?: string;
      title?: string;
    }) => Promise<AgentConversationCreateResult>;
    listConversations: (params: {
      projectId: string;
      chapterId: string;
    }) => Promise<AgentConversationListResult>;
    getConversationMessages: (conversationId: number) => Promise<AgentConversationMessagesResult>;
    deleteConversation: (conversationId: number) => Promise<{ success: boolean; error?: string }>;
    applyActions: (params: { projectId: string; chapterId?: string; actions: TimelineAction[] }) => Promise<AgentApplyActionsResult>;
    onStream: (callback: AgentStreamCallback) => () => void;
    onError: (callback: AgentErrorCallback) => () => void;
    getSuggestions: (params: { chapterId: string; conversationId: number }) => Promise<{ success: boolean; data?: Suggestion[]; error?: string }>;
    previewSuggestion: (suggestionId: number) => Promise<{ success: boolean; data?: { previewed: boolean; clip?: Clip }; error?: string }>;
    cancelSuggestionPreview: (suggestionId: number) => Promise<{ success: boolean; data?: { cancelled: boolean; removedClipId?: number; clip?: Clip }; error?: string }>;
    applySuggestion: (suggestionId: number) => Promise<{ success: boolean; data?: { applied: boolean; clip?: Clip }; error?: string }>;
    rejectSuggestion: (suggestionId: number) => Promise<{ success: boolean; data?: { rejected: boolean; removedClipId?: number; clip?: Clip }; error?: string }>;
    applyAllSuggestions: (params: { chapterId: string; conversationId: number }) => Promise<{
      success: boolean;
      data?: {
        appliedCount: number;
        total: number;
        clips: Clip[];
        results: Array<{ suggestionId: number; success: boolean; clip?: Clip; error?: string }>;
      };
      error?: string;
    }>;
  };
  settings: {
    encrypt: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    decrypt: (encrypted: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  };
  assets: {
    get: (id: number) => Promise<GetAssetResult>;
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
    getReverseProxy: (
      chapterId: number,
      assetId: number,
      options?: { ensureReady?: boolean }
    ) => Promise<GetChapterReverseProxyResult>;
  };
  clips: {
    getByProject: (projectId: number) => Promise<GetClipsResult>;
    create: (input: CreateClipInput) => Promise<CreateClipResult>;
    update: (id: number, updates: Partial<Clip>) => Promise<UpdateClipResult>;
    delete: (id: number) => Promise<DeleteClipResult>;
    batchUpdate: (updates: Array<{ id: number } & Partial<Clip>>) => Promise<BatchUpdateClipsResult>;
    suggestName: (input: {
      chapterId: number;
      inPoint: number;
      outPoint: number;
      model: string;
      apiKey: string;
      chapterTitle?: string;
    }) => Promise<SuggestClipNameResult>;
  };
  timeline: {
    loadState: (projectId: number) => Promise<TimelineStateResult>;
    saveState: (state: TimelineState) => Promise<SaveTimelineStateResult>;
  };
  waveforms: {
    get: (assetId: number, trackIndex: number, tierLevel: number) => Promise<WaveformResult>;
    generate: (assetId: number, trackIndex: number, options?: WaveformGenerateOptions) => Promise<WaveformGenerationResult>;
    onProgress: (callback: WaveformProgressCallback) => () => void;
  };
  transcription: {
    getStatus: (options?: { autoSetup?: boolean }) => Promise<{
      success: boolean;
      data?: {
        available: boolean;
        pythonPath?: string;
        pythonSource?: 'managed' | 'bundled' | 'system';
        pythonVersion?: string;
        hasPip: boolean;
        hasFasterWhisper: boolean;
        managedEnvPath?: string;
        error?: string;
      };
      error?: string;
    }>;
    transcribe: (chapterId: number, options?: Record<string, unknown>) => Promise<TranscriptionResult>;
    onProgress: (callback: TranscriptionProgressCallback) => () => void;
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
    delete: (id) => ipcRenderer.invoke('project:delete', { id }),
  },
  agent: {
    chat: (params) =>
      ipcRenderer.invoke('agent:chat', params),
    createConversation: (params) =>
      ipcRenderer.invoke('agent:conversation-create', params),
    listConversations: (params) =>
      ipcRenderer.invoke('agent:conversation-list', params),
    getConversationMessages: (conversationId) =>
      ipcRenderer.invoke('agent:conversation-messages', { conversationId }),
    deleteConversation: (conversationId) =>
      ipcRenderer.invoke('agent:conversation-delete', { conversationId }),
    applyActions: (params) =>
      ipcRenderer.invoke('agent:apply-actions', params),
    onStream: (callback) => {
      const handler = (_: any, data: AgentStreamEvent) => callback(data);
      ipcRenderer.on('agent:stream', handler);
      return () => ipcRenderer.removeListener('agent:stream', handler);
    },
    onError: (callback) => {
      const handler = (_: any, data: { error: string }) => callback(data);
      ipcRenderer.on('agent:error', handler);
      return () => ipcRenderer.removeListener('agent:error', handler);
    },
    getSuggestions: (params) =>
      ipcRenderer.invoke('suggestion:get-by-chapter', params),
    previewSuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:preview', { id: suggestionId }),
    cancelSuggestionPreview: (suggestionId) =>
      ipcRenderer.invoke('suggestion:cancel-preview', { id: suggestionId }),
    applySuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:apply', { id: suggestionId }),
    rejectSuggestion: (suggestionId) =>
      ipcRenderer.invoke('suggestion:reject', { id: suggestionId }),
    applyAllSuggestions: (params) =>
      ipcRenderer.invoke('suggestion:apply-all', params),
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
    get: (id: number) => ipcRenderer.invoke('asset:get', { id }),
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
    getReverseProxy: (chapterId, assetId, options) =>
      ipcRenderer.invoke('chapter:reverse-proxy-get', {
        chapterId,
        assetId,
        ensureReady: options?.ensureReady === true,
      }),
  },
  clips: {
    getByProject: (projectId) => ipcRenderer.invoke('clip:get-by-project', { projectId }),
    create: (input) => ipcRenderer.invoke('clip:create', {
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
      const handler = (
        _: any,
        data: {
          assetId: number;
          trackIndex?: number;
          progress: { tier: number; percent: number; status: string; trackIndex?: number };
        }
      ) => callback(data);
      ipcRenderer.on('waveform:progress', handler);
      return () => ipcRenderer.removeListener('waveform:progress', handler);
    },
  },
  transcription: {
    getStatus: (options) => ipcRenderer.invoke('transcription:status', { autoSetup: options?.autoSetup === true }),
    transcribe: (chapterId, options) =>
      ipcRenderer.invoke('transcribe:chapter', { chapterId, options }),
    onProgress: (callback) => {
      const handler = (_: any, data: { chapterId: number; progress: { percent: number; status: string } }) => callback(data);
      ipcRenderer.on('transcribe:progress', handler);
      return () => ipcRenderer.removeListener('transcribe:progress', handler);
    },
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
