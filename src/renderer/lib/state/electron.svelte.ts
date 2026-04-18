import type { Asset, ChatConversation, ChatConversationMessage, Clip, Suggestion, TimelineState } from '../../../shared/types/database';
import type { AgentChatData, AgentStreamEvent, TimelineAction } from '../../../shared/types/agent-ipc';
import type { ProjectAsset } from '../../../shared/contracts/ipc.js';

// ============================================================================
// Preload Verification
// ============================================================================

// Check if electronAPI is available (set by preload script)
if (typeof window === 'undefined' || !window.electronAPI) {
  console.error('[Renderer] window.electronAPI is not defined!');
  console.error('[Renderer] This usually means the preload script failed to load.');
  console.error('[Renderer] Check the main process console for preload-error messages.');
}

// ============================================================================
// Project Types & Functions
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

export async function createProject(name: string): Promise<CreateProjectResult> {
  return await window.electronAPI.projects.create(name);
}

export async function getProjects(): Promise<GetProjectsResult> {
  return await window.electronAPI.projects.getAll();
}

export async function getProject(id: number): Promise<GetProjectResult> {
  return await window.electronAPI.projects.get(id);
}

export async function deleteProject(id: number): Promise<DeleteProjectResult> {
  return await window.electronAPI.projects.delete(id);
}

// ============================================================================
// Agent Types & Functions
// ============================================================================

export interface AgentChatParams {
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

export async function agentChat(params: AgentChatParams): Promise<AgentChatResult> {
  return await window.electronAPI.agent.chat(params);
}

export async function createAgentConversation(params: {
  projectId: string;
  chapterId: string;
  provider?: string;
  title?: string;
}): Promise<AgentConversationCreateResult> {
  return await window.electronAPI.agent.createConversation(params);
}

export async function listAgentConversations(params: {
  projectId: string;
  chapterId: string;
}): Promise<AgentConversationListResult> {
  return await window.electronAPI.agent.listConversations(params);
}

export async function getAgentConversationMessages(conversationId: number): Promise<AgentConversationMessagesResult> {
  return await window.electronAPI.agent.getConversationMessages(conversationId);
}

export async function deleteAgentConversation(conversationId: number): Promise<{ success: boolean; error?: string }> {
  return await window.electronAPI.agent.deleteConversation(conversationId);
}

export async function applyAgentActions(params: {
  projectId: string;
  chapterId?: string;
  actions: TimelineAction[];
}): Promise<AgentApplyActionsResult> {
  return await window.electronAPI.agent.applyActions(params);
}

const agentStreamSubscribers = new Set<(message: AgentStreamEvent) => void>();
let agentStreamUnsubscribe: (() => void) | null = null;

export function onAgentStream(callback: (message: AgentStreamEvent) => void): () => void {
  agentStreamSubscribers.add(callback);

  if (!agentStreamUnsubscribe) {
    agentStreamUnsubscribe = window.electronAPI.agent.onStream((message: AgentStreamEvent) => {
      for (const subscriber of agentStreamSubscribers) {
        subscriber(message);
      }
    });
  }

  return () => {
    agentStreamSubscribers.delete(callback);
    if (agentStreamSubscribers.size === 0 && agentStreamUnsubscribe) {
      agentStreamUnsubscribe();
      agentStreamUnsubscribe = null;
    }
  };
}

const agentErrorSubscribers = new Set<(payload: { error: string }) => void>();
let agentErrorUnsubscribe: (() => void) | null = null;

export function onAgentError(callback: (payload: { error: string }) => void): () => void {
  agentErrorSubscribers.add(callback);

  if (!agentErrorUnsubscribe) {
    agentErrorUnsubscribe = window.electronAPI.agent.onError((payload: { error: string }) => {
      for (const subscriber of agentErrorSubscribers) {
        subscriber(payload);
      }
    });
  }

  return () => {
    agentErrorSubscribers.delete(callback);
    if (agentErrorSubscribers.size === 0 && agentErrorUnsubscribe) {
      agentErrorUnsubscribe();
      agentErrorUnsubscribe = null;
    }
  };
}

// ============================================================================
// Asset Types & Functions
// ============================================================================

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

export async function getAssetsByProject(projectId: number): Promise<GetAssetsResult> {
  return await window.electronAPI.assets.getByProject(projectId);
}

export async function getAsset(id: number): Promise<GetAssetResult> {
  return await window.electronAPI.assets.get(id);
}

export async function addAsset(
  projectId: number, 
  filePath: string, 
  proxyOptions?: { encodingMode?: 'cpu' | 'gpu' | 'auto'; quality?: 'high' | 'balanced' | 'fast' }
): Promise<AddAssetResult> {
  return await window.electronAPI.assets.add(projectId, filePath, proxyOptions);
}

// ============================================================================
// Clip Types & Functions
// ============================================================================

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
  role?: Clip['role'];
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

export interface ChapterReverseProxyResult {
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

export async function getClipsByProject(projectId: number): Promise<GetClipsResult> {
  return await window.electronAPI.clips.getByProject(projectId);
}

export async function createClip(input: CreateClipInput): Promise<CreateClipResult> {
  return await window.electronAPI.clips.create(input);
}

export async function updateClip(id: number, updates: Partial<Clip>): Promise<UpdateClipResult> {
  return await window.electronAPI.clips.update(id, updates);
}

export async function deleteClip(id: number): Promise<DeleteClipResult> {
  return await window.electronAPI.clips.delete(id);
}

export async function batchUpdateClips(updates: Array<{ id: number } & Partial<Clip>>): Promise<BatchUpdateClipsResult> {
  return await window.electronAPI.clips.batchUpdate(updates);
}

export async function suggestClipName(input: {
  chapterId: number;
  inPoint: number;
  outPoint: number;
  model: string;
  apiKey: string;
  chapterTitle?: string;
}): Promise<SuggestClipNameResult> {
  const suggestName = (window.electronAPI.clips as {
    suggestName?: (payload: typeof input) => Promise<SuggestClipNameResult>;
  }).suggestName;

  if (typeof suggestName !== 'function') {
    return {
      success: false,
      error: 'Clip naming API is unavailable. Restart the app to refresh preload bindings.',
    };
  }

  return await suggestName(input);
}

export async function getChapterReverseProxy(
  chapterId: number,
  assetId: number,
  options?: { ensureReady?: boolean }
): Promise<ChapterReverseProxyResult> {
  const getReverseProxy = (window.electronAPI.chapters as {
    getReverseProxy?: (
      chapterId: number,
      assetId: number,
      options?: { ensureReady?: boolean }
    ) => Promise<ChapterReverseProxyResult>;
  }).getReverseProxy;

  if (typeof getReverseProxy !== 'function') {
    return {
      success: false,
      error: 'Chapter reverse proxy API is unavailable. Restart the app to refresh preload bindings.',
    };
  }

  return await getReverseProxy(chapterId, assetId, options);
}

// ============================================================================
// Timeline State Types & Functions
// ============================================================================

export interface TimelineStateResult {
  success: boolean;
  data?: TimelineState | null;
  error?: string;
}

export interface SaveTimelineStateResult {
  success: boolean;
  error?: string;
}

export async function loadTimelineState(projectId: number): Promise<TimelineStateResult> {
  return await window.electronAPI.timeline.loadState(projectId);
}

export async function saveTimelineState(state: Omit<TimelineState, 'selected_clip_ids'> & { selected_clip_ids: number[] }): Promise<SaveTimelineStateResult> {
  return await window.electronAPI.timeline.saveState(state);
}

// ============================================================================
// Waveform Types & Functions
// ============================================================================

export interface WaveformData {
  peaks: Array<{ min: number; max: number }>;
  sampleRate: number;
  duration: number;
  generatedAt: string;
}

export interface WaveformResult {
  success: boolean;
  data?: WaveformData;
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

export interface WaveformProgressEvent {
  assetId: number;
  trackIndex?: number;
  progress: { tier: number; percent: number; status: string; trackIndex?: number };
}

export interface WaveformGenerateOptions {
  includeSourceTracks?: boolean;
  playbackActive?: boolean;
}

export async function getWaveform(assetId: number, trackIndex: number, tierLevel: number): Promise<WaveformResult> {
  return await window.electronAPI.waveforms.get(assetId, trackIndex, tierLevel);
}

export async function generateWaveform(
  assetId: number,
  trackIndex: number,
  options?: WaveformGenerateOptions
): Promise<WaveformGenerationResult> {
  return await window.electronAPI.waveforms.generate(assetId, trackIndex, options);
}

const waveformProgressSubscribers = new Set<(data: WaveformProgressEvent) => void>();
let waveformProgressUnsubscribe: (() => void) | null = null;

export function onWaveformProgress(callback: (data: WaveformProgressEvent) => void): () => void {
  waveformProgressSubscribers.add(callback);

  if (!waveformProgressUnsubscribe) {
    waveformProgressUnsubscribe = window.electronAPI.waveforms.onProgress((event) => {
      for (const subscriber of waveformProgressSubscribers) {
        subscriber(event);
      }
    });
  }

  return () => {
    waveformProgressSubscribers.delete(callback);
    if (waveformProgressSubscribers.size === 0 && waveformProgressUnsubscribe) {
      waveformProgressUnsubscribe();
      waveformProgressUnsubscribe = null;
    }
  };
}

// ============================================================================
// Export Types & Functions
// ============================================================================

export interface ExportResult {
  success: boolean;
  data?: {
    filePath: string;
    format: string;
    clipCount: number;
  };
  error?: string;
}

export async function exportProject(projectId: number, format: string, filePath: string): Promise<ExportResult> {
  return await window.electronAPI.exports.generate(projectId, format, filePath);
}

// ============================================================================
// Transcription Types & Functions
// ============================================================================

export interface TranscriptionProgress {
  percent: number;
  status: string;
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

export interface TranscriptionBackendStatus {
  available: boolean;
  pythonPath?: string;
  pythonSource?: 'managed' | 'bundled' | 'system';
  pythonVersion?: string;
  hasPip: boolean;
  hasFasterWhisper: boolean;
  managedEnvPath?: string;
  error?: string;
}

export async function getTranscriptionStatus(autoSetup = false): Promise<{
  success: boolean;
  data?: TranscriptionBackendStatus;
  error?: string;
}> {
  return await (window.electronAPI as any).transcription?.getStatus({ autoSetup }) || {
    success: false,
    error: 'Transcription status not available',
  };
}

export async function transcribeChapter(
  chapterId: number,
  options?: Record<string, unknown>
): Promise<TranscriptionResult> {
  return await (window.electronAPI as any).transcription?.transcribe(chapterId, options) || 
    { success: false, error: 'Transcription not available' };
}

export interface TranscriptionProgressEvent {
  chapterId: number;
  progress: { percent: number; status: string };
}

const transcriptionProgressSubscribers = new Set<(data: TranscriptionProgressEvent) => void>();
let transcriptionProgressUnsubscribe: (() => void) | null = null;

export function onTranscriptionProgress(callback: (data: TranscriptionProgressEvent) => void): () => void {
  transcriptionProgressSubscribers.add(callback);

  if (!transcriptionProgressUnsubscribe) {
    transcriptionProgressUnsubscribe = (window.electronAPI as any).transcription?.onProgress((event: TranscriptionProgressEvent) => {
      for (const subscriber of transcriptionProgressSubscribers) {
        subscriber(event);
      }
    });
  }

  return () => {
    transcriptionProgressSubscribers.delete(callback);
    if (transcriptionProgressSubscribers.size === 0 && transcriptionProgressUnsubscribe) {
      transcriptionProgressUnsubscribe();
      transcriptionProgressUnsubscribe = null;
    }
  };
}

// ============================================================================
// Extend window.electronAPI type
// ============================================================================

declare global {
  interface Window {
    electronAPI: {
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
        onStream: (callback: (message: AgentStreamEvent) => void) => () => void;
        onError: (callback: (payload: { error: string }) => void) => () => void;
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
        add: (projectId: number, filePath: string, proxyOptions?: { encodingMode?: 'cpu' | 'gpu' | 'auto'; quality?: 'high' | 'balanced' | 'fast' }) => Promise<AddAssetResult>;
      };
      chapters: {
        create: (input: { projectId: number; title: string; startTime: number; endTime: number }) => Promise<{ success: boolean; data?: any; error?: string }>;
        getByProject: (projectId: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        update: (id: number, updates: Partial<{ title: string; startTime: number; endTime: number }>) => Promise<{ success: boolean; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        addAsset: (chapterId: number, assetId: number) => Promise<{ success: boolean; error?: string }>;
        getAssets: (chapterId: number) => Promise<{ success: boolean; data?: number[]; error?: string }>;
        getReverseProxy: (
          chapterId: number,
          assetId: number,
          options?: { ensureReady?: boolean }
        ) => Promise<ChapterReverseProxyResult>;
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
        saveState: (state: any) => Promise<SaveTimelineStateResult>;
      };
      waveforms: {
        get: (assetId: number, trackIndex: number, tierLevel: number) => Promise<WaveformResult>;
        generate: (assetId: number, trackIndex: number, options?: WaveformGenerateOptions) => Promise<WaveformGenerationResult>;
        onProgress: (callback: (data: WaveformProgressEvent) => void) => () => void;
      };
      transcription: {
        getStatus: (options?: { autoSetup?: boolean }) => Promise<{ success: boolean; data?: TranscriptionBackendStatus; error?: string }>;
        transcribe: (chapterId: number, options?: Record<string, unknown>) => Promise<TranscriptionResult>;
        onProgress: (callback: (data: TranscriptionProgressEvent) => void) => () => void;
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
    };
  }
}

export {};
