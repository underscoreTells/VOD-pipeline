// Clip builder state for manual in/out selection
export const clipBuilderState = $state({
  inPoint: null as number | null,
  outPoint: null as number | null,
});

export function setInPoint(time: number) {
  clipBuilderState.inPoint = time;
  if (clipBuilderState.outPoint !== null && clipBuilderState.outPoint <= time) {
    clipBuilderState.outPoint = null;
  }
}

export function setOutPoint(time: number) {
  if (clipBuilderState.inPoint === null) {
    clipBuilderState.inPoint = time;
    return;
  }
  clipBuilderState.outPoint = Math.max(time, clipBuilderState.inPoint + 0.01);
}

export function clearSelection() {
  clipBuilderState.inPoint = null;
  clipBuilderState.outPoint = null;
}

export function hasCompleteSelection(): boolean {
  return (
    clipBuilderState.inPoint !== null &&
    clipBuilderState.outPoint !== null &&
    clipBuilderState.outPoint > clipBuilderState.inPoint
  );
}

export function getSelectionDuration(): number {
  if (!hasCompleteSelection()) return 0;
  return (clipBuilderState.outPoint ?? 0) - (clipBuilderState.inPoint ?? 0);
}
