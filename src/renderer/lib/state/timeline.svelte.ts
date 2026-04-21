import type { Clip, TimelineState } from '../../../shared/types/database';

interface TimelineStateStore {
  projectId: number | null;
  clips: Clip[];
  minZoomLevel: number;
  zoomLevel: number;
  scrollPosition: number;
  playheadTime: number;
  selectedClipIds: Set<number>;
  isPlaying: boolean;
  shuttleDirection: -1 | 0 | 1;
  shuttleSpeed: number;
  excludeCutContent: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface TimelineTransportSnapshot {
  isPlaying: boolean;
  shuttleDirection: -1 | 0 | 1;
  shuttleSpeed: number;
}

const MIN_ALLOWED_ZOOM = 0.05;
const MAX_ALLOWED_ZOOM = 1000;

// Timeline state using Svelte 5 runes
export const timelineState = $state<TimelineStateStore>({
  projectId: null as number | null,
  clips: [] as Clip[],
  minZoomLevel: 10,
  zoomLevel: 100,        // pixels per second
  scrollPosition: 0,     // seconds from start
  playheadTime: 0,       // current position
  selectedClipIds: new Set<number>(),
  isPlaying: false,
  shuttleDirection: 0,
  shuttleSpeed: 1,
  excludeCutContent: false,
  isLoading: false,
  error: null as string | null,
});

const SHUTTLE_SPEED_TIERS = [1, 2, 4, 8] as const;

function nextShuttleSpeed(current: number): number {
  for (const speed of SHUTTLE_SPEED_TIERS) {
    if (current < speed) {
      return speed;
    }
  }
  return SHUTTLE_SPEED_TIERS[SHUTTLE_SPEED_TIERS.length - 1];
}

// Derived state
export function getSelectedClips(): Clip[] {
  return timelineState.clips.filter(clip => timelineState.selectedClipIds.has(clip.id));
}

export function getTotalDuration(): number {
  if (timelineState.clips.length === 0) return 0;
  return Math.max(...timelineState.clips.map(c => c.start_time + (c.out_point - c.in_point)));
}

export function getClipsByTrack(): Map<number, Clip[]> {
  const map = new Map<number, Clip[]>();
  for (const clip of timelineState.clips) {
    const trackClips = map.get(clip.track_index) || [];
    trackClips.push(clip);
    map.set(clip.track_index, trackClips);
  }
  return map;
}

export function getClipById(id: number): Clip | undefined {
  return timelineState.clips.find(clip => clip.id === id);
}

// Actions
export function loadTimeline(projectId: number, clips: Clip[], state?: TimelineState | null) {
  timelineState.projectId = projectId;
  timelineState.clips = clips;
  timelineState.excludeCutContent = false;
  timelineState.isPlaying = false;
  timelineState.shuttleDirection = 0;
  timelineState.shuttleSpeed = 1;

  if (state) {
    timelineState.zoomLevel = Math.max(timelineState.minZoomLevel, Math.min(MAX_ALLOWED_ZOOM, state.zoom_level));
    timelineState.scrollPosition = state.scroll_position;
    timelineState.playheadTime = state.playhead_time;
    timelineState.selectedClipIds = new Set(state.selected_clip_ids);
  } else {
    // Reset view state to defaults when no state is provided
    timelineState.zoomLevel = 100;
    timelineState.scrollPosition = 0;
    timelineState.playheadTime = 0;
    timelineState.selectedClipIds = new Set();
  }
}

export function setClips(clips: Clip[]) {
  timelineState.clips = clips;
}

export function createClip(clip: Clip) {
  timelineState.clips = [...timelineState.clips, clip];
}

export function updateClip(id: number, updates: Partial<Clip>) {
  timelineState.clips = timelineState.clips.map(clip =>
    clip.id === id ? { ...clip, ...updates } : clip
  );
}

export function deleteClip(id: number) {
  timelineState.clips = timelineState.clips.filter(clip => clip.id !== id);
  if (timelineState.selectedClipIds.has(id)) {
    const nextSelectedIds = new Set(timelineState.selectedClipIds);
    nextSelectedIds.delete(id);
    timelineState.selectedClipIds = nextSelectedIds;
  }
}

export function selectClip(id: number, multiSelect: boolean = false) {
  const nextSelectedIds = new Set(timelineState.selectedClipIds);

  if (multiSelect) {
    if (nextSelectedIds.has(id)) {
      nextSelectedIds.delete(id);
    } else {
      nextSelectedIds.add(id);
    }
  } else {
    nextSelectedIds.clear();
    nextSelectedIds.add(id);
  }

  timelineState.selectedClipIds = nextSelectedIds;
}

export function clearSelection() {
  if (timelineState.selectedClipIds.size === 0) return;
  timelineState.selectedClipIds = new Set();
}

export function selectAll() {
  timelineState.selectedClipIds = new Set(timelineState.clips.map(c => c.id));
}

export function setPlayhead(time: number) {
  timelineState.playheadTime = time;
}

export function snapshotTransport(): TimelineTransportSnapshot {
  return {
    isPlaying: timelineState.isPlaying,
    shuttleDirection: timelineState.shuttleDirection,
    shuttleSpeed: timelineState.shuttleSpeed,
  };
}

export function restoreTransport(snapshot: TimelineTransportSnapshot) {
  timelineState.isPlaying = snapshot.isPlaying;
  timelineState.shuttleDirection = snapshot.shuttleDirection;
  timelineState.shuttleSpeed = snapshot.shuttleSpeed;
}

export function setMinZoom(level: number) {
  if (!Number.isFinite(level)) return;
  const nextMinZoom = Math.max(MIN_ALLOWED_ZOOM, Math.min(MAX_ALLOWED_ZOOM, level));
  timelineState.minZoomLevel = nextMinZoom;
  if (timelineState.zoomLevel < nextMinZoom) {
    timelineState.zoomLevel = nextMinZoom;
  }
}

export function setZoom(level: number) {
  timelineState.zoomLevel = Math.max(timelineState.minZoomLevel, Math.min(MAX_ALLOWED_ZOOM, level));
}

export function setScroll(position: number) {
  timelineState.scrollPosition = Math.max(0, position);
}

export function zoomIn() {
  setZoom(timelineState.zoomLevel * 1.2);
}

export function zoomOut() {
  setZoom(timelineState.zoomLevel / 1.2);
}

export function zoomToFit() {
  const duration = getTotalDuration();
  if (duration > 0) {
    // Assume viewport width of 1000px for default
    const targetZoom = 1000 / duration;
    setZoom(targetZoom);
  }
}

export function togglePlayback() {
  if (timelineState.isPlaying) {
    stopShuttle();
    return;
  }

  timelineState.isPlaying = true;
  timelineState.shuttleDirection = 1;
  timelineState.shuttleSpeed = 1;
}

export function setPlaying(playing: boolean) {
  timelineState.isPlaying = playing;
  if (!playing) {
    timelineState.shuttleDirection = 0;
    timelineState.shuttleSpeed = 1;
    return;
  }

  if (timelineState.shuttleDirection === 0) {
    timelineState.shuttleDirection = 1;
    timelineState.shuttleSpeed = 1;
  }
}

export function stopShuttle() {
  timelineState.isPlaying = false;
  timelineState.shuttleDirection = 0;
  timelineState.shuttleSpeed = 1;
}

export function shuttleForward() {
  if (timelineState.shuttleDirection !== 1) {
    timelineState.shuttleDirection = 1;
    timelineState.shuttleSpeed = 1;
    timelineState.isPlaying = true;
    return;
  }

  timelineState.shuttleSpeed = nextShuttleSpeed(timelineState.shuttleSpeed);
  timelineState.isPlaying = true;
}

export function shuttleReverse() {
  if (timelineState.shuttleDirection !== -1) {
    timelineState.shuttleDirection = -1;
    timelineState.shuttleSpeed = 1;
    timelineState.isPlaying = true;
    return;
  }

  timelineState.shuttleSpeed = nextShuttleSpeed(timelineState.shuttleSpeed);
  timelineState.isPlaying = true;
}

export function setExcludeCutContent(enabled: boolean) {
  timelineState.excludeCutContent = enabled;
}

export function toggleExcludeCutContent() {
  timelineState.excludeCutContent = !timelineState.excludeCutContent;
}

export function setLoading(loading: boolean) {
  timelineState.isLoading = loading;
}

export function setError(error: string | null) {
  timelineState.error = error;
}

export function clearTimeline() {
  timelineState.projectId = null;
  timelineState.clips = [];
  timelineState.minZoomLevel = 10;
  timelineState.zoomLevel = 100;
  timelineState.scrollPosition = 0;
  timelineState.playheadTime = 0;
  timelineState.selectedClipIds = new Set();
  timelineState.isPlaying = false;
  timelineState.shuttleDirection = 0;
  timelineState.shuttleSpeed = 1;
  timelineState.excludeCutContent = false;
  timelineState.isLoading = false;
  timelineState.error = null;
}

// Convert state for IPC/database
export function getTimelineStateForSave(): Omit<TimelineState, 'selected_clip_ids'> & { selected_clip_ids: number[] } | null {
  if (timelineState.projectId === null) return null;
  
  return {
    project_id: timelineState.projectId,
    zoom_level: timelineState.zoomLevel,
    scroll_position: timelineState.scrollPosition,
    playhead_time: timelineState.playheadTime,
    selected_clip_ids: Array.from(timelineState.selectedClipIds),
  };
}
