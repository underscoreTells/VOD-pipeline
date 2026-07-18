import * as fs from 'node:fs';
import { isAudiowaveformAvailable } from '../../audiowaveformDetector.js';
import {
  createChapterProxy,
  getAsset,
  getAssetsForChapter,
  getChapter,
  getChapterProxyByChapterAsset,
  getWaveform,
  updateChapterProxyDefinition,
  updateChapterProxyMetadata,
  updateChapterProxyStatus,
} from '../../database/index.js';
import type { Asset, ChapterProxy } from '../../../shared/types/database.js';
import type { ProxyOptions } from '../../../shared/contracts/electron-api.js';
import {
  ensureProxyDirectory,
  getChapterProxyPath,
  getChapterProxyTempPath,
} from '../../paths.js';
import {
  GPUProxyFallbackError,
  generateAIProxy,
  getVideoMetadata,
  resolveProxyResourceClass,
  type ProxyFallbackContext,
} from '../../../pipeline/ffmpeg.js';
import {
  generateWaveformTiers,
} from '../../../pipeline/waveform.js';
import {
  bumpGenerationEpoch,
  enqueueChapterMediaPrewarm,
  enqueueHeavyMediaJob,
  getGenerationEpoch,
  isCancellationError,
  promoteHeavyMediaJob,
  type HeavyMediaJobPriority,
} from './heavy-media-queue.js';
import { normalizeProxyOptions } from './payload.js';

const CHAPTER_PROXY_TIME_EPSILON = 0.01;
type ChapterRecord = NonNullable<Awaited<ReturnType<typeof getChapter>>>;
type ChapterProxyRecord = NonNullable<Awaited<ReturnType<typeof getChapterProxyByChapterAsset>>>;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const chapterProxyGenerationLocks = new Map<string, {
  epoch: number;
  promise: Promise<string | undefined>;
  progressListeners: Set<(percent: number) => void>;
}>();
const chapterWaveformPrewarmLocks = new Map<string, Promise<void>>();
const chapterMediaPrewarmLocks = new Map<string, Promise<void>>();
const chapterProxyGenerationEpochs = new Map<string, number>();

export async function isChapterProxyArtifactCurrent(
  proxy: Pick<ChapterProxy, 'file_path' | 'start_time' | 'end_time'> | null | undefined,
  chapter: Pick<ChapterRecord, 'start_time' | 'end_time'>
): Promise<boolean> {
  if (!proxy?.file_path) {
    return false;
  }

  try {
    const stats = await fs.promises.stat(proxy.file_path);
    if (!stats.isFile() || stats.size <= 0) {
      return false;
    }
  } catch {
    return false;
  }

  return (
    Math.abs(proxy.start_time - chapter.start_time) <= CHAPTER_PROXY_TIME_EPSILON
    && Math.abs(proxy.end_time - chapter.end_time) <= CHAPTER_PROXY_TIME_EPSILON
  );
}

export async function isChapterProxyReusable(
  proxy: {
    status: string;
    file_path: string;
    start_time: number;
    end_time: number;
  } | null | undefined,
  chapter: { start_time: number; end_time: number }
): Promise<boolean> {
  if (!proxy || proxy.status !== 'ready') {
    return false;
  }

  return isChapterProxyArtifactCurrent(proxy, chapter);
}

export async function getReusableChapterProxy(
  proxy: ChapterProxyRecord | null | undefined,
  chapter: Pick<ChapterRecord, 'start_time' | 'end_time'>
): Promise<ChapterProxyRecord | null> {
  if (!proxy) {
    return null;
  }

  return (await isChapterProxyReusable(proxy, chapter)) ? proxy : null;
}

export async function recoverChapterProxyIfCurrent(
  proxy: ChapterProxyRecord | null | undefined,
  chapter: Pick<ChapterRecord, 'id' | 'start_time' | 'end_time'>
): Promise<ChapterProxyRecord | null> {
  if (!proxy || proxy.status === 'ready' || !isChapterProxyArtifactCurrent(proxy, chapter)) {
    return proxy ?? null;
  }

  const metadataUpdates: Parameters<typeof updateChapterProxyMetadata>[1] = {};

  try {
    const stats = await fs.promises.stat(proxy.file_path);
    if (proxy.file_size === null) {
      metadataUpdates.file_size = stats.size;
    }
  } catch {
    return proxy;
  }

  const requiresVideoMetadata =
    proxy.width === null
    || proxy.height === null
    || proxy.framerate === null
    || proxy.duration === null;

  if (requiresVideoMetadata) {
    try {
      const metadata = await getVideoMetadata(proxy.file_path);
      if (proxy.width === null && Number.isFinite(metadata.width)) {
        metadataUpdates.width = metadata.width;
      }
      if (proxy.height === null && Number.isFinite(metadata.height)) {
        metadataUpdates.height = metadata.height;
      }
      if (proxy.framerate === null && Number.isFinite(metadata.fps)) {
        metadataUpdates.framerate = metadata.fps;
      }
      if (proxy.duration === null && Number.isFinite(metadata.duration)) {
        metadataUpdates.duration = metadata.duration;
      }
    } catch (error) {
      console.warn(
        `[ChapterProxy] Failed to backfill proxy metadata chapter=${chapter.id} asset=${proxy.asset_id}:`,
        error
      );
    }
  }

  if (Object.keys(metadataUpdates).length > 0) {
    await updateChapterProxyMetadata(proxy.id, metadataUpdates);
  }
  await updateChapterProxyStatus(proxy.id, 'ready');

  return await getChapterProxyByChapterAsset(chapter.id, proxy.asset_id);
}

export async function deleteFileIfExists(filePath: string | null | undefined, label: string): Promise<void> {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.access(filePath);
  } catch {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    console.warn(`[${label}] Failed deleting file ${filePath}:`, error);
  }
}

function getChapterProxyJobKey(chapterId: number, assetId: number): string {
  return `chapterProxy:${chapterId}:${assetId}`;
}

export function buildChapterProxyJobKey(chapterId: number, assetId: number): string {
  return getChapterProxyJobKey(chapterId, assetId);
}

export async function ensureChapterProxyReady(
  chapter: ChapterRecord,
  asset: Asset,
  encodingMode: 'cpu' | 'gpu' | 'auto' = 'auto',
  quality: 'high' | 'balanced' | 'fast' = 'balanced',
  priority: HeavyMediaJobPriority = 'interactive',
  onProgress?: (percent: number) => void
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const jobKey = getChapterProxyJobKey(chapter.id, asset.id);
  const generationEpoch = getGenerationEpoch(chapterProxyGenerationEpochs, lockKey);
  const inFlight = chapterProxyGenerationLocks.get(lockKey);
  if (inFlight && inFlight.epoch === generationEpoch) {
    if (onProgress) {
      inFlight.progressListeners.add(onProgress);
    }
    if (priority === 'interactive') {
      promoteHeavyMediaJob(jobKey);
    }
    return inFlight.promise;
  }

  const progressListeners = new Set<(percent: number) => void>();
  if (onProgress) {
    progressListeners.add(onProgress);
  }
  const emitProgress = (percent: number) => {
    for (const listener of progressListeners) {
      listener(percent);
    }
  };

  const task = (async () => {
    const existing = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    const reusableExisting = await getReusableChapterProxy(existing, chapter);
    if (reusableExisting) {
      return reusableExisting.file_path;
    }

    const recovered = await recoverChapterProxyIfCurrent(existing, chapter);
    const reusableRecovered = await getReusableChapterProxy(recovered, chapter);
    if (reusableRecovered) {
      return reusableRecovered.file_path;
    }

    const proxyPath = existing?.file_path || getChapterProxyPath(chapter.id, asset.id);
    const tempPath = getChapterProxyTempPath(chapter.id, asset.id, generationEpoch);

    let chapterProxyId = existing?.id ?? null;
    if (chapterProxyId === null) {
      const created = await createChapterProxy({
        chapter_id: chapter.id,
        asset_id: asset.id,
        file_path: proxyPath,
        preset: 'ai_analysis_chapter',
        start_time: chapter.start_time,
        end_time: chapter.end_time,
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        status: 'generating',
        error_message: null,
      });
      chapterProxyId = created.id;
    } else {
      if (!existing) {
        throw new Error(`Expected existing chapter proxy for chapter=${chapter.id} asset=${asset.id}`);
      }

      await deleteFileIfExists(existing.file_path, 'ChapterProxy');
      await updateChapterProxyDefinition(chapterProxyId, {
        file_path: proxyPath,
        start_time: chapter.start_time,
        end_time: chapter.end_time,
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        status: 'pending',
        error_message: null,
      });
    }

    try {
      const generate = (
        mode: 'cpu' | 'gpu' | 'auto',
        deferCpuFallback: boolean,
        fallbackContext?: ProxyFallbackContext
      ) => async (signal: AbortSignal) => {
        await deleteFileIfExists(tempPath, 'ChapterProxy');
        await updateChapterProxyStatus(chapterProxyId, 'generating');
        await ensureProxyDirectory();

        const metadata = await generateAIProxy(
          asset.file_path,
          tempPath,
          emitProgress,
          30 * 60 * 1000,
          mode,
          quality,
          {
            startTime: chapter.start_time,
            endTime: chapter.end_time,
          },
          signal,
          deferCpuFallback,
          fallbackContext
        );

        if (getGenerationEpoch(chapterProxyGenerationEpochs, lockKey) !== generationEpoch) {
          await deleteFileIfExists(tempPath, 'ChapterProxy');
          return;
        }

        await deleteFileIfExists(proxyPath, 'ChapterProxy');
        await fs.promises.rename(tempPath, proxyPath);

        await updateChapterProxyMetadata(chapterProxyId, {
          width: metadata.width,
          height: metadata.height,
          framerate: metadata.framerate,
          file_size: metadata.fileSize,
          duration: metadata.duration,
        });
        await updateChapterProxyStatus(chapterProxyId, 'ready');
      };
      const resourceClass = await resolveProxyResourceClass(encodingMode);
      let fallbackContext: ProxyFallbackContext | undefined;
      await enqueueHeavyMediaJob(
        jobKey,
        'chapterProxy',
        priority,
        generate(encodingMode, resourceClass === 'gpu'),
        {
          resourceClass,
          cpuFallback: {
            shouldFallback: (error) => {
              if (!(error instanceof GPUProxyFallbackError)) return false;
              fallbackContext = {
                requestedMode: encodingMode,
                reason: error.reason,
                fallbackFrom: error.fallbackFrom,
              };
              return true;
            },
            run: (signal) => generate('cpu', false, fallbackContext)(signal),
          },
        }
      );

      if (getGenerationEpoch(chapterProxyGenerationEpochs, lockKey) !== generationEpoch) {
        await deleteFileIfExists(tempPath, 'ChapterProxy');
        return undefined;
      }

      return proxyPath;
    } catch (error) {
      await deleteFileIfExists(tempPath, 'ChapterProxy');
      if (getGenerationEpoch(chapterProxyGenerationEpochs, lockKey) === generationEpoch) {
        if (isCancellationError(error)) {
          // Cancellation is not a permanent failure: reset to the "not generated
          // yet" state so a future request can re-enqueue cleanly.
          await updateChapterProxyStatus(chapterProxyId, 'pending', undefined);
        } else {
          await updateChapterProxyStatus(
            chapterProxyId,
            'error',
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      console.warn(
        `[ChapterProxy] Failed generating chapter proxy chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }
  })();

  chapterProxyGenerationLocks.set(lockKey, {
    epoch: generationEpoch,
    promise: task,
    progressListeners,
  });
  try {
    return await task;
  } finally {
    const currentLock = chapterProxyGenerationLocks.get(lockKey);
    if (currentLock?.promise === task) {
      chapterProxyGenerationLocks.delete(lockKey);
    }
  }
}

export async function invalidateChapterProxy(
  chapterId: number,
  assetId: number,
  bounds?: { startTime?: number; endTime?: number }
): Promise<void> {
  const lockKey = `${chapterId}:${assetId}`;
  bumpGenerationEpoch(chapterProxyGenerationEpochs, lockKey);

  const existing = await getChapterProxyByChapterAsset(chapterId, assetId);
  if (!existing) {
    return;
  }

  await deleteFileIfExists(existing.file_path, 'ChapterProxy');
  await updateChapterProxyDefinition(existing.id, {
    file_path: existing.file_path || getChapterProxyPath(chapterId, assetId),
    start_time: bounds?.startTime ?? existing.start_time,
    end_time: bounds?.endTime ?? existing.end_time,
    width: null,
    height: null,
    framerate: null,
    file_size: null,
    duration: null,
    status: 'pending',
    error_message: null,
  });
}

async function ensureAssetMixWaveformReady(asset: Asset): Promise<void> {
  if (!isAudiowaveformAvailable()) {
    return;
  }

  const lockKey = `${asset.id}:-1`;
  const inFlight = chapterWaveformPrewarmLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    if (!asset.file_path || !(await pathExists(asset.file_path))) {
      return;
    }

    const existingTier1 = await getWaveform(asset.id, -1, 1);
    if (existingTier1) {
      return;
    }

    await generateWaveformTiers(asset.file_path, asset.id, -1, undefined, {
      includeTier2: false,
    });
  })();

  chapterWaveformPrewarmLocks.set(lockKey, task);
  try {
    await task;
  } finally {
    chapterWaveformPrewarmLocks.delete(lockKey);
  }
}

async function prewarmChapterMedia(
  chapterId: number,
  assetId: number,
  proxyOptions?: ProxyOptions
): Promise<void> {
  const [chapter, asset] = await Promise.all([
    getChapter(chapterId),
    getAsset(assetId),
  ]);

  if (!chapter || !asset) {
    return;
  }

  if (!asset.file_path || !(await pathExists(asset.file_path))) {
    console.warn(`[ChapterPrewarm] Asset file missing for chapter=${chapterId} asset=${assetId}`);
    return;
  }

  const chapterAssetIds = await getAssetsForChapter(chapter.id);
  if (!chapterAssetIds.includes(asset.id)) {
    return;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);
  if (asset.file_type === 'video') {
    try {
      await ensureChapterProxyReady(
        chapter,
        asset,
        normalizedProxyOptions.encodingMode,
        normalizedProxyOptions.quality,
        'background'
      );
    } catch (error) {
      console.warn(`[ChapterPrewarm] Failed chapter proxy chapter=${chapter.id} asset=${asset.id}:`, error);
    }
  }

  try {
    await ensureAssetMixWaveformReady(asset);
  } catch (error) {
    console.warn(`[ChapterPrewarm] Failed waveform chapter=${chapter.id} asset=${asset.id}:`, error);
  }
}

export function scheduleChapterMediaPrewarm(
  chapterId: number,
  assetId: number,
  proxyOptions?: ProxyOptions
): Promise<void> {
  const lockKey = `${chapterId}:${assetId}`;
  const inFlight = chapterMediaPrewarmLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = enqueueChapterMediaPrewarm(async () => {
    await prewarmChapterMedia(chapterId, assetId, proxyOptions);
  });

  chapterMediaPrewarmLocks.set(lockKey, task);
  return task.finally(() => {
    chapterMediaPrewarmLocks.delete(lockKey);
  });
}
