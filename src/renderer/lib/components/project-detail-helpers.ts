export function toAgentChapterId(chapterId: number | null | undefined): string | null {
  if (typeof chapterId !== "number" || !Number.isFinite(chapterId)) {
    return null;
  }

  return String(chapterId);
}

export function shouldSyncAgentChapterContext(
  previousChapterId: string | null,
  nextChapterId: string | null
): boolean {
  return previousChapterId !== nextChapterId;
}
