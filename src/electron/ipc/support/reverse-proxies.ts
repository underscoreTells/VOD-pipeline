import * as fs from 'node:fs';
import {
  getChapter,
  getChapterProxyByChapterAsset,
} from '../../database/index.js';
import type { Asset } from '../../../shared/types/database.js';
import type { ProxyOptions } from '../../../shared/contracts/electron-api.js';
import {
  ensureProxyDirectory,
  getChapterReverseProxyPath,
  getChapterReverseProxyTempPath,
  getChapterReverseProxyUrl,
  type ReverseProxyVariant,
} from '../../paths.js';
import {
  generateChapterReverseProxy,
  getVideoMetadata,
} from '../../../pipeline/ffmpeg.js';
import {
  bumpGenerationEpoch,
  enqueueHeavyMediaJob,
  getGenerationEpoch,
  promoteHeavyMediaJob,
  type HeavyMediaJobPriority,
} from './heavy-media-queue.js';
import {
  deleteFileIfExists,
  getReusableChapterProxy,
  recoverChapterProxyIfCurrent,
} from './chapter-proxies.js';
import { normalizeProxyOptions } from './payload.js';

type ChapterReverseProxyStatusPayload = {
  status: 'missing' | 'generating' | 'ready' | 'error';
  url?: string;
  quality?: ReverseProxyVariant;
  isFinal?: boolean;
  error?: string;
};

type ReverseProxyExecutionMode = 'background' | 'interactive';

const chapterReverseProxyGenerationLocks = new Map<string, { epoch: number; promise: Promise<string | undefined> }>();
const chapterReverseProxyQuickGenerationLocks = new Map<string, { epoch: number; promise: Promise<string | undefined> }>();
const chapterReverseProxyBackgroundTimers = new Map<string, NodeJS.Timeout>();
const chapterReverseProxyErrors = new Map<string, string>();
const chapterReverseProxyValidationCache = new Map<string, { mtimeMs: number; size: number; valid: boolean }>();
const chapterReverseProxyGenerationEpochs = new Map<string, number>();
const reverseQuickExecutionModes = new Map<string, ReverseProxyExecutionMode>();

function getReverseValidationCacheKey(chapterId: number, assetId: number, variant: ReverseProxyVariant): string {
  return `${chapterId}:${assetId}:${variant}`;
}

function getReverseQuickJobKey(chapterId: number, assetId: number): string {
  return `reverseQuickWarm:${chapterId}:${assetId}`;
}

function getReverseFullJobKey(chapterId: number, assetId: number): string {
  return `reverseFullWarm:${chapterId}:${assetId}`;
}

async function isChapterReverseProxyPlayable(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full'
): Promise<boolean> {
  const cacheKey = getReverseValidationCacheKey(chapterId, assetId, variant);
  const proxyPath = getChapterReverseProxyPath(chapterId, assetId, variant);
  if (!fs.existsSync(proxyPath)) {
    chapterReverseProxyValidationCache.delete(cacheKey);
    return false;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(proxyPath);
  } catch {
    chapterReverseProxyValidationCache.delete(cacheKey);
    return false;
  }

  const cached = chapterReverseProxyValidationCache.get(cacheKey);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.valid;
  }

  let valid = false;
  try {
    const metadata = await getVideoMetadata(proxyPath, 5000);
    valid = Number.isFinite(metadata.duration) && metadata.duration > 0.01;
  } catch {
    valid = false;
  }

  chapterReverseProxyValidationCache.set(cacheKey, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    valid,
  });
  return valid;
}

function invalidateChapterReverseProxyVariant(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant
): void {
  const cacheKey = getReverseValidationCacheKey(chapterId, assetId, variant);
  const proxyPath = getChapterReverseProxyPath(chapterId, assetId, variant);
  const tempPath = getChapterReverseProxyTempPath(chapterId, assetId, variant);
  const legacyTempPath = `${proxyPath}.partial`;
  chapterReverseProxyValidationCache.delete(cacheKey);

  if (fs.existsSync(proxyPath)) {
    try {
      fs.unlinkSync(proxyPath);
    } catch (error) {
      console.warn(
        `[ReverseProxy] Failed deleting ${variant} cache chapter=${chapterId} asset=${assetId}:`,
        error
      );
    }
  }

  if (fs.existsSync(tempPath)) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore stale partial cleanup errors.
    }
  }

  if (variant === 'full' && fs.existsSync(legacyTempPath)) {
    try {
      fs.unlinkSync(legacyTempPath);
    } catch {
      // Ignore stale legacy partial cleanup errors.
    }
  }
}

async function ensureChapterReverseProxyCacheValid(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full'
): Promise<boolean> {
  const proxyPath = getChapterReverseProxyPath(chapterId, assetId, variant);
  if (!fs.existsSync(proxyPath)) {
    return false;
  }

  const isPlayable = await isChapterReverseProxyPlayable(chapterId, assetId, variant);
  if (isPlayable) {
    return true;
  }

  console.warn(
    `[ReverseProxy] Invalid cached ${variant} reverse preview detected, rebuilding chapter=${chapterId} asset=${assetId}`
  );
  invalidateChapterReverseProxyVariant(chapterId, assetId, variant);
  return false;
}

function clearChapterReverseProxyBackgroundTimer(lockKey: string): void {
  const timer = chapterReverseProxyBackgroundTimers.get(lockKey);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  chapterReverseProxyBackgroundTimers.delete(lockKey);
}

export function scheduleChapterReverseProxyFullWarm(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  proxyOptions?: ProxyOptions,
  delayMs = 12000
): void {
  if (asset.file_type !== 'video') {
    return;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const currentEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  const inFlight = chapterReverseProxyGenerationLocks.get(lockKey);
  if (
    (inFlight && inFlight.epoch === currentEpoch)
    || chapterReverseProxyBackgroundTimers.has(lockKey)
  ) {
    return;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);

  const timer = setTimeout(() => {
    chapterReverseProxyBackgroundTimers.delete(lockKey);
    void ensureChapterReverseProxyFullReady(
      chapter,
      asset,
      normalizedProxyOptions,
      'background'
    ).catch((error) => {
      console.warn(
        `[ReverseProxy] Failed background full warm chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
    });
  }, Math.max(0, delayMs));

  chapterReverseProxyBackgroundTimers.set(lockKey, timer);
}

export async function getChapterReverseProxyStatus(chapterId: number, assetId: number): Promise<ChapterReverseProxyStatusPayload> {
  const lockKey = `${chapterId}:${assetId}`;
  const currentEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);

  if (await ensureChapterReverseProxyCacheValid(chapterId, assetId, 'full')) {
    chapterReverseProxyErrors.delete(lockKey);
    return {
      status: 'ready',
      url: getChapterReverseProxyUrl(chapterId, assetId, 'full'),
      quality: 'full',
      isFinal: true,
    };
  }

  if (await ensureChapterReverseProxyCacheValid(chapterId, assetId, 'quick')) {
    chapterReverseProxyErrors.delete(lockKey);
    return {
      status: 'ready',
      url: getChapterReverseProxyUrl(chapterId, assetId, 'quick'),
      quality: 'quick',
      isFinal: false,
    };
  }

  const quickLock = chapterReverseProxyQuickGenerationLocks.get(lockKey);
  const fullLock = chapterReverseProxyGenerationLocks.get(lockKey);
  if (
    (quickLock && quickLock.epoch === currentEpoch)
    || (fullLock && fullLock.epoch === currentEpoch)
  ) {
    return { status: 'generating' };
  }

  const error = chapterReverseProxyErrors.get(lockKey);
  if (error) {
    return {
      status: 'error',
      error,
    };
  }

  return { status: 'missing' };
}

export function invalidateChapterReverseProxy(chapterId: number, assetId: number): void {
  const lockKey = `${chapterId}:${assetId}`;
  bumpGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  chapterReverseProxyErrors.delete(lockKey);
  reverseQuickExecutionModes.delete(lockKey);
  clearChapterReverseProxyBackgroundTimer(lockKey);
  invalidateChapterReverseProxyVariant(chapterId, assetId, 'full');
  invalidateChapterReverseProxyVariant(chapterId, assetId, 'quick');
}

export async function ensureChapterReverseProxyQuickReady(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  proxyOptions?: ProxyOptions,
  options: {
    priority?: HeavyMediaJobPriority;
    executionMode?: ReverseProxyExecutionMode;
  } = {}
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const jobKey = getReverseQuickJobKey(chapter.id, asset.id);
  const queuePriority = options.priority ?? 'background';
  const requestedExecutionMode = options.executionMode ?? 'background';
  const currentExecutionMode = reverseQuickExecutionModes.get(lockKey) ?? 'background';
  const nextExecutionMode =
    requestedExecutionMode === 'interactive' || currentExecutionMode === 'interactive'
      ? 'interactive'
      : 'background';
  reverseQuickExecutionModes.set(lockKey, nextExecutionMode);
  if (queuePriority === 'interactive') {
    promoteHeavyMediaJob(jobKey);
  }

  const generationEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  const inFlight = chapterReverseProxyQuickGenerationLocks.get(lockKey);
  if (inFlight && inFlight.epoch === generationEpoch) {
    return inFlight.promise;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);

  const task = (async () => {
    const fullProxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'full');
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
      chapterReverseProxyErrors.delete(lockKey);
      return fullProxyPath;
    }

    const quickProxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'quick');
    const quickTempPath = getChapterReverseProxyTempPath(chapter.id, asset.id, 'quick', generationEpoch);
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'quick')) {
      chapterReverseProxyErrors.delete(lockKey);
      return quickProxyPath;
    }

    try {
      await enqueueHeavyMediaJob(jobKey, 'reverseQuickWarm', queuePriority, async () => {
        if (fs.existsSync(quickTempPath)) {
          try {
            fs.unlinkSync(quickTempPath);
          } catch {
            // Ignore stale temp cleanup errors.
          }
        }

        let inputPath = asset.file_path;
        let inputStartTime = chapter.start_time;
        let inputEndTime = chapter.end_time;
        let fps = 10;

        let chapterProxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
        chapterProxy = await recoverChapterProxyIfCurrent(chapterProxy, chapter);
        const reusableChapterProxy = getReusableChapterProxy(chapterProxy, chapter);
        if (reusableChapterProxy) {
          try {
            const chapterProxyMetadata = await getVideoMetadata(reusableChapterProxy.file_path, 5000);
            if (chapterProxyMetadata.duration > 0.1) {
              const chapterDuration = Math.max(0.1, chapter.end_time - chapter.start_time);
              inputPath = reusableChapterProxy.file_path;
              inputStartTime = 0;
              inputEndTime = Math.min(chapterProxyMetadata.duration, chapterDuration);
              fps = Math.max(5, Math.min(10, Math.round(chapterProxyMetadata.fps) || 5));
            }
          } catch {
            // Fallback to source media if chapter proxy metadata lookup fails.
          }
        }

        const executionMode = reverseQuickExecutionModes.get(lockKey) ?? requestedExecutionMode;
        ensureProxyDirectory();
        await generateChapterReverseProxy(inputPath, quickTempPath, {
          startTime: inputStartTime,
          endTime: inputEndTime,
          fps,
          encodingMode: normalizedProxyOptions.encodingMode,
          quality: normalizedProxyOptions.quality,
          chunkDurationSec: 45,
          maxParallelChunks: executionMode === 'interactive' ? 2 : 1,
          executionMode,
        });
      });

      if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) !== generationEpoch) {
        deleteFileIfExists(quickTempPath, 'ReverseProxy');
        return undefined;
      }

      if (fs.existsSync(quickProxyPath)) {
        fs.unlinkSync(quickProxyPath);
      }

      fs.renameSync(quickTempPath, quickProxyPath);

      if (!(await isChapterReverseProxyPlayable(chapter.id, asset.id, 'quick'))) {
        throw new Error('Generated quick reverse preview is not playable');
      }

      chapterReverseProxyErrors.delete(lockKey);
      return quickProxyPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deleteFileIfExists(quickTempPath, 'ReverseProxy');
      if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) === generationEpoch) {
        invalidateChapterReverseProxyVariant(chapter.id, asset.id, 'quick');
        chapterReverseProxyErrors.set(lockKey, message);
      }
      console.warn(
        `[ReverseProxy] Failed generating quick reverse chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }
  })();

  chapterReverseProxyQuickGenerationLocks.set(lockKey, { epoch: generationEpoch, promise: task });
  try {
    return await task;
  } finally {
    const currentLock = chapterReverseProxyQuickGenerationLocks.get(lockKey);
    if (currentLock?.promise === task) {
      chapterReverseProxyQuickGenerationLocks.delete(lockKey);
    }
    reverseQuickExecutionModes.delete(lockKey);
  }
}

async function ensureChapterReverseProxyFullReady(
  chapter: NonNullable<Awaited<ReturnType<typeof getChapter>>>,
  asset: Asset,
  proxyOptions?: ProxyOptions,
  priority: HeavyMediaJobPriority = 'background'
): Promise<string | undefined> {
  if (asset.file_type !== 'video') {
    return undefined;
  }

  const lockKey = `${chapter.id}:${asset.id}`;
  const jobKey = getReverseFullJobKey(chapter.id, asset.id);
  clearChapterReverseProxyBackgroundTimer(lockKey);

  const generationEpoch = getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey);
  const inFlight = chapterReverseProxyGenerationLocks.get(lockKey);
  if (inFlight && inFlight.epoch === generationEpoch) {
    if (priority === 'interactive') {
      promoteHeavyMediaJob(jobKey);
    }
    return inFlight.promise;
  }

  const normalizedProxyOptions = normalizeProxyOptions(proxyOptions);

  const task = (async () => {
    const proxyPath = getChapterReverseProxyPath(chapter.id, asset.id, 'full');
    const tempPath = getChapterReverseProxyTempPath(chapter.id, asset.id, 'full', generationEpoch);
    if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
      chapterReverseProxyErrors.delete(lockKey);
      return proxyPath;
    }

    let generatedPath: string | undefined;

    try {
      await enqueueHeavyMediaJob(jobKey, 'reverseFullWarm', priority, async () => {
        if (await ensureChapterReverseProxyCacheValid(chapter.id, asset.id, 'full')) {
          generatedPath = proxyPath;
          chapterReverseProxyErrors.delete(lockKey);
          return;
        }

        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // Ignore stale temp cleanup errors.
          }
        }

        ensureProxyDirectory();
        await generateChapterReverseProxy(asset.file_path, tempPath, {
          startTime: chapter.start_time,
          endTime: chapter.end_time,
          fps: 15,
          encodingMode: normalizedProxyOptions.encodingMode,
          quality: normalizedProxyOptions.quality,
          chunkDurationSec: 11,
          maxParallelChunks: 1,
          executionMode: 'background',
        });

        if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) !== generationEpoch) {
          deleteFileIfExists(tempPath, 'ReverseProxy');
          return;
        }

        if (fs.existsSync(proxyPath)) {
          fs.unlinkSync(proxyPath);
        }

        fs.renameSync(tempPath, proxyPath);

        if (!(await isChapterReverseProxyPlayable(chapter.id, asset.id, 'full'))) {
          throw new Error('Generated reverse preview is not playable');
        }

        generatedPath = proxyPath;
        chapterReverseProxyErrors.delete(lockKey);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deleteFileIfExists(tempPath, 'ReverseProxy');
      if (getGenerationEpoch(chapterReverseProxyGenerationEpochs, lockKey) === generationEpoch) {
        invalidateChapterReverseProxyVariant(chapter.id, asset.id, 'full');
        chapterReverseProxyErrors.set(lockKey, message);
      }
      console.warn(
        `[ReverseProxy] Failed generating chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
      return undefined;
    }

    return generatedPath;
  })();

  chapterReverseProxyGenerationLocks.set(lockKey, { epoch: generationEpoch, promise: task });
  try {
    return await task;
  } finally {
    const currentLock = chapterReverseProxyGenerationLocks.get(lockKey);
    if (currentLock?.promise === task) {
      chapterReverseProxyGenerationLocks.delete(lockKey);
    }
  }
}
