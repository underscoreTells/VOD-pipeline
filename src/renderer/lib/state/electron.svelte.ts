import type { Asset, Clip, TimelineState } from '../../../shared/types/database';

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

export async function createProject(name: string): Promise<CreateProjectResult> {
  return await window.electronAPI.projects.create(name);
}

export async function getProjects(): Promise<GetProjectsResult> {
  return await window.electronAPI.projects.getAll();
}

export async function getProject(id: number): Promise<GetProjectResult> {
  return await window.electronAPI.projects.get(id);
}

// ============================================================================
// Asset Types & Functions
// ============================================================================

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

export async function getAssetsByProject(projectId: number): Promise<GetAssetsResult> {
  return await window.electronAPI.assets.getByProject(projectId);
}

export async function addAsset(projectId: number, filePath: string): Promise<AddAssetResult> {
  return await window.electronAPI.assets.add(projectId, filePath);
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

export async function getWaveform(assetId: number, trackIndex: number, tierLevel: number): Promise<WaveformResult> {
  return await window.electronAPI.waveforms.get(assetId, trackIndex, tierLevel);
}

export async function generateWaveform(assetId: number, trackIndex: number): Promise<WaveformGenerationResult> {
  return await window.electronAPI.waveforms.generate(assetId, trackIndex);
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
// Extend window.electronAPI type
// ============================================================================

declare global {
  interface Window {
    electronAPI: {
      projects: {
        create: (name: string) => Promise<CreateProjectResult>;
        getAll: () => Promise<GetProjectsResult>;
        get: (id: number) => Promise<GetProjectResult>;
      };
      agent: {
        chat: (params: { projectId: string; message: string; provider?: string; chapterId?: string; threadId?: string }) => Promise<any>;
        getSuggestions: (chapterId: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        applySuggestion: (suggestionId: number) => Promise<{ success: boolean; data?: { applied: boolean; clip?: { id: number } }; error?: string }>;
        rejectSuggestion: (suggestionId: number) => Promise<{ success: boolean; error?: string }>;
      };
      settings: {
        encrypt: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        decrypt: (encrypted: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      };
      assets: {
        getByProject: (projectId: number) => Promise<GetAssetsResult>;
        add: (projectId: number, filePath: string) => Promise<AddAssetResult>;
      };
      clips: {
        getByProject: (projectId: number) => Promise<GetClipsResult>;
        create: (input: CreateClipInput) => Promise<CreateClipResult>;
        update: (id: number, updates: Partial<Clip>) => Promise<UpdateClipResult>;
        delete: (id: number) => Promise<DeleteClipResult>;
      };
      timeline: {
        loadState: (projectId: number) => Promise<TimelineStateResult>;
        saveState: (state: any) => Promise<SaveTimelineStateResult>;
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
    };
  }
}

export {};
