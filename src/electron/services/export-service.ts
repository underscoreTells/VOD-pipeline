import fs from 'node:fs/promises';
import { generateEDL, generateFCPXML, generateJSON, type ExportFormat } from '../../pipeline/export/index.js';
import { getAsset, getClipsByProject, getProject } from '../database/index.js';

export async function exportProjectToFile(input: {
  projectId: number;
  format: ExportFormat;
  filePath: string;
  options?: {
    frameRate?: number;
    includeAudio?: boolean;
  };
}): Promise<{ filePath: string; format: ExportFormat; clipCount: number }> {
  const { projectId, format, filePath, options } = input;
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const clips = await getClipsByProject(projectId);
  if (clips.length === 0) {
    throw new Error('No clips in project to export');
  }

  const uniqueAssetIds = [...new Set(clips.map((clip) => clip.asset_id))];
  const assetPaths = new Map<number, string>();
  const assetDurations = new Map<number, number>();
  const assetTrackIndices = new Map<number, number>();

  for (const assetId of uniqueAssetIds) {
    const asset = await getAsset(assetId);
    if (!asset) {
      continue;
    }

    assetPaths.set(assetId, asset.file_path);
    assetDurations.set(assetId, asset.duration ?? 0);

    const clipWithAsset = clips.find((clip) => clip.asset_id === assetId);
    if (clipWithAsset) {
      assetTrackIndices.set(assetId, clipWithAsset.track_index);
    }
  }

  const totalDuration = Math.max(...clips.map((clip) => clip.start_time + (clip.out_point - clip.in_point)));
  const frameRate = options?.frameRate ?? 30;

  let content: string;
  switch (format) {
    case 'fcpxml':
      content = generateFCPXML({
        projectName: project.name,
        projectId,
        frameRate,
        clips,
        assetPaths,
        assetDurations,
      });
      break;
    case 'json':
      content = generateJSON({
        projectId,
        projectName: project.name,
        frameRate,
        totalDuration,
        clips,
        assetPaths,
        audioTracks: Array.from(assetTrackIndices.entries()).map(([assetId, trackIndex]) => ({
          index: trackIndex,
          sourceFile: assetPaths.get(assetId) ?? '',
        })),
      });
      break;
    case 'edl':
      content = generateEDL({
        title: project.name,
        frameRate,
        clips,
        reelNames: new Map(Array.from(assetPaths.entries()).map(([id]) => [id, `REEL${id}`])),
      });
      break;
    default:
      throw new Error(`Unsupported export format: ${String(format)}`);
  }

  await fs.writeFile(filePath, content, 'utf-8');
  return { filePath, format, clipCount: clips.length };
}

export function getExportFormats() {
  return [
    { id: 'fcpxml', name: 'FCPXML', description: 'Final Cut Pro XML format', extensions: ['.fcpxml'] },
    { id: 'json', name: 'JSON', description: 'Internal format', extensions: ['.json'] },
    { id: 'edl', name: 'EDL', description: 'Edit Decision List (CMX3600)', extensions: ['.edl'] },
  ];
}
