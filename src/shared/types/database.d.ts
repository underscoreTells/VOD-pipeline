/**
 * Database types for VOD Pipeline
 * Mirrors the SQLite schema
 */
export interface Project {
    id: number;
    name: string;
    created_at: string;
    updated_at: string;
}
export interface Asset {
    id: number;
    project_id: number;
    file_path: string;
    file_type: 'video' | 'audio' | 'image' | null;
    duration: number | null;
    metadata: AssetMetadata | null;
    created_at: string;
}
export interface AssetMetadata {
    width?: number;
    height?: number;
    fps?: number;
    videoCodec?: string;
    audioCodec?: string;
    audioTracks?: AudioTrackInfo[];
    bitrate?: number;
    container?: string;
    [key: string]: unknown;
}
export interface AudioTrackInfo {
    index: number;
    codec: string;
    sampleRate: number;
    channels: number;
    language?: string;
    title?: string;
}
export interface Chapter {
    id: number;
    project_id: number;
    title: string;
    start_time: number;
    end_time: number;
    display_order: number;
    created_at: string;
}
export interface ChapterAsset {
    chapter_id: number;
    asset_id: number;
}
export interface Transcript {
    id: number;
    chapter_id: number;
    text: string;
    start_time: number;
    end_time: number;
}
export interface Beat {
    id: number;
    chapter_id: number;
    start_time: number;
    end_time: number;
    role: 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition';
    why_essential: string | null;
    visual_dependency: 'none' | 'important' | 'critical' | null;
    is_essential: boolean;
    display_order: number;
    user_modified: boolean;
    discard: boolean;
    sort_order: number | null;
    clip_id: number | null;
}
export interface Conversation {
    id: number;
    project_id: number;
    role: 'user' | 'assistant' | 'system';
    message: string;
    created_at: string;
}
export type CreateProjectInput = Omit<Project, 'id' | 'created_at' | 'updated_at'>;
export type CreateAssetInput = Omit<Asset, 'id' | 'created_at'>;
export type CreateChapterInput = Omit<Chapter, 'id' | 'created_at' | 'display_order'> & {
    display_order?: number;
};
export type CreateTranscriptInput = Omit<Transcript, 'id'>;
export type CreateBeatInput = Omit<Beat, 'id'>;
export type CreateConversationInput = Omit<Conversation, 'id' | 'created_at'>;
export interface Clip {
    id: number;
    project_id: number;
    asset_id: number;
    track_index: number;
    start_time: number;
    in_point: number;
    out_point: number;
    role: 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition' | null;
    description: string | null;
    is_essential: boolean;
    created_at: string;
}
export interface TimelineState {
    project_id: number;
    zoom_level: number;
    scroll_position: number;
    playhead_time: number;
    selected_clip_ids: number[];
}
export interface WaveformCache {
    asset_id: number;
    track_index: number;
    tier_level: 1 | 2 | 3;
    peaks: Array<{
        min: number;
        max: number;
    }>;
    sample_rate: number;
    duration: number;
    generated_at: string;
}
export type CreateClipInput = Omit<Clip, 'id' | 'created_at'>;
export type CreateTimelineStateInput = Omit<TimelineState, 'selected_clip_ids'> & {
    selected_clip_ids?: number[];
};
export type UpdateProjectInput = Partial<Omit<Project, 'id' | 'created_at'>>;
export type UpdateAssetInput = Partial<Omit<Asset, 'id' | 'project_id' | 'created_at'>>;
export type UpdateChapterInput = Partial<Omit<Chapter, 'id' | 'project_id' | 'created_at' | 'display_order'>> & {
    display_order?: number;
};
export type UpdateClipInput = Partial<Omit<Clip, 'id' | 'project_id' | 'created_at'>>;
export type UpdateTimelineStateInput = Partial<Omit<TimelineState, 'project_id'>>;
export interface Proxy {
    id: number;
    asset_id: number;
    file_path: string;
    preset: 'ai_analysis';
    width: number | null;
    height: number | null;
    framerate: number | null;
    file_size: number | null;
    duration: number | null;
    status: 'pending' | 'generating' | 'ready' | 'error';
    error_message: string | null;
    created_at: string;
}
export type CreateProxyInput = Omit<Proxy, 'id' | 'created_at'>;
export interface Suggestion {
    id: number;
    chapter_id: number;
    in_point: number;
    out_point: number;
    description: string | null;
    reasoning: string | null;
    provider: 'gemini' | 'kimi' | null;
    status: 'pending' | 'applied' | 'rejected';
    display_order: number;
    created_at: string;
    applied_at: string | null;
    clip_id: number | null;
}
export type CreateSuggestionInput = Omit<Suggestion, 'id' | 'created_at' | 'applied_at' | 'clip_id'> & {
    clip_id?: number | null;
};
export type UpdateSuggestionInput = Partial<Pick<Suggestion, 'status' | 'display_order'>>;
