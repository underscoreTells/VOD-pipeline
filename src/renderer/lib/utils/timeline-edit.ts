export interface TimelineInterval {
  start: number;
  end: number;
}

export interface ClipRange {
  start: number;
  end: number;
}

export interface SplitClipPoints {
  leftOutPoint: number;
  rightStartTime: number;
  rightInPoint: number;
  rightOutPoint: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildDefaultClipRangeAtCursor(
  cursorTime: number,
  intervals: TimelineInterval[],
  chapterDuration: number,
  defaultDuration = 5,
  minDuration = 0.05
): ClipRange | null {
  if (!Number.isFinite(chapterDuration) || chapterDuration <= 0) return null;

  const safeCursor = clamp(cursorTime, 0, chapterDuration);
  const safeDefaultDuration = Math.max(minDuration, defaultDuration);
  let leftBoundary = 0;
  let rightBoundary = chapterDuration;

  for (const interval of intervals) {
    const start = Math.min(interval.start, interval.end);
    const end = Math.max(interval.start, interval.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end - start < minDuration) continue;

    if (safeCursor > start && safeCursor < end) {
      return null;
    }

    if (end <= safeCursor) {
      leftBoundary = Math.max(leftBoundary, end);
    }

    if (start >= safeCursor) {
      rightBoundary = Math.min(rightBoundary, start);
    }
  }

  const availableDuration = rightBoundary - leftBoundary;
  if (availableDuration < minDuration) return null;

  let start = clamp(safeCursor, leftBoundary, rightBoundary - minDuration);
  let end = Math.min(start + safeDefaultDuration, rightBoundary);

  if (end - start < minDuration) {
    start = Math.max(leftBoundary, rightBoundary - safeDefaultDuration);
    end = rightBoundary;
  }

  if (end - start < minDuration) return null;
  return { start, end };
}

export function splitClipAtTimelineTime(params: {
  clipStartTime: number;
  inPoint: number;
  outPoint: number;
  splitTime: number;
  minDuration?: number;
}): SplitClipPoints | null {
  const {
    clipStartTime,
    inPoint,
    outPoint,
    splitTime,
    minDuration = 0.05,
  } = params;

  if (!Number.isFinite(clipStartTime) || !Number.isFinite(inPoint) || !Number.isFinite(outPoint) || !Number.isFinite(splitTime)) {
    return null;
  }

  const clipDuration = outPoint - inPoint;
  if (clipDuration <= 0) return null;

  const clipEndTime = clipStartTime + clipDuration;
  if (splitTime <= clipStartTime + minDuration) return null;
  if (splitTime >= clipEndTime - minDuration) return null;

  const splitOffset = splitTime - clipStartTime;
  const leftOutPoint = inPoint + splitOffset;
  const rightInPoint = leftOutPoint;
  const rightOutPoint = outPoint;

  if (leftOutPoint - inPoint < minDuration) return null;
  if (rightOutPoint - rightInPoint < minDuration) return null;

  return {
    leftOutPoint,
    rightStartTime: splitTime,
    rightInPoint,
    rightOutPoint,
  };
}
