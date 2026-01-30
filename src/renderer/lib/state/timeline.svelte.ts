import type { Clip, TimelineState } from '../../../shared/types/database';

// Timeline state using Svelte 5 runes
export const timelineState = $state({
  projectId: null as number | null,
  clips: [] as Clip[],
  zoomLevel: 100,        // pixels per second
  scrollPosition: 0,     // seconds from start
  playheadTime: 0,       // current position
  selectedClipIds: new Set<number>(),
  isPlaying: false,
  isLoading: false,
  error: null as string | null,
});

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

  if (state) {
    timelineState.zoomLevel = state.zoom_level;
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
  timelineState.selectedClipIds.delete(id);
}

export function selectClip(id: number, multiSelect: boolean = false) {
  if (multiSelect) {
    if (timelineState.selectedClipIds.has(id)) {
      timelineState.selectedClipIds.delete(id);
    } else {
      timelineState.selectedClipIds.add(id);
    }
  } else {
    timelineState.selectedClipIds.clear();
    timelineState.selectedClipIds.add(id);
  }
}

export function clearSelection() {
  timelineState.selectedClipIds.clear();
}

export function selectAll() {
  timelineState.selectedClipIds = new Set(timelineState.clips.map(c => c.id));
}

export function setPlayhead(time: number) {
  timelineState.playheadTime = time;
}

export function setZoom(level: number) {
  timelineState.zoomLevel = Math.max(10, Math.min(1000, level));
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
  timelineState.isPlaying = !timelineState.isPlaying;
}

export function setPlaying(playing: boolean) {
  timelineState.isPlaying = playing;
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
  timelineState.zoomLevel = 100;
  timelineState.scrollPosition = 0;
  timelineState.playheadTime = 0;
  timelineState.selectedClipIds.clear();
  timelineState.isPlaying = false;
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
