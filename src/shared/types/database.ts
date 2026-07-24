/**
 * Database types for VOD Pipeline
 * Mirrors the SQLite schema
 */

import type { LLMProviderType, ReasoningEffort } from '../llm/provider-registry.js';

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
  rough_cut_completed_at: string | null;
  created_at: string;
}

export interface ChapterAsset {
  chapter_id: number;
  asset_id: number;
}

export interface VodCutRange {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
}

export interface VodCutDraft {
  project_id: number;
  asset_id: number;
  ranges: VodCutRange[];
  view?: VodCutViewState;
  updated_at: string;
}

export interface VodCutViewState {
  playheadTime: number;
  pixelsPerSecond: number;
  scrollLeft: number;
}

export interface Transcript {
  id: number;
  chapter_id: number;
  text: string;
  start_time: number;
  end_time: number;
  words_json: DetailedTranscriptWord[];
}

export interface DetailedTranscriptWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface DetailedTranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: DetailedTranscriptWord[];
}

export interface DetailedTranscript {
  id: number;
  chapter_id: number;
  asset_id: number;
  window_start: number;
  window_end: number;
  model: string;
  compute_type: string;
  word_timestamps: boolean;
  text: string;
  segments_json: DetailedTranscriptSegment[];
  created_at: string;
}

export interface ChatConversation {
  id: number;
  project_id: number;
  chapter_id: number;
  title: string;
  provider: LLMProviderType | null;
  model: string | null;
  reasoning_effort: ReasoningEffort | null;
  thread_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatConversationMessage {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking_markdown?: string | null;
  trace_json?: string | null;
  mentions_json?: string | null;
  created_at: string;
}

export interface ChatEntityMention {
  type: 'clip' | 'suggestion';
  id: number;
  label: string;
  occurrenceId?: string;
  start?: number;
  end?: number;
}

export interface ExecutionTraceEntry {
  id: string;
  status: string;
  label: string;
  nodeName?: string;
  passIndex?: number;
  stepIndex?: number;
  createdAt: string;
}

// Input types (for creating new records)
export type CreateProjectInput = Omit<Project, 'id' | 'created_at' | 'updated_at'>;
export type CreateAssetInput = Omit<Asset, 'id' | 'created_at'>;
export type CreateChapterInput = Omit<Chapter, 'id' | 'created_at' | 'display_order' | 'rough_cut_completed_at'> & { display_order?: number };
export type CreateTranscriptInput = Omit<Transcript, 'id' | 'words_json'> & {
  words_json?: DetailedTranscriptWord[];
};
export type CreateDetailedTranscriptInput = Omit<DetailedTranscript, 'id' | 'created_at'>;
export type CreateChatConversationInput = Omit<ChatConversation, 'id' | 'thread_id' | 'created_at' | 'updated_at'> & {
  thread_id?: string;
};
export type CreateChatConversationMessageInput = Omit<ChatConversationMessage, 'id' | 'created_at'>;
export type UpdateChatConversationInput = Partial<Pick<ChatConversation, 'title' | 'provider' | 'model' | 'reasoning_effort' | 'thread_id'>>;

export interface Clip {
  id: number;
  project_id: number;
  asset_id: number;
  track_index: number;
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
  peaks: Array<{ min: number; max: number }>;
  sample_rate: number;
  duration: number;
  generated_at: string;
}

// Additional input types for timeline
export type CreateClipInput = Omit<Clip, 'id' | 'created_at'>;
export type CreateTimelineStateInput = Omit<TimelineState, 'selected_clip_ids'> & { selected_clip_ids?: number[] };

// Update types
export type UpdateProjectInput = Partial<Omit<Project, 'id' | 'created_at'>>;
export type UpdateAssetInput = Partial<Omit<Asset, 'id' | 'project_id' | 'created_at'>>;
export type UpdateChapterInput = Partial<Omit<Chapter, 'id' | 'project_id' | 'created_at' | 'display_order'>> & { display_order?: number };
export type UpdateClipInput = Partial<Omit<Clip, 'id' | 'project_id' | 'created_at'>>;
export type UpdateTimelineStateInput = Partial<Omit<TimelineState, 'project_id'>>;

// ============================================================================
// PROXY TYPES (Phase 4: Visual AI)
// ============================================================================

export interface ChapterProxy {
  id: number;
  chapter_id: number;
  asset_id: number;
  file_path: string;
  preset: 'ai_analysis_chapter';
  start_time: number;
  end_time: number;
  width: number | null;
  height: number | null;
  framerate: number | null;
  file_size: number | null;
  duration: number | null;
  status: 'pending' | 'generating' | 'ready' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateChapterProxyInput = Omit<ChapterProxy, 'id' | 'created_at' | 'updated_at'>;

// ============================================================================
// SUGGESTION TYPES (Phase 4: Visual AI)
// ============================================================================

export interface Suggestion {
  id: number;
  chapter_id: number;
  conversation_id: number | null;
  chat_message_id: number | null;
  in_point: number;
  out_point: number;
  description: string | null;
  reasoning: string | null;
  provider: LLMProviderType | null;
  action_type: 'create_clip' | 'update_clip' | 'delete_clip' | 'split_clip';
  target_clip_id: number | null;
  action_payload_json: string | null;
  preview_snapshot_json: string | null;
  status: 'pending' | 'applied' | 'rejected' | 'superseded';
  supersedes_suggestion_id: number | null;
  display_order: number;
  created_at: string;
  applied_at: string | null;
  clip_id: number | null;  // Linked clip on timeline when applied
}

export type CreateSuggestionInput = Omit<
  Suggestion,
  'id' | 'created_at' | 'applied_at' | 'action_type' | 'target_clip_id' | 'action_payload_json' | 'preview_snapshot_json' | 'clip_id' | 'supersedes_suggestion_id'
> & {
  action_type?: Suggestion['action_type'];
  target_clip_id?: number | null;
  action_payload_json?: string | null;
  preview_snapshot_json?: string | null;
  clip_id?: number | null;
  supersedes_suggestion_id?: number | null;
};

export type UpdateSuggestionInput = Partial<Pick<Suggestion, 'status' | 'display_order'>>;
