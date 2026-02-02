import type { Asset, Clip, TimelineState, Suggestion, Chapter } from "../shared/types/database";

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

export interface AgentChatResult {
    success: boolean;
    data?: any;
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

export interface GetSuggestionsResult {
    success: boolean;
    data?: Suggestion[];
    error?: string;
}

export interface ApplySuggestionResult {
    success: boolean;
    error?: string;
}

export interface ElectronAPI {
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
            threadId?: string 
        }) => Promise<AgentChatResult>;
        getSuggestions: (chapterId: string) => Promise<GetSuggestionsResult>;
        applySuggestion: (suggestionId: number) => Promise<ApplySuggestionResult>;
        rejectSuggestion: (suggestionId: number) => Promise<ApplySuggestionResult>;
    };
    assets: {
        getByProject: (projectId: number) => Promise<GetAssetsResult>;
        add: (projectId: number, filePath: string, proxyOptions?: { encodingMode?: 'cpu' | 'gpu' | 'auto'; quality?: 'high' | 'balanced' | 'fast' }) => Promise<AddAssetResult>;
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
    proxy: {
        onProgress: (callback: (data: { assetId: number; progress: number }) => void) => () => void;
        onComplete: (callback: (data: { assetId: number; proxyPath: string }) => void) => () => void;
        onError: (callback: (data: { assetId: number; error: string }) => void) => () => void;
    };
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export {};
