// Timeline state using Svelte 5 runes
export const timelineState = $state({
    projectId: null,
    clips: [],
    zoomLevel: 100, // pixels per second
    scrollPosition: 0, // seconds from start
    playheadTime: 0, // current position
    selectedClipIds: new Set(),
    isPlaying: false,
    isLoading: false,
    error: null,
});
// Derived state
export function getSelectedClips() {
    return timelineState.clips.filter(clip => timelineState.selectedClipIds.has(clip.id));
}
export function getTotalDuration() {
    if (timelineState.clips.length === 0)
        return 0;
    return Math.max(...timelineState.clips.map(c => c.start_time + (c.out_point - c.in_point)));
}
export function getClipsByTrack() {
    const map = new Map();
    for (const clip of timelineState.clips) {
        const trackClips = map.get(clip.track_index) || [];
        trackClips.push(clip);
        map.set(clip.track_index, trackClips);
    }
    return map;
}
export function getClipById(id) {
    return timelineState.clips.find(clip => clip.id === id);
}
// Actions
export function loadTimeline(projectId, clips, state) {
    timelineState.projectId = projectId;
    timelineState.clips = clips;
    if (state) {
        timelineState.zoomLevel = state.zoom_level;
        timelineState.scrollPosition = state.scroll_position;
        timelineState.playheadTime = state.playhead_time;
        timelineState.selectedClipIds = new Set(state.selected_clip_ids);
    }
    else {
        // Reset view state to defaults when no state is provided
        timelineState.zoomLevel = 100;
        timelineState.scrollPosition = 0;
        timelineState.playheadTime = 0;
        timelineState.selectedClipIds = new Set();
    }
}
export function setClips(clips) {
    timelineState.clips = clips;
}
export function createClip(clip) {
    timelineState.clips = [...timelineState.clips, clip];
}
export function updateClip(id, updates) {
    timelineState.clips = timelineState.clips.map(clip => clip.id === id ? { ...clip, ...updates } : clip);
}
export function deleteClip(id) {
    timelineState.clips = timelineState.clips.filter(clip => clip.id !== id);
    timelineState.selectedClipIds.delete(id);
}
export function selectClip(id, multiSelect = false) {
    if (multiSelect) {
        if (timelineState.selectedClipIds.has(id)) {
            timelineState.selectedClipIds.delete(id);
        }
        else {
            timelineState.selectedClipIds.add(id);
        }
    }
    else {
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
export function setPlayhead(time) {
    timelineState.playheadTime = time;
}
export function setZoom(level) {
    timelineState.zoomLevel = Math.max(10, Math.min(1000, level));
}
export function setScroll(position) {
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
export function setPlaying(playing) {
    timelineState.isPlaying = playing;
}
export function setLoading(loading) {
    timelineState.isLoading = loading;
}
export function setError(error) {
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
export function getTimelineStateForSave() {
    if (timelineState.projectId === null)
        return null;
    return {
        project_id: timelineState.projectId,
        zoom_level: timelineState.zoomLevel,
        scroll_position: timelineState.scrollPosition,
        playhead_time: timelineState.playheadTime,
        selected_clip_ids: Array.from(timelineState.selectedClipIds),
    };
}
