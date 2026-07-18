export interface PointerToVodTimeInput {
  clientX: number;
  viewportLeft: number;
  scrollLeft: number;
  pixelsPerSecond: number;
  duration: number;
}

export interface CalculateZoomAroundPointerInput {
  pointerX: number;
  viewportLeft: number;
  currentScrollLeft: number;
  currentPixelsPerSecond: number;
  nextPixelsPerSecond: number;
  duration: number;
  viewportWidth: number;
}

export interface VodRange {
  start: number;
  end: number;
}

export interface ClampRangeAgainstNeighborsInput {
  start: number;
  end: number;
  duration: number;
  previousEnd: number | null | undefined;
  nextStart: number | null | undefined;
  minDuration: number;
}

const EPSILON = 1e-9;

const RULER_STEPS: readonly number[] = [
  1 / 30,
  1 / 15,
  1 / 10,
  1 / 5,
  0.5,
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  300,
  600,
  900,
  1800,
  3600,
];

const RULER_MIN_PIXELS = 80;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function resolveNeighborBound(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null || value === undefined || !isFiniteNumber(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function vodTimeToPixels(time: number, pixelsPerSecond: number): number {
  if (!isFiniteNumber(time) || !isFiniteNumber(pixelsPerSecond) || pixelsPerSecond <= 0) {
    return 0;
  }
  return time * pixelsPerSecond;
}

export function pointerToVodTime(input: PointerToVodTimeInput): number {
  const { clientX, viewportLeft, scrollLeft, pixelsPerSecond, duration } = input;
  if (!isFiniteNumber(duration) || duration <= 0) return 0;
  if (!isFiniteNumber(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  if (
    !isFiniteNumber(clientX) ||
    !isFiniteNumber(viewportLeft) ||
    !isFiniteNumber(scrollLeft)
  ) {
    return 0;
  }

  const viewportRelativeX = clientX - viewportLeft;
  const contentX = viewportRelativeX + scrollLeft;
  const time = contentX / pixelsPerSecond;
  return clampNumber(time, 0, duration);
}

export function calculateZoomAroundPointer(input: CalculateZoomAroundPointerInput): number {
  const {
    pointerX,
    viewportLeft,
    currentScrollLeft,
    currentPixelsPerSecond,
    nextPixelsPerSecond,
    duration,
    viewportWidth,
  } = input;

  if (!isFiniteNumber(duration) || duration <= 0) return 0;
  if (!isFiniteNumber(nextPixelsPerSecond) || nextPixelsPerSecond <= 0) return 0;
  if (!isFiniteNumber(currentPixelsPerSecond) || currentPixelsPerSecond <= 0) return 0;
  if (!isFiniteNumber(viewportWidth) || viewportWidth <= 0) return 0;
  if (
    !isFiniteNumber(pointerX) ||
    !isFiniteNumber(viewportLeft) ||
    !isFiniteNumber(currentScrollLeft)
  ) {
    return 0;
  }

  const viewportRelativeX = pointerX - viewportLeft;
  const currentContentX = viewportRelativeX + currentScrollLeft;
  const sourceTime = clampNumber(currentContentX / currentPixelsPerSecond, 0, duration);
  const newContentX = sourceTime * nextPixelsPerSecond;
  const maxScrollLeft = Math.max(0, duration * nextPixelsPerSecond - viewportWidth);
  const candidateScrollLeft = newContentX - viewportRelativeX;
  return clampNumber(candidateScrollLeft, 0, maxScrollLeft);
}

export function normalizeVodRange(
  start: number,
  end: number,
  duration: number,
  minDuration: number
): VodRange | null {
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) return null;
  if (!isFiniteNumber(duration) || duration <= 0) return null;
  const safeMinDuration = isFiniteNumber(minDuration) ? Math.max(0, minDuration) : 0;

  const sortedStart = Math.min(start, end);
  const sortedEnd = Math.max(start, end);
  const clampedStart = clampNumber(sortedStart, 0, duration);
  const clampedEnd = clampNumber(sortedEnd, 0, duration);
  if (clampedEnd - clampedStart + EPSILON < safeMinDuration) return null;
  return { start: clampedStart, end: clampedEnd };
}

export function rangesOverlap(left: VodRange, right: VodRange, epsilon = 0): boolean {
  if (
    !isFiniteNumber(left.start) ||
    !isFiniteNumber(left.end) ||
    !isFiniteNumber(right.start) ||
    !isFiniteNumber(right.end)
  ) {
    return false;
  }
  const safeEpsilon = isFiniteNumber(epsilon) ? Math.max(0, epsilon) : 0;
  const leftStart = Math.min(left.start, left.end);
  const leftEnd = Math.max(left.start, left.end);
  const rightStart = Math.min(right.start, right.end);
  const rightEnd = Math.max(right.start, right.end);
  const overlap = Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart);
  return overlap > safeEpsilon;
}

export function clampRangeAgainstNeighbors(
  input: ClampRangeAgainstNeighborsInput
): VodRange | null {
  const { start, end, duration, previousEnd, nextStart, minDuration } = input;
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) return null;
  if (!isFiniteNumber(duration) || duration <= 0) return null;
  const safeMinDuration = isFiniteNumber(minDuration) ? Math.max(0, minDuration) : 0;

  const sortedStart = Math.min(start, end);
  const sortedEnd = Math.max(start, end);
  const candidateLength = sortedEnd - sortedStart;

  const lowerBound = resolveNeighborBound(previousEnd, 0, 0, duration);
  const upperBound = resolveNeighborBound(nextStart, duration, 0, duration);
  const window = upperBound - lowerBound;
  if (window + EPSILON < safeMinDuration) return null;

  let newStart = clampNumber(sortedStart, lowerBound, Math.max(lowerBound, upperBound - safeMinDuration));
  let newEnd = Math.min(newStart + candidateLength, upperBound);
  if (newEnd - newStart + EPSILON < safeMinDuration) {
    newEnd = newStart + safeMinDuration;
    if (newEnd > upperBound) {
      newEnd = upperBound;
      newStart = newEnd - safeMinDuration;
    }
  }
  return { start: newStart, end: newEnd };
}

export function getAdaptiveRulerStep(pixelsPerSecond: number): number {
  if (!isFiniteNumber(pixelsPerSecond) || pixelsPerSecond <= 0) {
    return RULER_STEPS[RULER_STEPS.length - 1];
  }
  for (const step of RULER_STEPS) {
    const tickPixels = step * pixelsPerSecond;
    if (tickPixels >= RULER_MIN_PIXELS - EPSILON) {
      return step;
    }
  }
  return RULER_STEPS[RULER_STEPS.length - 1];
}
