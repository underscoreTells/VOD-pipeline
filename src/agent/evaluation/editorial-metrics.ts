export interface EvaluationRange {
  start: number;
  end: number;
}

export interface EditorialEvaluationInput {
  expectedRemovals: EvaluationRange[];
  proposedRemovals: EvaluationRange[];
  protectedRanges?: EvaluationRange[];
  minimumMatchIou?: number;
}

export interface EditorialEvaluationResult {
  expectedCount: number;
  proposedCount: number;
  matchedCount: number;
  precision: number;
  recall: number;
  meanBoundaryErrorSeconds: number | null;
  protectedOverlapSeconds: number;
}

export function evaluateEditorialRemovals(
  input: EditorialEvaluationInput
): EditorialEvaluationResult {
  const expected = input.expectedRemovals.filter(isValidRange);
  const proposed = input.proposedRemovals.filter(isValidRange);
  const minimumMatchIou = Math.min(1, Math.max(0, input.minimumMatchIou ?? 0.3));
  const candidates = expected.flatMap((expectedRange, expectedIndex) =>
    proposed.flatMap((proposedRange, proposedIndex) => {
      const iou = rangeIou(expectedRange, proposedRange);
      return iou >= minimumMatchIou
        ? [{ expectedIndex, proposedIndex, iou }]
        : [];
    })
  ).sort((left, right) => right.iou - left.iou);

  const matchedExpected = new Set<number>();
  const matchedProposed = new Set<number>();
  const boundaryErrors: number[] = [];
  for (const candidate of candidates) {
    if (
      matchedExpected.has(candidate.expectedIndex)
      || matchedProposed.has(candidate.proposedIndex)
    ) {
      continue;
    }
    matchedExpected.add(candidate.expectedIndex);
    matchedProposed.add(candidate.proposedIndex);
    const expectedRange = expected[candidate.expectedIndex];
    const proposedRange = proposed[candidate.proposedIndex];
    boundaryErrors.push(
      (Math.abs(expectedRange.start - proposedRange.start)
        + Math.abs(expectedRange.end - proposedRange.end)) / 2
    );
  }

  const protectedOverlapSeconds = proposed.reduce(
    (total, proposedRange) => total + (input.protectedRanges ?? [])
      .filter(isValidRange)
      .reduce((rangeTotal, protectedRange) =>
        rangeTotal + rangeIntersectionDuration(proposedRange, protectedRange), 0),
    0
  );
  const matchedCount = matchedExpected.size;
  return {
    expectedCount: expected.length,
    proposedCount: proposed.length,
    matchedCount,
    precision: proposed.length === 0 ? (expected.length === 0 ? 1 : 0) : matchedCount / proposed.length,
    recall: expected.length === 0 ? 1 : matchedCount / expected.length,
    meanBoundaryErrorSeconds: boundaryErrors.length === 0
      ? null
      : boundaryErrors.reduce((total, value) => total + value, 0) / boundaryErrors.length,
    protectedOverlapSeconds,
  };
}

function isValidRange(range: EvaluationRange): boolean {
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start;
}

function rangeIntersectionDuration(left: EvaluationRange, right: EvaluationRange): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function rangeIou(left: EvaluationRange, right: EvaluationRange): number {
  const intersection = rangeIntersectionDuration(left, right);
  const union = (left.end - left.start) + (right.end - right.start) - intersection;
  return union > 0 ? intersection / union : 0;
}
