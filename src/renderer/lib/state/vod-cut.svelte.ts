import type { VodCutDraft, VodCutRange } from '$shared/types/database';
import { normalizeVodRange, rangesOverlap } from '../utils/vod-cut-timeline.js';

interface VodCutSnapshot {
  ranges: VodCutRange[];
  selectedRangeId: string | null;
  pendingIn: number | null;
  pendingOut: number | null;
}

interface VodCutState {
  projectId: number | null;
  assetId: number | null;
  duration: number;
  fps: number;
  ranges: VodCutRange[];
  selectedRangeId: string | null;
  pendingIn: number | null;
  pendingOut: number | null;
  playheadTime: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  dirty: boolean;
  revision: number;
  isLoading: boolean;
  isSaving: boolean;
  hasPersistedView: boolean;
  lastSavedAt: string | null;
  error: string | null;
}

const MAX_HISTORY = 50;
const DEFAULT_FPS = 24;
let nextRangeId = 1;
let undoStack: VodCutSnapshot[] = [];
let redoStack: VodCutSnapshot[] = [];
let pendingDraftRanges: VodCutRange[] | null = null;
let pendingDraftPlayhead: number | null = null;

export const vodCutState = $state<VodCutState>({
  projectId: null,
  assetId: null,
  duration: 0,
  fps: DEFAULT_FPS,
  ranges: [],
  selectedRangeId: null,
  pendingIn: null,
  pendingOut: null,
  playheadTime: 0,
  pixelsPerSecond: 1,
  scrollLeft: 0,
  dirty: false,
  revision: 0,
  isLoading: false,
  isSaving: false,
  hasPersistedView: false,
  lastSavedAt: null,
  error: null,
});

function cloneRanges(ranges: VodCutRange[]): VodCutRange[] {
  return ranges.map((range) => ({ ...range }));
}

function createSnapshot(): VodCutSnapshot {
  return {
    ranges: cloneRanges(vodCutState.ranges),
    selectedRangeId: vodCutState.selectedRangeId,
    pendingIn: vodCutState.pendingIn,
    pendingOut: vodCutState.pendingOut,
  };
}

function restoreSnapshot(snapshot: VodCutSnapshot): void {
  vodCutState.ranges = cloneRanges(snapshot.ranges);
  vodCutState.selectedRangeId = snapshot.selectedRangeId;
  vodCutState.pendingIn = snapshot.pendingIn;
  vodCutState.pendingOut = snapshot.pendingOut;
  vodCutState.dirty = true;
  vodCutState.revision += 1;
  vodCutState.error = null;
}

function recordMutation(): void {
  undoStack.push(createSnapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

function clampTime(time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(vodCutState.duration, Math.max(0, time));
}

function getMinimumDuration(): number {
  const fps = Number.isFinite(vodCutState.fps)
    ? Math.min(240, Math.max(1, vodCutState.fps))
    : DEFAULT_FPS;
  return 1 / fps;
}

function sortRanges(ranges: VodCutRange[]): VodCutRange[] {
  return [...ranges].sort((left, right) => left.start_time - right.start_time || left.end_time - right.end_time);
}

function sanitizeRanges(ranges: VodCutRange[]): VodCutRange[] {
  const accepted: VodCutRange[] = [];
  for (const range of sortRanges(cloneRanges(ranges))) {
    const normalized = normalizeVodRange(
      range.start_time,
      range.end_time,
      vodCutState.duration,
      getMinimumDuration(),
    );
    if (!normalized || !range.id || !range.title.trim()) continue;
    const candidate = {
      ...range,
      title: range.title.trim(),
      start_time: normalized.start,
      end_time: normalized.end,
    };
    if (accepted.some((existing) => rangesOverlap(
      { start: candidate.start_time, end: candidate.end_time },
      { start: existing.start_time, end: existing.end_time },
      1e-6,
    ))) continue;
    accepted.push(candidate);
  }
  return accepted;
}

function applyDraftRanges(ranges: VodCutRange[]): void {
  vodCutState.ranges = sanitizeRanges(ranges);
  vodCutState.error = vodCutState.ranges.length === ranges.length
    ? null
    : 'Some invalid saved chapter ranges were removed.';
  vodCutState.isLoading = false;
  pendingDraftRanges = null;
}

function overlapsExisting(candidate: VodCutRange, excludedId: string | null = null): boolean {
  return vodCutState.ranges.some((range) => (
    range.id !== excludedId && rangesOverlap(
      { start: candidate.start_time, end: candidate.end_time },
      { start: range.start_time, end: range.end_time },
      1e-6,
    )
  ));
}

function createRangeId(): string {
  const id = `vod-range-${Date.now()}-${nextRangeId}`;
  nextRangeId += 1;
  return id;
}

export function initializeVodCut(options: {
  projectId: number;
  assetId: number;
  duration: number;
  fps?: number | null;
  draft?: VodCutDraft | null;
}): void {
  vodCutState.projectId = options.projectId;
  vodCutState.assetId = options.assetId;
  vodCutState.duration = Number.isFinite(options.duration) ? Math.max(0, options.duration) : 0;
  vodCutState.fps = options.fps && Number.isFinite(options.fps) ? options.fps : DEFAULT_FPS;
  const draftRanges = options.draft?.ranges ?? [];
  pendingDraftRanges = draftRanges.length > 0 && vodCutState.duration <= 0
    ? cloneRanges(draftRanges)
    : null;
  const draftPlayhead = options.draft?.view?.playheadTime ?? 0;
  pendingDraftPlayhead = vodCutState.duration <= 0 && Number.isFinite(draftPlayhead)
    ? Math.max(0, draftPlayhead)
    : null;
  vodCutState.ranges = [];
  vodCutState.selectedRangeId = null;
  vodCutState.pendingIn = null;
  vodCutState.pendingOut = null;
  vodCutState.playheadTime = pendingDraftPlayhead ?? clampTime(draftPlayhead);
  vodCutState.pixelsPerSecond = options.draft?.view?.pixelsPerSecond ?? 1;
  vodCutState.scrollLeft = options.draft?.view?.scrollLeft ?? 0;
  vodCutState.dirty = false;
  vodCutState.revision = 0;
  vodCutState.isLoading = pendingDraftRanges !== null;
  vodCutState.isSaving = false;
  vodCutState.hasPersistedView = options.draft?.view !== undefined;
  vodCutState.lastSavedAt = options.draft?.updated_at ?? null;
  vodCutState.error = null;
  if (!pendingDraftRanges) applyDraftRanges(draftRanges);
  undoStack = [];
  redoStack = [];
}

export function clearVodCut(): void {
  initializeVodCut({ projectId: 0, assetId: 0, duration: 0 });
  vodCutState.projectId = null;
  vodCutState.assetId = null;
}

export function setVodCutPlayhead(time: number): void {
  const next = clampTime(time);
  pendingDraftPlayhead = null;
  if (Math.abs(next - vodCutState.playheadTime) < 1e-6) return;
  vodCutState.playheadTime = next;
  vodCutState.dirty = true;
  vodCutState.revision += 1;
}

export function setVodCutDuration(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) return;
  vodCutState.duration = duration;
  vodCutState.playheadTime = clampTime(pendingDraftPlayhead ?? vodCutState.playheadTime);
  pendingDraftPlayhead = null;
  if (pendingDraftRanges) applyDraftRanges(pendingDraftRanges);
}

export function setVodCutView(pixelsPerSecond: number, scrollLeft: number): void {
  let changed = false;
  if (Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0) {
    changed ||= Math.abs(vodCutState.pixelsPerSecond - pixelsPerSecond) >= 1e-6;
    vodCutState.pixelsPerSecond = pixelsPerSecond;
  }
  if (Number.isFinite(scrollLeft)) {
    const nextScrollLeft = Math.max(0, scrollLeft);
    changed ||= Math.abs(vodCutState.scrollLeft - nextScrollLeft) >= 0.5;
    vodCutState.scrollLeft = nextScrollLeft;
  }
  if (changed) {
    vodCutState.dirty = true;
    vodCutState.revision += 1;
  }
}

export function markVodCutIn(time = vodCutState.playheadTime): void {
  vodCutState.pendingIn = clampTime(time);
  if (vodCutState.pendingOut !== null && vodCutState.pendingOut <= vodCutState.pendingIn) {
    vodCutState.pendingOut = null;
  }
}

export function markVodCutOut(time = vodCutState.playheadTime): void {
  const nextTime = clampTime(time);
  if (vodCutState.pendingIn === null) {
    vodCutState.pendingIn = nextTime;
    return;
  }
  vodCutState.pendingOut = nextTime;
}

export function setVodCutPendingRange(start: number, end: number): void {
  vodCutState.pendingIn = clampTime(Math.min(start, end));
  vodCutState.pendingOut = clampTime(Math.max(start, end));
}

export function clearVodCutPendingRange(): void {
  vodCutState.pendingIn = null;
  vodCutState.pendingOut = null;
}

export function addVodCutRange(input?: {
  id?: string;
  title?: string;
  start?: number;
  end?: number;
}): VodCutRange | null {
  const start = input?.start ?? vodCutState.pendingIn;
  const end = input?.end ?? vodCutState.pendingOut;
  if (start === null || start === undefined || end === null || end === undefined) return null;

  const normalized = normalizeVodRange(start, end, vodCutState.duration, getMinimumDuration());
  if (!normalized) {
    vodCutState.error = 'Chapter range must be at least one frame long.';
    return null;
  }

  const range: VodCutRange = {
    id: input?.id ?? createRangeId(),
    title: input?.title?.trim() || `Chapter ${vodCutState.ranges.length + 1}`,
    start_time: normalized.start,
    end_time: normalized.end,
  };
  if (overlapsExisting(range)) {
    vodCutState.error = 'Chapter ranges cannot overlap.';
    return null;
  }

  recordMutation();
  vodCutState.ranges = sortRanges([...vodCutState.ranges, range]);
  vodCutState.selectedRangeId = range.id;
  clearVodCutPendingRange();
  vodCutState.dirty = true;
  vodCutState.revision += 1;
  vodCutState.error = null;
  return range;
}

export function updateVodCutRange(
  id: string,
  updates: Partial<Pick<VodCutRange, 'title' | 'start_time' | 'end_time'>>,
): boolean {
  const current = vodCutState.ranges.find((range) => range.id === id);
  if (!current) return false;
  const start = updates.start_time ?? current.start_time;
  const end = updates.end_time ?? current.end_time;
  const normalized = normalizeVodRange(start, end, vodCutState.duration, getMinimumDuration());
  if (!normalized) {
    vodCutState.error = 'Chapter range must be at least one frame long.';
    return false;
  }

  const next: VodCutRange = {
    ...current,
    ...updates,
    title: updates.title?.trim() || current.title,
    start_time: normalized.start,
    end_time: normalized.end,
  };
  if (overlapsExisting(next, id)) {
    vodCutState.error = 'Chapter ranges cannot overlap.';
    return false;
  }

  recordMutation();
  vodCutState.ranges = sortRanges(vodCutState.ranges.map((range) => range.id === id ? next : range));
  vodCutState.selectedRangeId = id;
  vodCutState.dirty = true;
  vodCutState.revision += 1;
  vodCutState.error = null;
  return true;
}

export function deleteVodCutRange(id: string): boolean {
  if (!vodCutState.ranges.some((range) => range.id === id)) return false;
  recordMutation();
  vodCutState.ranges = vodCutState.ranges.filter((range) => range.id !== id);
  if (vodCutState.selectedRangeId === id) vodCutState.selectedRangeId = null;
  vodCutState.dirty = true;
  vodCutState.revision += 1;
  vodCutState.error = null;
  return true;
}

export function selectVodCutRange(id: string | null): void {
  vodCutState.selectedRangeId = id;
}

export function undoVodCut(): boolean {
  const snapshot = undoStack.pop();
  if (!snapshot) return false;
  redoStack.push(createSnapshot());
  restoreSnapshot(snapshot);
  return true;
}

export function redoVodCut(): boolean {
  const snapshot = redoStack.pop();
  if (!snapshot) return false;
  undoStack.push(createSnapshot());
  restoreSnapshot(snapshot);
  return true;
}

export function canUndoVodCut(): boolean {
  return undoStack.length > 0;
}

export function canRedoVodCut(): boolean {
  return redoStack.length > 0;
}

export function markVodCutSaved(updatedAt: string, savedRevision = vodCutState.revision): void {
  if (vodCutState.revision === savedRevision) {
    vodCutState.dirty = false;
  }
  vodCutState.isSaving = false;
  vodCutState.lastSavedAt = updatedAt;
  vodCutState.error = null;
}

export function setVodCutSaving(saving: boolean): void {
  vodCutState.isSaving = saving;
}

export function setVodCutError(error: string | null): void {
  vodCutState.error = error;
}
