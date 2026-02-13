import type { Asset, Clip, TimelineState, Suggestion, Chapter, ChatConversation, ChatConversationMessage } from "../shared/types/database";
import type { AgentChatData, AgentOutputMessage, TimelineAction } from "../shared/types/agent-ipc";

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

export interface WaveformGenerateOptions {
    includeSourceTracks?: boolean;
    playbackActive?: boolean;
}

export interface WaveformProgressEvent {
    assetId: number;
    trackIndex?: number;
    progress: {
        tier: number;
        percent: number;
        status: string;
        trackIndex?: number;
    };
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

export interface TranscriptionProgressEvent {
    chapterId: number;
    progress: {
        percent: number;
        status: string;
    };
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
    data?: {
        applied?: boolean;
        previewed?: boolean;
        cancelled?: boolean;
        clip?: Clip;
        removedClipId?: number;
    };
    error?: string;
}

export interface ApplyAllSuggestionsResult {
    success: boolean;
    data?: {
        appliedCount: number;
        total: number;
        clips: Clip[];
        results: Array<{
            suggestionId: number;
            success: boolean;
            clip?: Clip;
            error?: string;
        }>;
    };
    error?: string;
}

export interface ElectronAPI {
    projects: {
        create: (name: string) => Promise<CreateProjectResult>;
        getAll: () => Promise<GetProjectsResult>;
        get: (id: number) => Promise<GetProjectResult>;
        delete: (id: number) => Promise<DeleteProjectResult>;
    };
    agent: {
        chat: (params: { 
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
        onStream: (callback: (message: AgentOutputMessage) => void) => () => void;
        onError: (callback: (payload: { error: string }) => void) => () => void;
        getSuggestions: (chapterId: string) => Promise<GetSuggestionsResult>;
        previewSuggestion: (suggestionId: number) => Promise<ApplySuggestionResult>;
        cancelSuggestionPreview: (suggestionId: number) => Promise<ApplySuggestionResult>;
        applySuggestion: (suggestionId: number) => Promise<ApplySuggestionResult>;
        rejectSuggestion: (suggestionId: number) => Promise<ApplySuggestionResult>;
        applyAllSuggestions: (chapterId: string) => Promise<ApplyAllSuggestionsResult>;
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
        batchUpdate: (updates: Array<{ id: number } & Partial<Clip>>) => Promise<BatchUpdateClipsResult>;
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
