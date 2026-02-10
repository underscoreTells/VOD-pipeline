export interface ClipCollisionInterval {
  start: number;
  end: number;
}

export type CollisionDragDirection = 'left' | 'right' | 'none';

export interface ClampMoveStartWithCollisionInput {
  candidateStart: number;
  duration: number;
  chapterDuration: number;
  currentStart: number;
  currentEnd: number;
  direction: CollisionDragDirection;
  otherIntervals: ClipCollisionInterval[];
}

const COLLISION_EPSILON = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampMoveStartWithCollision(input: ClampMoveStartWithCollisionInput): number {
  const {
    candidateStart,
    duration,
    chapterDuration,
    currentStart,
    currentEnd,
    direction,
    otherIntervals,
  } = input;

  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safeChapterDuration = Number.isFinite(chapterDuration) ? Math.max(0, chapterDuration) : 0;
  const maxStart = Math.max(0, safeChapterDuration - safeDuration);
  let nextStart = clamp(candidateStart, 0, maxStart);

  if (safeDuration <= COLLISION_EPSILON || direction === 'none') {
    return nextStart;
  }

  if (direction === 'right') {
    let nextBoundaryStart = Number.POSITIVE_INFINITY;

    for (const interval of otherIntervals) {
      const rawStart = Math.min(interval.start, interval.end);
      const rawEnd = Math.max(interval.start, interval.end);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
      if (rawEnd - rawStart <= COLLISION_EPSILON) continue;
      if (rawStart >= currentEnd - COLLISION_EPSILON) {
        nextBoundaryStart = Math.min(nextBoundaryStart, rawStart);
      }
    }

    if (Number.isFinite(nextBoundaryStart)) {
      nextStart = Math.min(nextStart, nextBoundaryStart - safeDuration);
    }
  }

  if (direction === 'left') {
    let previousBoundaryEnd = Number.NEGATIVE_INFINITY;

    for (const interval of otherIntervals) {
      const rawStart = Math.min(interval.start, interval.end);
      const rawEnd = Math.max(interval.start, interval.end);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
      if (rawEnd - rawStart <= COLLISION_EPSILON) continue;
      if (rawEnd <= currentStart + COLLISION_EPSILON) {
        previousBoundaryEnd = Math.max(previousBoundaryEnd, rawEnd);
      }
    }

    if (Number.isFinite(previousBoundaryEnd)) {
      nextStart = Math.max(nextStart, previousBoundaryEnd);
    }
  }

  return clamp(nextStart, 0, maxStart);
}
