import type { Clip } from '../../../shared/types/database';
import { suggestClipName } from '../api/clips.js';

const AUTO_NAME_RETRY_DELAY_MS = 2000;
const AUTO_NAME_FAILED_RETRY_DELAY_MS = 8000;

const pendingAutoNameClipIds = new Set<number>();
const failedAutoNameClipIds = new Set<number>();
const inFlightAutoNameClipIds = new Set<number>();

let isProcessingAutoNameQueue = false;
let lastAutoNameConfigSignature = '';
let autoNameRetryTimerId: ReturnType<typeof setTimeout> | null = null;
let contextProvider: (() => ClipAutoNameContext) | null = null;

interface ClipAutoNameSettings {
  autoClipNamingEnabled: boolean;
  autoClipNamingModel: string;
  openaiApiKey: string;
}

interface ClipAutoNameContext {
  projectId: number | null;
  settings: ClipAutoNameSettings;
  getClipById: (clipId: number) => Clip | undefined;
  resolveChapterForClip: (clip: Clip) => { id: number; title: string; start_time: number; end_time: number } | null;
  applyGeneratedDescription: (clipId: number, description: string) => Promise<boolean>;
}

export function configureClipAutoNameQueue(provider: () => ClipAutoNameContext): void {
  contextProvider = provider;
}

function normalizeGeneratedClipDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value
    .replace(/\s+/g, ' ')
    .replace(/^"+|"+$/g, '')
    .trim();
  if (trimmed.length < 3) return null;
  return trimmed.slice(0, 80);
}

export function hasClipDescription(clip: Pick<Clip, 'description'> | null | undefined): boolean {
  return typeof clip?.description === 'string' && clip.description.trim().length > 0;
}

function getAutoNameConfigSignature(settings: ClipAutoNameSettings): string {
  return [
    settings.autoClipNamingEnabled ? '1' : '0',
    settings.autoClipNamingModel,
    settings.openaiApiKey,
  ].join(':');
}

function clearAutoNameRetryTimer(): void {
  if (autoNameRetryTimerId === null) return;
  clearTimeout(autoNameRetryTimerId);
  autoNameRetryTimerId = null;
}

function scheduleAutoNameRetry(delayMs: number): void {
  if (autoNameRetryTimerId !== null || !contextProvider) {
    return;
  }

  autoNameRetryTimerId = setTimeout(() => {
    autoNameRetryTimerId = null;
    void processClipAutoNameQueue();
  }, delayMs);
}

type AutoNameClipResult = 'named' | 'deferred' | 'failed';

async function autoNameClipIfEnabled(clip: Clip, context: ClipAutoNameContext): Promise<AutoNameClipResult> {
  if (!context.settings.autoClipNamingEnabled) {
    return 'deferred';
  }

  if (hasClipDescription(clip)) {
    return 'named';
  }

  if (context.projectId !== null && clip.project_id !== context.projectId) {
    return 'deferred';
  }

  const apiKey = context.settings.openaiApiKey.trim();
  if (!apiKey) {
    return 'deferred';
  }

  const chapter = context.resolveChapterForClip(clip);
  if (!chapter) {
    return 'deferred';
  }

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const localIn = Math.max(0, Math.min(chapterDuration, clip.in_point - chapter.start_time));
  const localOutRaw = Math.max(localIn + 0.01, clip.out_point - chapter.start_time);
  const localOut = Math.min(chapterDuration, localOutRaw);
  if (localOut <= localIn) return 'failed';

  const model = (context.settings.autoClipNamingModel || 'gpt-5-nano').trim() || 'gpt-5-nano';

  try {
    const result = await suggestClipName({
      chapterId: chapter.id,
      inPoint: localIn,
      outPoint: localOut,
      model,
      apiKey,
      chapterTitle: chapter.title,
    });

    if (!result.success || !result.data?.name) {
      return 'failed';
    }

    const generatedDescription = normalizeGeneratedClipDescription(result.data.name);
    if (!generatedDescription) return 'failed';

    const updated = await context.applyGeneratedDescription(clip.id, generatedDescription);
    return updated ? 'named' : 'failed';
  } catch {
    return 'failed';
  }
}

export function enqueueClipAutoName(clipId: number): void {
  if (!Number.isInteger(clipId) || clipId <= 0) return;
  pendingAutoNameClipIds.add(clipId);
  failedAutoNameClipIds.delete(clipId);
}

export function enqueueUnnamedClips(clips: Clip[]): void {
  for (const clip of clips) {
    if (!hasClipDescription(clip)) {
      enqueueClipAutoName(clip.id);
    }
  }
}

function pruneAutoNameQueue(context: ClipAutoNameContext): void {
  for (const clipId of Array.from(pendingAutoNameClipIds)) {
    const clip = context.getClipById(clipId);
    if (!clip || hasClipDescription(clip)) {
      pendingAutoNameClipIds.delete(clipId);
      failedAutoNameClipIds.delete(clipId);
    }
  }

  for (const clipId of Array.from(failedAutoNameClipIds)) {
    const clip = context.getClipById(clipId);
    if (!clip || hasClipDescription(clip)) {
      failedAutoNameClipIds.delete(clipId);
    }
  }
}

export async function processClipAutoNameQueue(): Promise<void> {
  if (isProcessingAutoNameQueue || !contextProvider) return;

  const context = contextProvider();
  const configSignature = getAutoNameConfigSignature(context.settings);
  if (configSignature !== lastAutoNameConfigSignature) {
    failedAutoNameClipIds.clear();
    lastAutoNameConfigSignature = configSignature;
  }

  if (!context.settings.autoClipNamingEnabled) {
    pruneAutoNameQueue(context);
    if (pendingAutoNameClipIds.size > 0) {
      scheduleAutoNameRetry(AUTO_NAME_FAILED_RETRY_DELAY_MS);
    } else {
      clearAutoNameRetryTimer();
    }
    return;
  }

  isProcessingAutoNameQueue = true;
  const deferredThisPass = new Set<number>();

  try {
    while (true) {
      pruneAutoNameQueue(context);

      const nextClipId = Array.from(pendingAutoNameClipIds).find((clipId) => (
        !inFlightAutoNameClipIds.has(clipId) &&
        !failedAutoNameClipIds.has(clipId) &&
        !deferredThisPass.has(clipId)
      ));

      if (nextClipId === undefined) {
        break;
      }

      const clip = context.getClipById(nextClipId);
      if (!clip) {
        pendingAutoNameClipIds.delete(nextClipId);
        failedAutoNameClipIds.delete(nextClipId);
        continue;
      }

      inFlightAutoNameClipIds.add(nextClipId);
      let result: AutoNameClipResult = 'failed';
      try {
        result = await autoNameClipIfEnabled(clip, context);
      } finally {
        inFlightAutoNameClipIds.delete(nextClipId);
      }

      if (result === 'named') {
        pendingAutoNameClipIds.delete(nextClipId);
        failedAutoNameClipIds.delete(nextClipId);
        continue;
      }

      if (result === 'failed') {
        pendingAutoNameClipIds.delete(nextClipId);
        failedAutoNameClipIds.add(nextClipId);
        continue;
      }

      deferredThisPass.add(nextClipId);
    }
  } finally {
    isProcessingAutoNameQueue = false;
  }

  if (pendingAutoNameClipIds.size === 0) {
    clearAutoNameRetryTimer();
    return;
  }

  const hasRetryableClip = Array.from(pendingAutoNameClipIds).some(
    (clipId) => !failedAutoNameClipIds.has(clipId)
  );

  if (hasRetryableClip || deferredThisPass.size > 0) {
    scheduleAutoNameRetry(AUTO_NAME_RETRY_DELAY_MS);
  } else {
    scheduleAutoNameRetry(AUTO_NAME_FAILED_RETRY_DELAY_MS);
  }
}

export function resetClipAutoNameState(): void {
  pendingAutoNameClipIds.clear();
  failedAutoNameClipIds.clear();
  inFlightAutoNameClipIds.clear();
  isProcessingAutoNameQueue = false;
  lastAutoNameConfigSignature = '';
  clearAutoNameRetryTimer();
}
