/**
 * Pipeline types for video processing
 */

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  audioTracks: AudioTrackMetadata[];
  bitrate: number;
  container: string;
}

export interface AudioTrackMetadata {
  index: number;
  codec: string;
  sampleRate: number;
  channels: number;
  language?: string;
  title?: string;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: TranscriptionWord[];
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  duration: number;
  segments: TranscriptionSegment[];
}

export interface TranscriptionOptions {
  audioPath: string;
  model?: 'tiny' | 'base' | 'small' | 'medium';
  language?: string;
  computeType?: 'int8' | 'float16';
  wordTimestamps?: boolean;
}

export interface TranscriptionProgress {
  percent: number;
  status: string;
}

export type TranscriptionProgressCallback = (progress: TranscriptionProgress) => void;

export interface AudioExtractOptions {
  trackIndex?: number;
  sampleRate?: number;
  channels?: number;
  startTime?: number;
  endTime?: number;
  signal?: AbortSignal;
}

export interface FFprobeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  tags?: {
    language?: string;
    title?: string;
    [key: string]: string | undefined;
  };
}

export interface FFprobeFormat {
  duration?: string;
  bit_rate?: string;
  format_name?: string;
}

export interface FFprobeOutput {
  streams: FFprobeStream[];
  format: FFprobeFormat;
}

// Waveform generation types
export interface WaveformPeak {
  min: number;
  max: number;
}

export interface WaveformTier {
  level: 1 | 2 | 3;
  ratio: number;
  resolution: number; // samples per second
}

export const WAVEFORM_TIERS: Record<number, WaveformTier> = {
  1: { level: 1, ratio: 256, resolution: 172 },    // Overview: 256:1
  2: { level: 2, ratio: 16, resolution: 2756 },    // Standard: 16:1
  3: { level: 3, ratio: 4, resolution: 11025 },    // Fine: 4:1
};

export interface WaveformProgress {
  tier: 1 | 2 | 3;
  percent: number;
  status: string;
  trackIndex?: number;
}

export type WaveformProgressCallback = (progress: WaveformProgress) => void;

export interface WaveformGenerationResult {
  assetId: number;
  trackIndex: number;
  tiers: Array<{
    level: 1 | 2 | 3;
    peaks: WaveformPeak[];
    sampleRate: number;
    duration: number;
  }>;
}
