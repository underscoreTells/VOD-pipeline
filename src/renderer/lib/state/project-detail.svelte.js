import { getAssetsByProject as ipcGetAssets, addAsset as ipcAddAsset, getClipsByProject as ipcGetClips, createClip as ipcCreateClip, updateClip as ipcUpdateClip, deleteClip as ipcDeleteClip, loadTimelineState as ipcLoadTimelineState, saveTimelineState as ipcSaveTimelineState, exportProject as ipcExportProject, generateWaveform as ipcGenerateWaveform, getWaveform as ipcGetWaveform, onWaveformProgress } from './electron.svelte';
import { timelineState, loadTimeline, setClips, createClip, updateClip, deleteClip, setLoading, setError, clearTimeline, getClipById } from './timeline.svelte';
import { executeCommand, MoveClipCommand, ResizeClipCommand, DeleteClipCommand, clearHistory } from './undo-redo.svelte';
// Project detail state
export const projectDetail = $state({
    projectId: null,
    assets: [],
    isLoadingAssets: false,
    isLoadingClips: false,
    isGeneratingWaveform: false,
    waveformProgress: { assetId: 0, tier: 0, percent: 0, status: '' },
    exportFormats: [
        { id: 'fcpxml', name: 'FCPXML', description: 'Final Cut Pro', extension: '.fcpxml' },
        { id: 'json', name: 'JSON', description: 'Internal format', extension: '.json' },
        { id: 'edl', name: 'EDL', description: 'Edit Decision List', extension: '.edl' },
    ],
});
// Load project data (assets, clips, timeline state)
export async function loadProjectDetail(projectId) {
    projectDetail.projectId = projectId;
    projectDetail.isLoadingAssets = true;
    projectDetail.isLoadingClips = true;
    try {
        // Load assets
        const assetsResult = await ipcGetAssets(projectId);
        if (assetsResult.success && assetsResult.data) {
            projectDetail.assets = assetsResult.data;
        }
        else if (!assetsResult.success) {
            setError(assetsResult.error || 'Failed to load assets');
        }
        // Load clips
        const clipsResult = await ipcGetClips(projectId);
        if (clipsResult.success && clipsResult.data) {
            setClips(clipsResult.data);
        }
        else if (!clipsResult.success) {
            setError(clipsResult.error || 'Failed to load clips');
        }
        // Load timeline state
        const stateResult = await ipcLoadTimelineState(projectId);
        if (stateResult.success && stateResult.data) {
            loadTimeline(projectId, clipsResult.data || [], stateResult.data);
        }
        else if (!stateResult.success) {
            setError(stateResult.error || 'Failed to load timeline state');
            loadTimeline(projectId, clipsResult.data || [], null);
        }
        else {
            loadTimeline(projectId, clipsResult.data || [], null);
        }
        // Clear undo history when loading new project
        clearHistory();
    }
    catch (error) {
        setError(error.message);
    }
    finally {
        projectDetail.isLoadingAssets = false;
        projectDetail.isLoadingClips = false;
    }
}
// Add asset to project
export async function addAssetToProject(projectId, filePath) {
    try {
        const result = await ipcAddAsset(projectId, filePath);
        if (result.success && result.data) {
            projectDetail.assets = [result.data, ...projectDetail.assets];
            return result.data;
        }
        else {
            throw new Error(result.error || 'Failed to add asset');
        }
    }
    catch (error) {
        setError(error.message);
        return null;
    }
}
// Create clip from beat or manual selection
export async function createProjectClip(projectId, assetId, trackIndex, startTime, inPoint, outPoint, role, description, isEssential = true) {
    try {
        const result = await ipcCreateClip({
            projectId,
            assetId,
            trackIndex,
            startTime,
            inPoint,
            outPoint,
            role,
            description,
            isEssential,
        });
        if (result.success && result.data) {
            createClip(result.data);
            return result.data;
        }
        else {
            throw new Error(result.error || 'Failed to create clip');
        }
    }
    catch (error) {
        setError(error.message);
        return null;
    }
}
// Update clip (save to backend)
export async function updateProjectClip(id, updates) {
    try {
        const result = await ipcUpdateClip(id, updates);
        if (result.success) {
            updateClip(id, updates);
            return true;
        }
        else {
            throw new Error(result.error || 'Failed to update clip');
        }
    }
    catch (error) {
        setError(error.message);
        return false;
    }
}
// Delete clip (backend only - local state handled by command)
export async function deleteProjectClip(id) {
    try {
        const result = await ipcDeleteClip(id);
        if (result.success) {
            return true;
        }
        else {
            throw new Error(result.error || 'Failed to delete clip');
        }
    }
    catch (error) {
        setError(error.message);
        return false;
    }
}
// Execute move command and save to backend
export async function executeMoveClip(clipId, oldStartTime, newStartTime) {
    // Save to backend first
    const success = await updateProjectClip(clipId, { start_time: newStartTime });
    if (success) {
        // Only update UI/undo stack if backend save succeeded
        const command = new MoveClipCommand('Move clip', clipId, oldStartTime, newStartTime);
        executeCommand(command);
    }
}
// Execute resize command and save to backend
export async function executeResizeClip(clipId, oldInPoint, oldOutPoint, newInPoint, newOutPoint) {
    // Save to backend first
    const success = await updateProjectClip(clipId, { in_point: newInPoint, out_point: newOutPoint });
    if (success) {
        // Only update UI/undo stack if backend save succeeded
        const command = new ResizeClipCommand('Resize clip', clipId, oldInPoint, oldOutPoint, newInPoint, newOutPoint);
        executeCommand(command);
    }
}
// Execute delete command and save to backend
export async function executeDeleteClip(clipId) {
    // Capture clip data BEFORE deletion
    const clip = getClipById(clipId);
    if (!clip)
        return;
    // Create command with captured snapshot
    const command = new DeleteClipCommand('Delete clip', clipId);
    // Save to backend
    const success = await deleteProjectClip(clipId);
    if (success) {
        // Execute command to update local state and add to undo stack
        executeCommand(command);
    }
}
// Save timeline state
export async function saveProjectTimelineState() {
    if (!projectDetail.projectId)
        return;
    const state = {
        project_id: projectDetail.projectId,
        zoom_level: timelineState.zoomLevel,
        scroll_position: timelineState.scrollPosition,
        playhead_time: timelineState.playheadTime,
        selected_clip_ids: Array.from(timelineState.selectedClipIds),
    };
    try {
        await ipcSaveTimelineState(state);
    }
    catch (error) {
        console.error('Failed to save timeline state:', error);
    }
}
// Generate waveform for asset
export async function generateAssetWaveform(assetId, trackIndex = 0) {
    projectDetail.isGeneratingWaveform = true;
    projectDetail.waveformProgress = { assetId, tier: 0, percent: 0, status: 'Starting...' };
    const unsubscribe = onWaveformProgress((event) => {
        if (event.assetId !== assetId)
            return;
        projectDetail.waveformProgress = {
            assetId: event.assetId,
            tier: event.progress.tier,
            percent: event.progress.percent,
            status: event.progress.status,
        };
    });
    try {
        // Start generation
        const result = await ipcGenerateWaveform(assetId, trackIndex);
        if (result.success) {
            projectDetail.waveformProgress = { assetId, tier: 0, percent: 100, status: 'Complete' };
        }
        else {
            throw new Error(result.error || 'Failed to generate waveform');
        }
    }
    catch (error) {
        setError(error.message);
    }
    finally {
        unsubscribe();
        projectDetail.isGeneratingWaveform = false;
    }
}
// Get cached waveform
export async function getAssetWaveform(assetId, trackIndex, tierLevel) {
    try {
        const result = await ipcGetWaveform(assetId, trackIndex, tierLevel);
        if (result.success && result.data) {
            return result.data;
        }
        return null;
    }
    catch (error) {
        console.error('Failed to get waveform:', error);
        return null;
    }
}
// Export project
export async function exportProjectToFile(projectId, format, filePath) {
    try {
        const result = await ipcExportProject(projectId, format, filePath);
        if (result.success) {
            return true;
        }
        else {
            throw new Error(result.error || 'Export failed');
        }
    }
    catch (error) {
        setError(error.message);
        return false;
    }
}
// Clear project detail
export function clearProjectDetail() {
    projectDetail.projectId = null;
    projectDetail.assets = [];
    projectDetail.isLoadingAssets = false;
    projectDetail.isLoadingClips = false;
    clearTimeline();
    clearHistory();
}
