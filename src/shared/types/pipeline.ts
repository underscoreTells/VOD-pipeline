/**
 * Pipeline types for video processing
 */

import type { FFmpegPathResult } from '../../electron/ffmpeg-detector';

export { FFmpegPathResult };

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
}

export interface TranscriptionProgress {
  percent: number;
  status: string;
}

export type TranscriptionProgressCallback = (progress: TranscriptionProgress) => void;

export interface ScaleOptions {
  width?: number;
  height?: number;
  maintainAspectRatio?: boolean;
}

export interface FramerateOptions {
  fps: number;
  method?: 'drop' | 'interpolate';
}

export interface ProxyOptions {
  width: number;
  fps: number;
  videoCodec: string;
  videoBitrate?: string;
  audioCodec?: string;
}

export interface ProxyPreset {
  name: string;
  options: ProxyOptions;
}

export const PROXY_PRESETS: Record<string, ProxyPreset> = {
  AI_ANALYSIS: {
    name: 'AI Analysis',
    options: {
      width: 640,
      fps: 5,
      videoCodec: 'libx264',
      videoBitrate: '500k',
    },
  },
  ROUGH_CUT: {
    name: 'Rough Cut',
    options: {
      width: 720,
      fps: 15,
      videoCodec: 'libx264',
      videoBitrate: '1M',
    },
  },
  EDITABLE: {
    name: 'Editable',
    options: {
      width: 1280,
      fps: 24,
      videoCodec: 'libx264',
      videoBitrate: '2M',
    },
  },
  REVIEW: {
    name: 'Review',
    options: {
      width: 1920,
      fps: 30,
      videoCodec: 'prores',
      videoBitrate: '10M',
    },
  },
};

export interface CutOptions {
  startTime: number;
  endTime: number;
  reencode?: boolean;
}

export interface AudioExtractOptions {
  trackIndex?: number;
  sampleRate?: number;
  channels?: number;
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
