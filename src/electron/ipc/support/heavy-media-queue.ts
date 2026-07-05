import * as os from 'node:os';

type HeavyMediaJobType = 'chapterProxy' | 'transcription' | 'reverseQuickWarm' | 'reverseFullWarm';
export type HeavyMediaJobPriority = 'background' | 'interactive';

type HeavyMediaJob<T> = {
  key: string;
  type: HeavyMediaJobType;
  priority: HeavyMediaJobPriority;
  started: boolean;
  sequence: number;
  run: (signal: AbortSignal) => Promise<T>;
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  controller: AbortController;
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

const chapterMediaPrewarmQueue: Array<() => Promise<void>> = [];
const CHAPTER_MEDIA_PREWARM_MAX_CONCURRENCY = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2)));
let activeChapterMediaPrewarmJobs = 0;
const HEAVY_MEDIA_MAX_CONCURRENCY = 1;
const heavyMediaQueue: Array<HeavyMediaJob<unknown>> = [];
const heavyMediaJobs = new Map<string, HeavyMediaJob<unknown>>();
let activeHeavyMediaJobs = 0;
let heavyMediaJobSequence = 0;

export function getGenerationEpoch(epochMap: Map<string, number>, lockKey: string): number {
  return epochMap.get(lockKey) ?? 0;
}

export function bumpGenerationEpoch(epochMap: Map<string, number>, lockKey: string): number {
  const nextEpoch = getGenerationEpoch(epochMap, lockKey) + 1;
  epochMap.set(lockKey, nextEpoch);
  return nextEpoch;
}

function getHeavyMediaPriorityRank(priority: HeavyMediaJobPriority): number {
  return priority === 'interactive' ? 0 : 1;
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

function pumpHeavyMediaQueue(): void {
  while (activeHeavyMediaJobs < HEAVY_MEDIA_MAX_CONCURRENCY && heavyMediaQueue.length > 0) {
    sortHeavyMediaQueue();
    const nextJob = heavyMediaQueue.shift();
    if (!nextJob) {
      continue;
    }

    nextJob.started = true;
    activeHeavyMediaJobs += 1;

    void nextJob.run(nextJob.controller.signal)
      .then((value) => {
        nextJob.resolve(value);
      })
      .catch((error) => {
        console.warn(`[HeavyMedia] Job failed type=${nextJob.type} key=${nextJob.key}:`, error);
        nextJob.reject(error);
      })
      .finally(() => {
        activeHeavyMediaJobs = Math.max(0, activeHeavyMediaJobs - 1);
        heavyMediaJobs.delete(nextJob.key);
        pumpHeavyMediaQueue();
      });
  }
}

export function enqueueHeavyMediaJob<T>(
  key: string,
  type: HeavyMediaJobType,
  priority: HeavyMediaJobPriority,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const existing = heavyMediaJobs.get(key) as HeavyMediaJob<T> | undefined;
  if (existing) {
    if (!existing.started && getHeavyMediaPriorityRank(priority) < getHeavyMediaPriorityRank(existing.priority)) {
      existing.priority = priority;
      sortHeavyMediaQueue();
    }
    return existing.promise;
  }

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
    started: false,
    sequence: heavyMediaJobSequence++,
    run,
    promise,
    resolve,
    reject,
    controller: new AbortController(),
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
    return true;
  }

  job.controller.abort();
  return true;
}

function getTranscriptionJobKey(chapterId: number): string {
  return `transcription:${chapterId}`;
}

export function buildTranscriptionJobKey(chapterId: number): string {
  return getTranscriptionJobKey(chapterId);
}

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
