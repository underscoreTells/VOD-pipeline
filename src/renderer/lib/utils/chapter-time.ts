import type { Chapter } from '$shared/types/database';

export function getChapterDuration(chapter: Chapter | null): number {
  if (!chapter) return 0;
  return Math.max(0, chapter.end_time - chapter.start_time);
}

export function clampToChapter(chapter: Chapter | null, time: number): number {
  if (!chapter) return time;
  return Math.max(chapter.start_time, Math.min(time, chapter.end_time));
}

export function toChapterLocalTime(chapter: Chapter | null, globalTime: number): number {
  if (!chapter) return globalTime;
  const duration = getChapterDuration(chapter);
  const local = globalTime - chapter.start_time;
  return Math.max(0, Math.min(local, duration));
}

export function toChapterGlobalTime(chapter: Chapter | null, localTime: number): number {
  if (!chapter) return localTime;
  const duration = getChapterDuration(chapter);
  const clampedLocal = Math.max(0, Math.min(localTime, duration));
  return clampToChapter(chapter, chapter.start_time + clampedLocal);
}
