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
}

export interface Conversation {
  id: number;
  project_id: number;
  role: 'user' | 'assistant' | 'system';
  message: string;
  created_at: string;
}

// Input types (for creating new records)
export type CreateProjectInput = Omit<Project, 'id' | 'created_at' | 'updated_at'>;
export type CreateAssetInput = Omit<Asset, 'id' | 'created_at'>;
export type CreateChapterInput = Omit<Chapter, 'id' | 'created_at'>;
export type CreateTranscriptInput = Omit<Transcript, 'id'>;
export type CreateBeatInput = Omit<Beat, 'id'>;
export type CreateConversationInput = Omit<Conversation, 'id' | 'created_at'>;

// Update types
export type UpdateProjectInput = Partial<Omit<Project, 'id' | 'created_at'>>;
export type UpdateAssetInput = Partial<Omit<Asset, 'id' | 'project_id' | 'created_at'>>;
export type UpdateChapterInput = Partial<Omit<Chapter, 'id' | 'project_id' | 'created_at'>>;
