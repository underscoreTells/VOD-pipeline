import * as fs from 'node:fs';
import {
  getAssetsByProject,
  getAssetsForChapter,
  getChapter,
  getChapterProxyByChapterAsset,
  getClipsByProject,
  getTranscriptsByChapter,
} from '../../database/index.js';
import type { AgentGroundingStatusData, ProxyOptions } from '../../../shared/contracts/electron-api.js';
import type { DetailedTranscriptWindow } from '../../../shared/types/agent-ipc.js';
import { clipOverlapsChapterSourceRange } from '../../../shared/utils/clip-timing.js';
import { formatOverviewTranscript } from './transcripts.js';
import {
  ensureChapterProxyReady,
  getReusableChapterProxy,
  recoverChapterProxyIfCurrent,
} from './chapter-proxies.js';
import { normalizeProxyOptions } from './payload.js';

const groundingSchedulingErrors = new Map<string, string>();

function getGroundingStatusMessage(
  status: AgentGroundingStatusData['status']
): string {
  switch (status) {
    case 'missing_video_asset':
      return 'This chapter has no linked video asset. Agent chat requires video grounding and is locked.';
    case 'error':
      return 'Video proxy failed to build. Agent chat is locked until grounding is available.';
    case 'ready':
      return 'Video grounding is ready.';
    case 'idle':
      return '';
    case 'generating':
    default:
      return 'Video proxy is still preparing. Agent chat is locked until grounding is ready.';
  }
}

export async function getAgentGroundingStatus(
  projectId: number,
  chapterId: number,
  options?: {
    ensureReady?: boolean;
    proxyOptions?: ProxyOptions;
    onProgress?: (assetId: number, percent: number) => void;
  }
): Promise<AgentGroundingStatusData> {
  const chapter = await getChapter(chapterId);
  if (!chapter) {
    throw new Error(`Chapter not found: ${chapterId}`);
  }
  if (chapter.project_id !== projectId) {
    throw new Error(`Chapter ${chapterId} does not belong to project ${projectId}`);
  }

  const [projectAssets, chapterAssetIds] = await Promise.all([
    getAssetsByProject(projectId),
    getAssetsForChapter(chapter.id),
  ]);
  const chapterAssetSet = new Set(chapterAssetIds);
  const chapterVideoAssets = projectAssets.filter(
    (asset) => chapterAssetSet.has(asset.id) && asset.file_type === 'video'
  );

  if (chapterVideoAssets.length === 0) {
    return {
      status: 'missing_video_asset',
      requiredVideoAssetCount: 0,
      readyVideoAssetCount: 0,
      assets: [],
      message: getGroundingStatusMessage('missing_video_asset'),
    };
  }

  const normalizedProxyOptions = normalizeProxyOptions(options?.proxyOptions);
  const assets = await Promise.all(chapterVideoAssets.map(async (asset) => {
    const groundingKey = `${chapter.id}:${asset.id}`;
    let chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
    const reusableChapterProxy = await getReusableChapterProxy(chapterProxy, chapter);

    if (reusableChapterProxy) {
      groundingSchedulingErrors.delete(groundingKey);
      return {
        assetId: asset.id,
        status: 'ready' as const,
      };
    }

    let sourceExists = false;
    if (asset.file_path) {
      try {
        await fs.promises.access(asset.file_path);
        sourceExists = true;
      } catch {
        sourceExists = false;
      }
    }

    if (!sourceExists) {
      return {
        assetId: asset.id,
        status: 'error' as const,
        error: 'Source media file is missing.',
      };
    }

    if (options?.ensureReady) {
      groundingSchedulingErrors.delete(groundingKey);
      const assetProgress = options.onProgress
        ? (percent: number) => options.onProgress!(asset.id, percent)
        : undefined;
      void ensureChapterProxyReady(
        chapter,
        asset,
        normalizedProxyOptions.encodingMode,
        normalizedProxyOptions.quality,
        'interactive',
        assetProgress
      ).catch((error) => {
        groundingSchedulingErrors.set(
          groundingKey,
          error instanceof Error ? error.message : String(error)
        );
        console.warn(
          `[AgentGrounding] Failed scheduling proxy chapter=${chapter.id} asset=${asset.id}:`,
          error
        );
      });
      return {
        assetId: asset.id,
        status: 'generating' as const,
      };
    }

    const schedulingError = groundingSchedulingErrors.get(groundingKey);
    if (schedulingError) {
      return {
        assetId: asset.id,
        status: 'error' as const,
        error: schedulingError,
      };
    }

    if (chapterProxy?.status === 'error') {
      return {
        assetId: asset.id,
        status: 'error' as const,
        error: chapterProxy.error_message ?? 'Video proxy generation failed.',
      };
    }

    return {
      assetId: asset.id,
      status: 'generating' as const,
    };
  }));

  const readyVideoAssetCount = assets.filter((asset) => asset.status === 'ready').length;
  const hasError = assets.some((asset) => asset.status === 'error');
  const hasGenerating = assets.some((asset) => asset.status === 'generating');

  const status: AgentGroundingStatusData['status'] = hasError
    ? 'error'
    : readyVideoAssetCount === chapterVideoAssets.length
      ? 'ready'
      : hasGenerating
        ? 'generating'
        : 'error';

  return {
    status,
    requiredVideoAssetCount: chapterVideoAssets.length,
    readyVideoAssetCount,
    assets,
    message: getGroundingStatusMessage(status),
  };
}

export async function buildAgentChatContext(
  projectId: number,
  chapterId?: number,
  options?: {
    detailedTranscripts?: DetailedTranscriptWindow[];
    ensureChapterProxyReady?: boolean;
    proxyOptions?: ProxyOptions;
  }
) {
  const detailedTranscripts = options?.detailedTranscripts ?? [];
  const projectAssets = await getAssetsByProject(projectId);
  const projectClips = await getClipsByProject(projectId);

  if (!chapterId) {
    return {
      chapter: undefined,
      chapterAssetIds: [] as number[],
      chapterClips: [] as Array<{
        id: number;
        assetId: number;
        trackIndex: number;
        inPoint: number;
        outPoint: number;
        role: string | null;
        description: string | null;
        isEssential: boolean;
      }>,
      transcript: '',
      detailedTranscripts,
      videoAnalysisAssets: [] as Array<{ assetId: number; proxyPath: string }>,
    };
  }

  const chapter = await getChapter(chapterId);
  if (!chapter) {
    throw new Error(`Chapter not found: ${chapterId}`);
  }
  if (chapter.project_id !== projectId) {
    throw new Error(`Chapter ${chapterId} does not belong to project ${projectId}`);
  }

  const chapterAssetIds = await getAssetsForChapter(chapter.id);
  const chapterAssetSet = new Set(chapterAssetIds);
  const chapterAssets = projectAssets.filter((asset) => chapterAssetSet.has(asset.id));
  const chapterClips = projectClips
    .filter((clip) => chapterAssetSet.has(clip.asset_id))
    .filter((clip) => clipOverlapsChapterSourceRange(clip, chapter))
    .map((clip) => ({
      id: clip.id,
      assetId: clip.asset_id,
      trackIndex: clip.track_index,
      inPoint: clip.in_point,
      outPoint: clip.out_point,
      role: clip.role,
      description: clip.description,
      isEssential: clip.is_essential,
    }));

  const transcriptSegments = await getTranscriptsByChapter(chapter.id);
  const transcript = formatOverviewTranscript(
    transcriptSegments,
    chapter.start_time,
    chapter.end_time
  );

  const videoAnalysisAssets: Array<{ assetId: number; proxyPath: string }> = [];
  for (const asset of chapterAssets.filter((candidate) => candidate.file_type === 'video')) {
    let chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
    let reusableChapterProxy = await getReusableChapterProxy(chapterProxy, chapter);

    if (!reusableChapterProxy && options?.ensureChapterProxyReady) {
      const normalizedProxyOptions = normalizeProxyOptions(options.proxyOptions);
      await ensureChapterProxyReady(
        chapter,
        asset,
        normalizedProxyOptions.encodingMode,
        normalizedProxyOptions.quality,
        'interactive'
      );
      chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
      chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
      reusableChapterProxy = await getReusableChapterProxy(chapterProxy, chapter);
    }

    if (reusableChapterProxy) {
      videoAnalysisAssets.push({
        assetId: asset.id,
        proxyPath: reusableChapterProxy.file_path,
      });
    }
  }

  return {
    chapter: {
      id: String(chapter.id),
      title: chapter.title,
      startTime: chapter.start_time,
      endTime: chapter.end_time,
    },
    chapterAssetIds,
    chapterClips,
    transcript,
    detailedTranscripts,
    videoAnalysisAssets,
  };
}
