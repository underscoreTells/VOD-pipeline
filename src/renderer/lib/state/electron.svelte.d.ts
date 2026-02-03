import type { Asset, Clip, TimelineState } from '../../../shared/types/database';
export interface CreateProjectResult {
    success: boolean;
    data?: {
        id: number;
        name: string;
        created_at: string;
        updated_at: string;
    };
    error?: string;
}
export interface GetProjectsResult {
    success: boolean;
    data?: Array<{
        id: number;
        name: string;
        created_at: string;
        updated_at: string;
    }>;
    error?: string;
}
export interface GetProjectResult {
    success: boolean;
    data?: {
        id: number;
        name: string;
        created_at: string;
        updated_at: string;
    };
    error?: string;
}
export declare function createProject(name: string): Promise<CreateProjectResult>;
export declare function getProjects(): Promise<GetProjectsResult>;
export declare function getProject(id: number): Promise<GetProjectResult>;
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
export declare function getAssetsByProject(projectId: number): Promise<GetAssetsResult>;
export declare function addAsset(projectId: number, filePath: string, proxyOptions?: {
    encodingMode?: 'cpu' | 'gpu' | 'auto';
    quality?: 'high' | 'balanced' | 'fast';
}): Promise<AddAssetResult>;
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
export declare function getClipsByProject(projectId: number): Promise<GetClipsResult>;
export declare function createClip(input: CreateClipInput): Promise<CreateClipResult>;
export declare function updateClip(id: number, updates: Partial<Clip>): Promise<UpdateClipResult>;
export declare function deleteClip(id: number): Promise<DeleteClipResult>;
export interface TimelineStateResult {
    success: boolean;
    data?: TimelineState | null;
    error?: string;
}
export interface SaveTimelineStateResult {
    success: boolean;
    error?: string;
}
export declare function loadTimelineState(projectId: number): Promise<TimelineStateResult>;
export declare function saveTimelineState(state: Omit<TimelineState, 'selected_clip_ids'> & {
    selected_clip_ids: number[];
}): Promise<SaveTimelineStateResult>;
export interface WaveformData {
    peaks: Array<{
        min: number;
        max: number;
    }>;
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
            peaks: Array<{
                min: number;
                max: number;
            }>;
            sampleRate: number;
            duration: number;
        }>;
    };
    error?: string;
}
export interface WaveformProgressEvent {
    assetId: number;
    progress: {
        tier: number;
        percent: number;
        status: string;
    };
}
export declare function getWaveform(assetId: number, trackIndex: number, tierLevel: number): Promise<WaveformResult>;
export declare function generateWaveform(assetId: number, trackIndex: number): Promise<WaveformGenerationResult>;
export declare function onWaveformProgress(callback: (data: WaveformProgressEvent) => void): () => void;
export interface ExportResult {
    success: boolean;
    data?: {
        filePath: string;
        format: string;
        clipCount: number;
    };
    error?: string;
}
export declare function exportProject(projectId: number, format: string, filePath: string): Promise<ExportResult>;
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
    };
    error?: string;
}
export declare function transcribeChapter(chapterId: number, options?: Record<string, unknown>): Promise<TranscriptionResult>;
declare global {
    interface Window {
        electronAPI: {
            projects: {
                create: (name: string) => Promise<CreateProjectResult>;
                getAll: () => Promise<GetProjectsResult>;
                get: (id: number) => Promise<GetProjectResult>;
            };
            agent: {
                chat: (params: {
                    projectId: string;
                    message: string;
                    provider?: string;
                    chapterId?: string;
                    threadId?: string;
                }) => Promise<any>;
                getSuggestions: (chapterId: string) => Promise<{
                    success: boolean;
                    data?: any[];
                    error?: string;
                }>;
                applySuggestion: (suggestionId: number) => Promise<{
                    success: boolean;
                    data?: {
                        applied: boolean;
                        clip?: {
                            id: number;
                        };
                    };
                    error?: string;
                }>;
                rejectSuggestion: (suggestionId: number) => Promise<{
                    success: boolean;
                    error?: string;
                }>;
            };
            settings: {
                encrypt: (text: string) => Promise<{
                    success: boolean;
                    data?: string;
                    error?: string;
                }>;
                decrypt: (encrypted: string) => Promise<{
                    success: boolean;
                    data?: string;
                    error?: string;
                }>;
            };
            assets: {
                getByProject: (projectId: number) => Promise<GetAssetsResult>;
                add: (projectId: number, filePath: string, proxyOptions?: {
                    encodingMode?: 'cpu' | 'gpu' | 'auto';
                    quality?: 'high' | 'balanced' | 'fast';
                }) => Promise<AddAssetResult>;
            };
            chapters: {
                create: (input: {
                    projectId: number;
                    title: string;
                    startTime: number;
                    endTime: number;
                }) => Promise<{
                    success: boolean;
                    data?: any;
                    error?: string;
                }>;
                getByProject: (projectId: number) => Promise<{
                    success: boolean;
                    data?: any[];
                    error?: string;
                }>;
                update: (id: number, updates: Partial<{
                    title: string;
                    startTime: number;
                    endTime: number;
                }>) => Promise<{
                    success: boolean;
                    error?: string;
                }>;
                delete: (id: number) => Promise<{
                    success: boolean;
                    error?: string;
                }>;
                addAsset: (chapterId: number, assetId: number) => Promise<{
                    success: boolean;
                    error?: string;
                }>;
                getAssets: (chapterId: number) => Promise<{
                    success: boolean;
                    data?: number[];
                    error?: string;
                }>;
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
                onProgress: (callback: (data: WaveformProgressEvent) => void) => () => void;
            };
            exports: {
                generate: (projectId: number, format: string, filePath: string) => Promise<ExportResult>;
            };
            dialog: {
                showSaveDialog: (options: any) => Promise<{
                    canceled: boolean;
                    filePath?: string;
                }>;
            };
            webUtils: {
                getPathForFile: (file: File) => string;
            };
        };
    }
}
export {};
