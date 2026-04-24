import type { Chapter, Clip } from '../types/database.js';

type ClipWindow = Pick<Clip, 'in_point' | 'out_point'>;
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
