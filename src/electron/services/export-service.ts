import fs from 'node:fs/promises';
import { generateEDL, generateFCPXML, generateJSON, type ExportFormat } from '../../pipeline/export/index.js';
import type { Chapter, Clip } from '../../shared/types/database.js';
import {
  clipOverlapsChapterSourceRange,
  compareChaptersForExport,
  compareClipsForExport,
  getClipDuration,
} from '../../shared/utils/clip-timing.js';
import {
  getAsset,
  getAssetsForChapter,
  getChaptersByProject,
  getClipsByProject,
  getProject,
} from '../database/index.js';
import { createLogger } from '../logger.js';

const logger = createLogger('ExportService');

export interface OrderedExportClip {
  chapter: Chapter;
  clip: Clip;
  sequenceIndex: number;
}

interface OrderedExportClipCollection {
  orderedClips: OrderedExportClip[];
  skippedClipIds: number[];
}

function collectOrderedExportClips(params: {
  chapters: Chapter[];
  clips: Clip[];
  chapterAssetIds: Map<number, Set<number>>;
}): OrderedExportClipCollection {
  const { chapters, clips, chapterAssetIds } = params;
  const clipsByChapterId = new Map<number, Clip[]>();
  const skippedClipIds: number[] = [];

  for (const clip of clips) {
    const matchingChapters = chapters.filter((chapter) => {
      const assetIds = chapterAssetIds.get(chapter.id);
      if (!assetIds?.has(clip.asset_id)) {
        return false;
      }

      return clipOverlapsChapterSourceRange(clip, chapter);
    });

    if (matchingChapters.length === 0) {
      skippedClipIds.push(clip.id);
      continue;
    }

    if (matchingChapters.length > 1) {
      throw new Error(
        `Export failed: clip ${clip.id} maps to multiple chapters (${matchingChapters.map((chapter) => chapter.id).join(', ')}).`
      );
    }

    const chapter = matchingChapters[0]!;
    const chapterClips = clipsByChapterId.get(chapter.id) ?? [];
    chapterClips.push(clip);
    clipsByChapterId.set(chapter.id, chapterClips);
  }

  const orderedChapters = [...chapters].sort(compareChaptersForExport);
  const orderedClips: OrderedExportClip[] = [];
  let sequenceIndex = 0;

  for (const chapter of orderedChapters) {
    const chapterClips = [...(clipsByChapterId.get(chapter.id) ?? [])].sort(compareClipsForExport);
    for (const clip of chapterClips) {
      orderedClips.push({
        chapter,
        clip,
        sequenceIndex,
      });
      sequenceIndex += 1;
    }
  }

  return {
    orderedClips,
    skippedClipIds,
  };
}

export function deriveOrderedExportClips(params: {
  chapters: Chapter[];
  clips: Clip[];
  chapterAssetIds: Map<number, Set<number>>;
}): OrderedExportClip[] {
  return collectOrderedExportClips(params).orderedClips;
}

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

  const chapters = await getChaptersByProject(projectId);
  const chapterAssetIds = new Map<number, Set<number>>();
  for (const chapter of chapters) {
    chapterAssetIds.set(chapter.id, new Set(await getAssetsForChapter(chapter.id)));
  }

  const { orderedClips: orderedExportClips, skippedClipIds } = collectOrderedExportClips({
    chapters,
    clips,
    chapterAssetIds,
  });

  if (skippedClipIds.length > 0) {
    logger.warn(
      `Skipping ${skippedClipIds.length} unmapped clip(s) during export because they no longer map to a chapter.`,
      { projectId, clipIds: skippedClipIds }
    );
  }

  if (orderedExportClips.length === 0) {
    throw new Error('No exportable clips in project to export');
  }

  const orderedClips = orderedExportClips.map((item) => item.clip);

  const uniqueAssetIds = [...new Set(orderedClips.map((clip) => clip.asset_id))];
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

    const clipWithAsset = orderedClips.find((clip) => clip.asset_id === assetId);
    if (clipWithAsset) {
      assetTrackIndices.set(assetId, clipWithAsset.track_index);
    }
  }

  const totalDuration = orderedClips.reduce((total, clip) => total + getClipDuration(clip), 0);
  const frameRate = options?.frameRate ?? 30;

  let content: string;
  switch (format) {
    case 'fcpxml':
      content = generateFCPXML({
        projectName: project.name,
        projectId,
        frameRate,
        clips: orderedClips,
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
        clips: orderedClips,
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
        clips: orderedClips,
        reelNames: new Map(Array.from(assetPaths.entries()).map(([id]) => [id, `REEL${id}`])),
      });
      break;
    default:
      throw new Error(`Unsupported export format: ${String(format)}`);
  }

  await fs.writeFile(filePath, content, 'utf-8');
  return { filePath, format, clipCount: orderedClips.length };
}

export function getExportFormats() {
  return [
    { id: 'fcpxml', name: 'FCPXML', description: 'Final Cut Pro XML format', extensions: ['.fcpxml'] },
    { id: 'json', name: 'JSON', description: 'Internal format', extensions: ['.json'] },
    { id: 'edl', name: 'EDL', description: 'Edit Decision List (CMX3600)', extensions: ['.edl'] },
  ];
}
