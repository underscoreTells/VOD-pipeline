import type { Chapter, Clip, Suggestion } from '../types/database.js';

type ClipWindow = Pick<Clip, 'in_point' | 'out_point'>;
type SuggestionWindow = Pick<Suggestion, 'in_point' | 'out_point'>;
type SuggestionUpdateFields = Pick<
  Suggestion,
  'in_point' | 'out_point' | 'action_type' | 'target_clip_id' | 'action_payload_json'
>;
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
 * Since schema version 5 all stored suggestion ranges are chapter-local
 * (legacy global-source rows are converted by a one-time migration), so this
 * only clamps to the chapter range before shifting to global source time.
 */
export function normalizeSuggestionWindowForChapter(
  suggestion: SuggestionWindow,
  chapter: ChapterRange
): ClipSourceRange {
  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const localInPoint = clamp(suggestion.in_point, 0, chapterDuration);
  const localOutPoint = clamp(suggestion.out_point, localInPoint, chapterDuration);

  return {
    start: chapter.start_time + localInPoint,
    end: chapter.start_time + localOutPoint,
  };
}

/**
 * Merge an update suggestion's payload onto a base window, mirroring the
 * backend's applyUpdateSuggestionToClip clamping, so preview and validation
 * surfaces use the window the clip would actually have after accepting.
 */
export function mergeSuggestionUpdateWindow(
  suggestion: Pick<Suggestion, 'action_payload_json'>,
  base: ClipSourceRange,
  chapter: ChapterRange
): ClipSourceRange {
  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const clampLocal = (value: number, min: number) => clamp(value, min, chapterDuration);
  let inPoint = base.start;
  let outPoint = base.end;
  let updatePayload: { inPoint?: number; outPoint?: number } | undefined;
  if (suggestion.action_payload_json) {
    try {
      updatePayload = (JSON.parse(suggestion.action_payload_json) as {
        update?: { inPoint?: number; outPoint?: number };
      }).update;
    } catch {
      // The repository will report malformed action payloads on apply.
    }
  }
  if (typeof updatePayload?.inPoint === 'number' && Number.isFinite(updatePayload.inPoint)) {
    inPoint = chapter.start_time + clampLocal(updatePayload.inPoint, 0);
  }
  if (typeof updatePayload?.outPoint === 'number' && Number.isFinite(updatePayload.outPoint)) {
    const minLocalOut = clampLocal(inPoint - chapter.start_time, 0);
    outPoint = chapter.start_time + clampLocal(updatePayload.outPoint, minLocalOut);
  }
  return { start: inPoint, end: outPoint };
}

/**
 * Resolve the window a pending suggestion would produce. Update suggestions
 * merge their payload onto the live target window (acceptance reads the
 * target's current range, not the proposal-time stored range); everything
 * else falls back to the stored proposal range.
 */
export function resolveSuggestionWindowForChapter(
  suggestion: SuggestionUpdateFields,
  chapter: ChapterRange,
  targetWindow?: ClipSourceRange | null
): ClipSourceRange {
  if (suggestion.action_type === 'update_clip' && suggestion.target_clip_id && targetWindow) {
    return mergeSuggestionUpdateWindow(suggestion, targetWindow, chapter);
  }
  return normalizeSuggestionWindowForChapter(suggestion, chapter);
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
