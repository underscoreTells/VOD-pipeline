export interface NormalizedSelection {
  start: number;
  end: number;
}

export function normalizeSelection(
  start: number,
  end: number,
  minimumDuration: number
): NormalizedSelection | null {
  const min = Math.min(start, end);
  const max = Math.max(start, end);

  if (max - min < minimumDuration) {
    return null;
  }

  return { start: min, end: max };
}

export function buildClipTimes(selection: NormalizedSelection) {
  return {
    startTime: selection.start,
    inPoint: selection.start,
    outPoint: selection.end,
  };
}
