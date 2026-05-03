export interface DraftChapterRange {
  id: number;
  startTime: number;
  endTime: number;
  title: string;
}

export const MIN_DRAFT_CHAPTER_DURATION_SECONDS = 1;

type DraftChapterEdge = 'start' | 'end';

interface TimeRange {
  startTime: number;
  endTime: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sortRanges(ranges: DraftChapterRange[]): DraftChapterRange[] {
  return [...ranges].sort((left, right) => {
    if (left.startTime !== right.startTime) {
      return left.startTime - right.startTime;
    }
    if (left.endTime !== right.endTime) {
      return left.endTime - right.endTime;
    }
    return left.id - right.id;
  });
}

function overlaps(left: TimeRange, right: TimeRange): boolean {
  return left.startTime < right.endTime && left.endTime > right.startTime;
}

export function getDraftChapterDuration(range: Pick<DraftChapterRange, 'startTime' | 'endTime'>): number {
  return Math.max(0, range.endTime - range.startTime);
}

export function normalizeDraftChapterRange(params: {
  startTime: number;
  endTime: number;
  timelineDuration: number;
  minimumDuration?: number;
}): TimeRange | null {
  const timelineDuration = Math.max(0, params.timelineDuration);
  const minimumDuration = params.minimumDuration ?? MIN_DRAFT_CHAPTER_DURATION_SECONDS;
  const startTime = clamp(Math.min(params.startTime, params.endTime), 0, timelineDuration);
  const endTime = clamp(Math.max(params.startTime, params.endTime), 0, timelineDuration);

  if (endTime - startTime < minimumDuration) {
    return null;
  }

  return {
    startTime,
    endTime,
  };
}

export function renumberDraftChapterRanges(ranges: DraftChapterRange[]): DraftChapterRange[] {
  return sortRanges(ranges).map((range, index) => ({
    ...range,
    title: `Chapter ${index + 1}`,
  }));
}

export function createDraftChapterRange(params: {
  id: number;
  startTime: number;
  endTime: number;
  timelineDuration: number;
  minimumDuration?: number;
}): DraftChapterRange | null {
  const normalized = normalizeDraftChapterRange(params);
  if (!normalized) {
    return null;
  }

  return {
    id: params.id,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    title: 'Chapter',
  };
}

export function insertDraftChapterRange(
  ranges: DraftChapterRange[],
  nextRange: DraftChapterRange
): DraftChapterRange[] | null {
  for (const range of ranges) {
    if (overlaps(range, nextRange)) {
      return null;
    }
  }

  return renumberDraftChapterRanges([...ranges, nextRange]);
}

export function removeDraftChapterRange(ranges: DraftChapterRange[], id: number): DraftChapterRange[] {
  return renumberDraftChapterRanges(ranges.filter((range) => range.id !== id));
}

export function getDraftChapterRangeById(
  ranges: DraftChapterRange[],
  id: number
): DraftChapterRange | null {
  return ranges.find((range) => range.id === id) ?? null;
}

export function moveDraftChapterRange(
  ranges: DraftChapterRange[],
  id: number,
  proposedStartTime: number,
  timelineDuration: number
): DraftChapterRange[] {
  const sorted = sortRanges(ranges);
  const index = sorted.findIndex((range) => range.id === id);
  if (index === -1) {
    return renumberDraftChapterRanges(sorted);
  }

  const current = sorted[index];
  const previous = sorted[index - 1] ?? null;
  const next = sorted[index + 1] ?? null;
  const duration = getDraftChapterDuration(current);
  const lowerBound = previous?.endTime ?? 0;
  const upperBound = next?.startTime ?? Math.max(0, timelineDuration);
  const maxStartTime = Math.max(lowerBound, upperBound - duration);
  const startTime = clamp(proposedStartTime, lowerBound, maxStartTime);
  const endTime = clamp(startTime + duration, startTime, Math.max(startTime, upperBound));

  sorted[index] = {
    ...current,
    startTime,
    endTime,
  };

  return renumberDraftChapterRanges(sorted);
}

export function resizeDraftChapterRange(
  ranges: DraftChapterRange[],
  id: number,
  edge: DraftChapterEdge,
  proposedTime: number,
  timelineDuration: number,
  minimumDuration = MIN_DRAFT_CHAPTER_DURATION_SECONDS
): DraftChapterRange[] {
  const sorted = sortRanges(ranges);
  const index = sorted.findIndex((range) => range.id === id);
  if (index === -1) {
    return renumberDraftChapterRanges(sorted);
  }

  const current = sorted[index];
  const previous = sorted[index - 1] ?? null;
  const next = sorted[index + 1] ?? null;

  if (edge === 'start') {
    const minStartTime = previous?.endTime ?? 0;
    const maxStartTime = current.endTime - minimumDuration;
    sorted[index] = {
      ...current,
      startTime: clamp(proposedTime, minStartTime, maxStartTime),
    };
    return renumberDraftChapterRanges(sorted);
  }

  const minEndTime = current.startTime + minimumDuration;
  const maxEndTime = next?.startTime ?? Math.max(0, timelineDuration);
  sorted[index] = {
    ...current,
    endTime: clamp(proposedTime, minEndTime, maxEndTime),
  };
  return renumberDraftChapterRanges(sorted);
}
