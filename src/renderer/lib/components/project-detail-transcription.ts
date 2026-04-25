import type { TranscriptionBackendStatus, TranscriptionResult } from '../api/transcription.js';

type TranscriptionStatusResponse = {
  success: boolean;
  data?: TranscriptionBackendStatus;
  error?: string;
};

type GetTranscriptionStatus = (autoSetup?: boolean) => Promise<TranscriptionStatusResponse>;
type StartChapterTranscription = (
  chapterId: number,
  options?: Record<string, unknown>
) => Promise<TranscriptionResult>;
type SetTranscriptionError = (chapterId: number, message: string) => void;

interface TranscriptionDeps {
  getTranscriptionStatus: GetTranscriptionStatus;
  startChapterTranscription: StartChapterTranscription;
  setTranscriptionError: SetTranscriptionError;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function runChapterTranscription(
  chapterId: number,
  deps: Pick<TranscriptionDeps, 'startChapterTranscription' | 'setTranscriptionError'>,
  options?: Record<string, unknown>
): Promise<void> {
  try {
    const result = await deps.startChapterTranscription(chapterId, options);
    if (result.success) {
      return;
    }

    const message = result.error || 'Failed to start transcription';
    console.error('Failed to start transcription:', message);
    deps.setTranscriptionError(chapterId, message);
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to start transcription');
    console.error('Failed to start transcription:', error);
    deps.setTranscriptionError(chapterId, message);
  }
}

export async function checkTranscriptionAvailability(
  chapterIds: number[],
  deps: Pick<TranscriptionDeps, 'getTranscriptionStatus' | 'setTranscriptionError'>
): Promise<boolean> {
  const statusResponse = await deps.getTranscriptionStatus(true);
  if (statusResponse.success && statusResponse.data?.available) {
    return true;
  }

  const backendStatus = statusResponse.data;
  const message = backendStatus?.error
    || statusResponse.error
    || 'Transcription backend is unavailable (missing Python/pip/faster-whisper).';

  console.warn('[Transcription] Backend unavailable:', message);

  for (const chapterId of chapterIds) {
    deps.setTranscriptionError(chapterId, message);
  }

  return false;
}

export async function autoTranscribeChapters(
  chapterIds: number[],
  deps: TranscriptionDeps,
  options?: {
    skipIfExists?: boolean;
    awaitCompletion?: boolean;
    background?: boolean;
  }
): Promise<void> {
  if (chapterIds.length === 0) {
    return;
  }

  const transcriptionReady = await checkTranscriptionAvailability(chapterIds, deps);
  if (!transcriptionReady) {
    return;
  }

  const startOptions = {
    ...(options?.skipIfExists ? { skipIfExists: true } : {}),
    ...(options?.background ? { background: true } : {}),
  };
  if (options?.awaitCompletion) {
    for (const chapterId of chapterIds) {
      await runChapterTranscription(chapterId, deps, startOptions);
    }
    return;
  }

  for (const chapterId of chapterIds) {
    void runChapterTranscription(chapterId, deps, startOptions);
  }
}

export async function transcribeMissingChaptersOnReopen(
  chapterIds: number[],
  deps: TranscriptionDeps
): Promise<void> {
  await autoTranscribeChapters(chapterIds, deps, {
    skipIfExists: true,
    awaitCompletion: true,
    background: true,
  });
}
