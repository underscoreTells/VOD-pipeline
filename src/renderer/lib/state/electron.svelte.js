// ============================================================================
// Preload Verification
// ============================================================================
// Check if electronAPI is available (set by preload script)
if (typeof window === 'undefined' || !window.electronAPI) {
    console.error('[Renderer] window.electronAPI is not defined!');
    console.error('[Renderer] This usually means the preload script failed to load.');
    console.error('[Renderer] Check the main process console for preload-error messages.');
}
export async function createProject(name) {
    return await window.electronAPI.projects.create(name);
}
export async function getProjects() {
    return await window.electronAPI.projects.getAll();
}
export async function getProject(id) {
    return await window.electronAPI.projects.get(id);
}
export async function getAssetsByProject(projectId) {
    return await window.electronAPI.assets.getByProject(projectId);
}
export async function addAsset(projectId, filePath, proxyOptions) {
    return await window.electronAPI.assets.add(projectId, filePath, proxyOptions);
}
export async function getClipsByProject(projectId) {
    return await window.electronAPI.clips.getByProject(projectId);
}
export async function createClip(input) {
    return await window.electronAPI.clips.create(input);
}
export async function updateClip(id, updates) {
    return await window.electronAPI.clips.update(id, updates);
}
export async function deleteClip(id) {
    return await window.electronAPI.clips.delete(id);
}
export async function loadTimelineState(projectId) {
    return await window.electronAPI.timeline.loadState(projectId);
}
export async function saveTimelineState(state) {
    return await window.electronAPI.timeline.saveState(state);
}
export async function getWaveform(assetId, trackIndex, tierLevel) {
    return await window.electronAPI.waveforms.get(assetId, trackIndex, tierLevel);
}
export async function generateWaveform(assetId, trackIndex) {
    return await window.electronAPI.waveforms.generate(assetId, trackIndex);
}
export function onWaveformProgress(callback) {
    return window.electronAPI.waveforms.onProgress(callback);
}
export async function exportProject(projectId, format, filePath) {
    return await window.electronAPI.exports.generate(projectId, format, filePath);
}
export async function transcribeChapter(chapterId, options) {
    return await window.electronAPI.transcription?.transcribe(chapterId, options) ||
        { success: false, error: 'Transcription not available' };
}
export {};
