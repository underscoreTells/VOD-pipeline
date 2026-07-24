import * as os from 'node:os';

import { getDefaultCpuProxyLimit } from '../../media-resource-limits.js';

export type HeavyMediaJobType =
  | 'chapterProxy'
  | 'transcription'
  | 'reverseQuickWarm'
  | 'reverseFullWarm'
  | 'waveformBlock';
export type HeavyMediaJobPriority = 'background' | 'interactive';
export type HeavyMediaResourceClass = 'cpu' | 'gpu';
export type HeavyMediaResourcePool = 'cpuProxy' | 'gpuProxy' | 'transcription';

export interface HeavyMediaEnqueueOptions<T = unknown> {
  /**
   * Hardware resource class the job targets. Media-generating jobs are routed
   * to the matching proxy/media pool (`cpuProxy` or `gpuProxy`). `transcription` jobs use
   * the dedicated transcription pool and ignore this value.
   *
   * Defaults to `'cpu'` for backward compatibility with existing callers that
   * do not pass options; the orchestrator may pass `'gpu'` for GPU-encoded
   * proxy/reverse jobs.
   */
  resourceClass?: HeavyMediaResourceClass;
  cpuFallback?: {
    shouldFallback: (error: unknown) => boolean;
    run: (signal: AbortSignal) => Promise<T>;
  };
}

export interface HeavyMediaSchedulerLimits {
  readonly cpuProxy: number;
  readonly gpuProxy: number;
  readonly transcription: number;
  readonly fullReverse: number;
  readonly interactiveOverflow: number;
}

export type HeavyMediaSchedulerLimitsInput = Partial<HeavyMediaSchedulerLimits>;

type HeavyMediaJob<T> = {
  key: string;
  type: HeavyMediaJobType;
  priority: HeavyMediaJobPriority;
  resourceClass: HeavyMediaResourceClass;
  pool: HeavyMediaResourcePool;
  usesFullReverseSlot: boolean;
  inOverflow: boolean;
  started: boolean;
  sequence: number;
  queuedAt: number;
  schedulerEpoch: number;
  run: (signal: AbortSignal) => Promise<T>;
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  controller: AbortController;
  cpuFallback: HeavyMediaEnqueueOptions<T>['cpuFallback'];
  runAttempt: number;
};

export class HeavyMediaCancellationError extends Error {
  constructor(message = 'Heavy media job cancelled') {
    super(message);
    this.name = 'HeavyMediaCancellationError';
  }
}

export function isCancellationError(error: unknown): boolean {
  return error instanceof Error && /cancelled/i.test(error.message);
}

type MutableHeavyMediaSchedulerLimits = {
  cpuProxy: number;
  gpuProxy: number;
  transcription: number;
  fullReverse: number;
  interactiveOverflow: number;
};

const heavyMediaSchedulerLimits: MutableHeavyMediaSchedulerLimits = {
  cpuProxy: getDefaultCpuProxyLimit(),
  gpuProxy: 1,
  transcription: 1,
  fullReverse: 1,
  interactiveOverflow: 1,
};

export function getHeavyMediaSchedulerLimits(): HeavyMediaSchedulerLimits {
  return { ...heavyMediaSchedulerLimits };
}

export function configureHeavyMediaScheduler(limits: HeavyMediaSchedulerLimitsInput): void {
  if (limits.cpuProxy !== undefined) heavyMediaSchedulerLimits.cpuProxy = Math.max(1, Math.floor(limits.cpuProxy));
  if (limits.gpuProxy !== undefined) heavyMediaSchedulerLimits.gpuProxy = Math.max(1, Math.floor(limits.gpuProxy));
  if (limits.transcription !== undefined) {
    heavyMediaSchedulerLimits.transcription = Math.max(1, Math.floor(limits.transcription));
  }
  if (limits.fullReverse !== undefined) {
    heavyMediaSchedulerLimits.fullReverse = Math.max(1, Math.floor(limits.fullReverse));
  }
  if (limits.interactiveOverflow !== undefined) {
    heavyMediaSchedulerLimits.interactiveOverflow = Math.max(
      0,
      Math.floor(limits.interactiveOverflow)
    );
  }
  pumpHeavyMediaQueue();
}

function applyDefaultHeavyMediaSchedulerLimits(): void {
  heavyMediaSchedulerLimits.cpuProxy = getDefaultCpuProxyLimit();
  heavyMediaSchedulerLimits.gpuProxy = 1;
  heavyMediaSchedulerLimits.transcription = 1;
  heavyMediaSchedulerLimits.fullReverse = 1;
  heavyMediaSchedulerLimits.interactiveOverflow = 1;
}

export function getGenerationEpoch(epochMap: Map<string, number>, lockKey: string): number {
  return epochMap.get(lockKey) ?? 0;
}

export function bumpGenerationEpoch(epochMap: Map<string, number>, lockKey: string): number {
  const nextEpoch = getGenerationEpoch(epochMap, lockKey) + 1;
  epochMap.set(lockKey, nextEpoch);
  return nextEpoch;
}

const heavyMediaQueue: Array<HeavyMediaJob<unknown>> = [];
const heavyMediaJobs = new Map<string, HeavyMediaJob<unknown>>();
let activeCpuProxy = 0;
let activeGpuProxy = 0;
let activeTranscription = 0;
let activeFullReverse = 0;
let activeCpuProxyInteractiveOverflow = 0;
let activeGpuProxyInteractiveOverflow = 0;
let heavyMediaJobSequence = 0;
let heavyMediaSchedulerEpoch = 0;

function getHeavyMediaPriorityRank(priority: HeavyMediaJobPriority): number {
  return priority === 'interactive' ? 0 : 1;
}

function resolveHeavyMediaPool(
  type: HeavyMediaJobType,
  resourceClass: HeavyMediaResourceClass
): HeavyMediaResourcePool {
  if (type === 'transcription') {
    return 'transcription';
  }
  return resourceClass === 'gpu' ? 'gpuProxy' : 'cpuProxy';
}

function sortHeavyMediaQueue(): void {
  heavyMediaQueue.sort((left, right) => {
    const priorityDelta = getHeavyMediaPriorityRank(left.priority) - getHeavyMediaPriorityRank(right.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.sequence - right.sequence;
  });
}

/**
 * Attempt to reserve execution capacity for a job.
 *
 * Proxy pools share a base concurrency limit. One interactive proxy job may
 * exceed that base limit per pool (the "overflow" slot); background jobs may
 * never use it. `reverseFullWarm` additionally requires the single
 * full-reverse sub-slot, on top of its proxy-pool slot.
 *
 * Returns `true` (and mutates the bookkeeping + job flags) only when the job
 * may run now; otherwise leaves all counters untouched so the job remains
 * queued.
 */
function tryAcquireHeavyMediaSlot(job: HeavyMediaJob<unknown>): boolean {
  if (job.usesFullReverseSlot && activeFullReverse >= heavyMediaSchedulerLimits.fullReverse) {
    return false;
  }

  if (job.pool === 'transcription') {
    // Whisper and software proxy encoding are both CPU-saturating workloads.
    if (
      activeTranscription >= heavyMediaSchedulerLimits.transcription
      || activeCpuProxy > 0
    ) {
      return false;
    }
    activeTranscription += 1;
    job.inOverflow = false;
    job.started = true;
    return true;
  }

  const isCpu = job.pool === 'cpuProxy';
  if (isCpu) {
    // Whisper and software proxy encoding are both CPU-saturating workloads,
    // so an active transcription excludes all CPU proxy work. A waiting
    // transcription reserves freed CPU slots only against same-or-lower
    // priority proxy jobs; an interactive proxy may jump ahead of a queued
    // background transcription.
    if (activeTranscription > 0) {
      return false;
    }
    const jobPriorityRank = getHeavyMediaPriorityRank(job.priority);
    const blockedByWaitingTranscription = heavyMediaQueue.some(
      (queuedJob) =>
        queuedJob.pool === 'transcription'
        && getHeavyMediaPriorityRank(queuedJob.priority) <= jobPriorityRank
    );
    if (blockedByWaitingTranscription) {
      return false;
    }
  }
  const active = isCpu ? activeCpuProxy : activeGpuProxy;
  const limit = isCpu ? heavyMediaSchedulerLimits.cpuProxy : heavyMediaSchedulerLimits.gpuProxy;
  const overflow = isCpu ? activeCpuProxyInteractiveOverflow : activeGpuProxyInteractiveOverflow;
  const baseUsed = active - overflow;

  if (baseUsed < limit) {
    if (isCpu) activeCpuProxy += 1;
    else activeGpuProxy += 1;
    job.inOverflow = false;
    job.started = true;
    if (job.usesFullReverseSlot) activeFullReverse += 1;
    return true;
  }

  if (job.priority === 'interactive' && overflow < heavyMediaSchedulerLimits.interactiveOverflow) {
    if (isCpu) {
      activeCpuProxy += 1;
      activeCpuProxyInteractiveOverflow += 1;
    } else {
      activeGpuProxy += 1;
      activeGpuProxyInteractiveOverflow += 1;
    }
    job.inOverflow = true;
    job.started = true;
    if (job.usesFullReverseSlot) activeFullReverse += 1;
    return true;
  }

  return false;
}

function releaseHeavyMediaSlot(job: HeavyMediaJob<unknown>): void {
  if (job.pool === 'transcription') {
    activeTranscription = Math.max(0, activeTranscription - 1);
    return;
  }

  const isCpu = job.pool === 'cpuProxy';
  if (isCpu) activeCpuProxy = Math.max(0, activeCpuProxy - 1);
  else activeGpuProxy = Math.max(0, activeGpuProxy - 1);

  if (job.inOverflow) {
    if (isCpu) activeCpuProxyInteractiveOverflow = Math.max(0, activeCpuProxyInteractiveOverflow - 1);
    else activeGpuProxyInteractiveOverflow = Math.max(0, activeGpuProxyInteractiveOverflow - 1);
  }

  if (job.usesFullReverseSlot) {
    activeFullReverse = Math.max(0, activeFullReverse - 1);
  }
}

function runHeavyMediaJob(job: HeavyMediaJob<unknown>): void {
  const queueWaitMs = performance.now() - job.queuedAt;
  const runAttempt = job.runAttempt;
  console.log(
    `[HeavyMedia] Starting type=${job.type} key=${job.key} pool=${job.pool} queueWait=${queueWaitMs.toFixed(0)}ms`
  );
  void job
    .run(job.controller.signal)
    .then((value) => {
      job.resolve(value);
    })
    .catch((error) => {
      if (
        job.pool === 'gpuProxy'
        && job.cpuFallback?.shouldFallback(error)
        && job.schedulerEpoch === heavyMediaSchedulerEpoch
      ) {
        console.warn(`[HeavyMedia] Requeueing GPU fallback on CPU type=${job.type} key=${job.key}`);
        releaseHeavyMediaSlot(job);
        job.resourceClass = 'cpu';
        job.pool = 'cpuProxy';
        job.inOverflow = false;
        job.started = false;
        job.sequence = heavyMediaJobSequence++;
        job.queuedAt = performance.now();
        job.run = job.cpuFallback.run;
        job.cpuFallback = undefined;
        job.runAttempt += 1;
        heavyMediaQueue.push(job);
        pumpHeavyMediaQueue();
        return;
      }
      console.warn(`[HeavyMedia] Job failed type=${job.type} key=${job.key}:`, error);
      job.reject(error);
    })
    .finally(() => {
      if (job.schedulerEpoch !== heavyMediaSchedulerEpoch) {
        return;
      }
      if (job.runAttempt !== runAttempt) {
        return;
      }
      releaseHeavyMediaSlot(job);
      if (heavyMediaJobs.get(job.key) === job) {
        heavyMediaJobs.delete(job.key);
      }
      pumpHeavyMediaQueue();
    });
}

function pumpHeavyMediaQueue(): void {
  sortHeavyMediaQueue();
  // Single front-to-back pass: higher-priority (and older, within a priority)
  // jobs get first dibs on capacity. Starting a job only consumes capacity, so
  // one pass is sufficient; we skip jobs whose pool/sub-slot is saturated and
  // keep scanning so an independent pool (or the interactive overflow) can
  // still make progress behind a blocked job.
  for (let i = 0; i < heavyMediaQueue.length; ) {
    const job = heavyMediaQueue[i];
    if (tryAcquireHeavyMediaSlot(job)) {
      heavyMediaQueue.splice(i, 1);
      runHeavyMediaJob(job);
      // The next queued job shifts into index `i`; do not advance.
    } else {
      i += 1;
    }
  }
}

export function enqueueHeavyMediaJob<T>(
  key: string,
  type: HeavyMediaJobType,
  priority: HeavyMediaJobPriority,
  run: (signal: AbortSignal) => Promise<T>,
  options?: HeavyMediaEnqueueOptions<T>
): Promise<T> {
  const existing = heavyMediaJobs.get(key) as HeavyMediaJob<T> | undefined;
  if (existing) {
    if (!existing.started && getHeavyMediaPriorityRank(priority) < getHeavyMediaPriorityRank(existing.priority)) {
      existing.priority = priority;
      sortHeavyMediaQueue();
      pumpHeavyMediaQueue();
    }
    return existing.promise;
  }

  const resourceClass: HeavyMediaResourceClass = options?.resourceClass === 'gpu' ? 'gpu' : 'cpu';
  const pool = resolveHeavyMediaPool(type, resourceClass);
  const usesFullReverseSlot = type === 'reverseFullWarm';

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  const job: HeavyMediaJob<T> = {
    key,
    type,
    priority,
    resourceClass,
    pool,
    usesFullReverseSlot,
    inOverflow: false,
    started: false,
    sequence: heavyMediaJobSequence++,
    queuedAt: performance.now(),
    schedulerEpoch: heavyMediaSchedulerEpoch,
    run,
    promise,
    resolve,
    reject,
    controller: new AbortController(),
    cpuFallback: options?.cpuFallback,
    runAttempt: 0,
  };

  heavyMediaJobs.set(key, job as HeavyMediaJob<unknown>);
  heavyMediaQueue.push(job as HeavyMediaJob<unknown>);
  sortHeavyMediaQueue();
  pumpHeavyMediaQueue();
  return promise;
}

export function promoteHeavyMediaJob(key: string): void {
  const existing = heavyMediaJobs.get(key);
  if (!existing || existing.started) {
    return;
  }

  if (existing.priority !== 'interactive') {
    existing.priority = 'interactive';
    sortHeavyMediaQueue();
    pumpHeavyMediaQueue();
  }
}

/**
 * Cancel a heavy media job by key.
 *
 * - If the job is queued but not started, it is removed from the queue and its
 *   promise rejects with a {@link HeavyMediaCancellationError}.
 * - If the job is running, its AbortController is aborted; the underlying
 *   pipeline work is expected to observe the signal, kill its child process,
 *   and reject with a cancellation error.
 * - Returns false when no job is registered for the key.
 */
export function cancelHeavyMediaJob(key: string): boolean {
  const job = heavyMediaJobs.get(key);
  if (!job) {
    return false;
  }

  if (!job.started) {
    const queueIndex = heavyMediaQueue.indexOf(job);
    if (queueIndex !== -1) {
      heavyMediaQueue.splice(queueIndex, 1);
    }
    heavyMediaJobs.delete(job.key);
    job.reject(new HeavyMediaCancellationError());
    pumpHeavyMediaQueue();
    return true;
  }

  job.controller.abort();
  return true;
}

/**
 * Reset all scheduler state to defaults. Aborts any running jobs (so their
 * cooperative run functions settle), clears the queue and registry, zeroes all
 * concurrency counters, and restores the default resource limits. Intended
 * for deterministic test isolation.
 */
export function resetHeavyMediaScheduler(): void {
  heavyMediaSchedulerEpoch += 1;
  for (const job of heavyMediaJobs.values()) {
    if (job.started) {
      try {
        job.controller.abort();
      } catch {
        // Ignore abort errors during teardown.
      }
    }
  }
  heavyMediaQueue.length = 0;
  heavyMediaJobs.clear();
  activeCpuProxy = 0;
  activeGpuProxy = 0;
  activeTranscription = 0;
  activeFullReverse = 0;
  activeCpuProxyInteractiveOverflow = 0;
  activeGpuProxyInteractiveOverflow = 0;
  heavyMediaJobSequence = 0;
  chapterMediaPrewarmQueue.length = 0;
  activeChapterMediaPrewarmJobs = 0;
  applyDefaultHeavyMediaSchedulerLimits();
}

function getTranscriptionJobKey(chapterId: number): string {
  return `transcription:${chapterId}`;
}

export function buildTranscriptionJobKey(chapterId: number): string {
  return getTranscriptionJobKey(chapterId);
}

const chapterMediaPrewarmQueue: Array<() => Promise<void>> = [];
const CHAPTER_MEDIA_PREWARM_MAX_CONCURRENCY = Math.max(
  1,
  Math.min(4, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2))
);
let activeChapterMediaPrewarmJobs = 0;

function pumpChapterMediaPrewarmQueue() {
  while (
    activeChapterMediaPrewarmJobs < CHAPTER_MEDIA_PREWARM_MAX_CONCURRENCY &&
    chapterMediaPrewarmQueue.length > 0
  ) {
    const nextJob = chapterMediaPrewarmQueue.shift();
    if (!nextJob) {
      continue;
    }

    activeChapterMediaPrewarmJobs += 1;
    void nextJob()
      .catch((error) => {
        console.warn('[ChapterPrewarm] Job failed:', error);
      })
      .finally(() => {
        activeChapterMediaPrewarmJobs = Math.max(0, activeChapterMediaPrewarmJobs - 1);
        pumpChapterMediaPrewarmQueue();
      });
  }
}

export function enqueueChapterMediaPrewarm(job: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    chapterMediaPrewarmQueue.push(async () => {
      try {
        await job();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    pumpChapterMediaPrewarmQueue();
  });
}

export function queueChapterTranscription<T>(
  chapterId: number,
  priority: HeavyMediaJobPriority,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  return enqueueHeavyMediaJob(getTranscriptionJobKey(chapterId), 'transcription', priority, run);
}
