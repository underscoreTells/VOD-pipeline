// Transcription state for tracking progress per chapter

interface TranscriptionProgress {
  status: 'idle' | 'running' | 'done' | 'error';
  percent: number;
  message: string;
}

export const transcriptionState = $state({
  byChapter: new Map<number, TranscriptionProgress>(),
});

export function setTranscriptionProgress(
  chapterId: number, 
  progress: { percent: number; status: string }
) {
  transcriptionState.byChapter.set(chapterId, {
    status: progress.percent >= 100 ? 'done' : 'running',
    percent: progress.percent,
    message: progress.status,
  });
  // Trigger reactivity by creating a new Map
  transcriptionState.byChapter = new Map(transcriptionState.byChapter);
}

export function setTranscriptionError(chapterId: number, message: string) {
  transcriptionState.byChapter.set(chapterId, {
    status: 'error',
    percent: 0,
    message,
  });
  transcriptionState.byChapter = new Map(transcriptionState.byChapter);
}

export function clearTranscriptionProgress(chapterId: number) {
  transcriptionState.byChapter.delete(chapterId);
  transcriptionState.byChapter = new Map(transcriptionState.byChapter);
}

export function getTranscriptionProgress(chapterId: number): TranscriptionProgress | undefined {
  return transcriptionState.byChapter.get(chapterId);
}

export function isTranscriptionRunning(chapterId: number): boolean {
  const progress = transcriptionState.byChapter.get(chapterId);
  return progress?.status === 'running';
}

export function isTranscriptionDone(chapterId: number): boolean {
  const progress = transcriptionState.byChapter.get(chapterId);
  return progress?.status === 'done';
}
