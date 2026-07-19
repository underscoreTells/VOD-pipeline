import type { Chapter, Clip, Suggestion } from '../types/database.js';

type ClipWindow = Pick<Clip, 'in_point' | 'out_point'>;
type SuggestionWindow = Pick<Suggestion, 'in_point' | 'out_point'>;
type ExportSortableClip = Pick<Clip, 'id' | 'asset_id' | 'in_point'>;
type SourceSortableClip = Pick<Clip, 'id' | 'in_point'>;
type ExportSortableChapter = Pick<Chapter, 'id' | 'display_order' | 'start_time'>;
type ChapterRange = Pick<Chapter, 'start_time' | 'end_time'>;

export interface ClipSourceRange {
  start: number;
  end: number;
}

export interface SplitClipSourceWindow {
  leftInPoint: number;
  leftOutPoint: number;
  rightInPoint: number;
  rightOutPoint: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getClipDuration(clip: ClipWindow): number {
  return Math.max(0, clip.out_point - clip.in_point);
}

export function getClipSourceRange(clip: ClipWindow): ClipSourceRange {
  return {
    start: clip.in_point,
    end: clip.out_point,
  };
}

export function clipOverlapsChapterSourceRange(
  clip: ClipWindow,
  chapter: ChapterRange
): boolean {
  return clip.out_point > chapter.start_time && clip.in_point < chapter.end_time;
}

/**
 * Normalize a suggestion's stored in/out points to global source times.
 * Current builds persist chapter-local values; suggestions persisted by
 * older builds may hold global source times. Values that cannot be
 * chapter-local (beyond the chapter duration, or negative) are treated as
 * legacy-global and shifted back before clamping to the chapter range.
 */
export function normalizeSuggestionWindowForChapter(
  suggestion: SuggestionWindow,
  chapter: ChapterRange
): ClipSourceRange {
  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);

  const looksLikeLegacyGlobal =
    suggestion.in_point > chapterDuration + 1 ||
    suggestion.out_point > chapterDuration + 1 ||
    suggestion.in_point < -0.5 ||
    suggestion.out_point < -0.5;

  const localInRaw = looksLikeLegacyGlobal
    ? suggestion.in_point - chapter.start_time
    : suggestion.in_point;
  const localOutRaw = looksLikeLegacyGlobal
    ? suggestion.out_point - chapter.start_time
    : suggestion.out_point;

  const localInPoint = clamp(localInRaw, 0, chapterDuration);
  const localOutPoint = clamp(localOutRaw, localInPoint, chapterDuration);

  return {
    start: chapter.start_time + localInPoint,
    end: chapter.start_time + localOutPoint,
  };
}

export function getClipVisibleRangeInChapter(
  clip: ClipWindow,
  chapter: ChapterRange
): ClipSourceRange | null {
  if (!clipOverlapsChapterSourceRange(clip, chapter)) {
    return null;
  }

  const start = Math.max(chapter.start_time, clip.in_point);
  const end = Math.min(chapter.end_time, clip.out_point);
  return end > start ? { start, end } : null;
}

export function compareClipsBySourceTime(
  left: SourceSortableClip,
  right: SourceSortableClip
): number {
  if (Math.abs(left.in_point - right.in_point) > 0.0001) {
    return left.in_point - right.in_point;
  }

  return left.id - right.id;
}

export function compareClipsForExport(
  left: ExportSortableClip,
  right: ExportSortableClip
): number {
  if (Math.abs(left.in_point - right.in_point) > 0.0001) {
    return left.in_point - right.in_point;
  }

  if (left.asset_id !== right.asset_id) {
    return left.asset_id - right.asset_id;
  }

  return left.id - right.id;
}

export function compareChaptersForExport(
  left: ExportSortableChapter,
  right: ExportSortableChapter
): number {
  if (left.display_order !== right.display_order) {
    return left.display_order - right.display_order;
  }

  if (Math.abs(left.start_time - right.start_time) > 0.0001) {
    return left.start_time - right.start_time;
  }

  return left.id - right.id;
}

export function splitClipAtSourceTime(params: {
  inPoint: number;
  outPoint: number;
  splitTime: number;
  minDuration?: number;
}): SplitClipSourceWindow | null {
  const { inPoint, outPoint, splitTime, minDuration = 0.05 } = params;

  if (
    !Number.isFinite(inPoint) ||
    !Number.isFinite(outPoint) ||
    !Number.isFinite(splitTime)
  ) {
    return null;
  }

  if (outPoint <= inPoint) {
    return null;
  }

  if (splitTime <= inPoint + minDuration) {
    return null;
  }

  if (splitTime >= outPoint - minDuration) {
    return null;
  }

  return {
    leftInPoint: inPoint,
    leftOutPoint: splitTime,
    rightInPoint: splitTime,
    rightOutPoint: outPoint,
  };
}
