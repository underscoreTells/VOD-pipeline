import type { Clip } from '../../shared/types/database.js';

export interface JSONExportOptions {
  projectId: number;
  projectName: string;
  frameRate: number;
  totalDuration: number;
  clips: Clip[];
  assetPaths: Map<number, string>; // assetId -> file path
  audioTracks: Array<{ index: number; sourceFile: string }>;
}

export interface JSONExportData {
  version: string;
  exportedAt: string;
  projectId: number;
  projectName: string;
  frameRate: number;
  totalDuration: number;
  clips: Array<{
    id: number;
    assetId: number;
    trackIndex: number;
    role: string | null;
    startTime: number;
    inPoint: number;
    outPoint: number;
    duration: number;
    isEssential: boolean;
    description: string | null;
  }>;
  audioTracks: Array<{
    index: number;
    sourceFile: string;
  }>;
  assets: Array<{
    id: number;
    path: string;
  }>;
}

export function generateJSON(options: JSONExportOptions): string {
  const { projectId, projectName, frameRate, totalDuration, clips, assetPaths, audioTracks } = options;
  
  const exportData: JSONExportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    projectId,
    projectName,
    frameRate,
    totalDuration,
    clips: clips.map(clip => ({
      id: clip.id,
      assetId: clip.asset_id,
      trackIndex: clip.track_index,
      role: clip.role,
      startTime: clip.start_time,
      inPoint: clip.in_point,
      outPoint: clip.out_point,
      duration: clip.out_point - clip.in_point,
      isEssential: clip.is_essential,
      description: clip.description,
    })),
    audioTracks,
    assets: Array.from(assetPaths.entries()).map(([id, path]) => ({
      id,
      path,
    })),
  };
  
  return JSON.stringify(exportData, null, 2);
}
