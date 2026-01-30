import { 
  getAssetsByProject as ipcGetAssets, 
  addAsset as ipcAddAsset, 
  getClipsByProject as ipcGetClips, 
  createClip as ipcCreateClip, 
  updateClip as ipcUpdateClip, 
  deleteClip as ipcDeleteClip, 
  loadTimelineState as ipcLoadTimelineState, 
  saveTimelineState as ipcSaveTimelineState, 
  exportProject as ipcExportProject, 
  generateWaveform as ipcGenerateWaveform, 
  getWaveform as ipcGetWaveform,
  type WaveformGenerationResult,
  type GetAssetsResult, 
  type AddAssetResult, 
  type GetClipsResult, 
  type CreateClipResult, 
  type TimelineStateResult, 
  type ExportResult, 
  type WaveformResult 
} from './electron.svelte';
import type { Asset, Clip, TimelineState } from '../../../shared/types/database';
import { timelineState, loadTimeline, setClips, createClip, updateClip, deleteClip, setLoading, setError, clearTimeline } from './timeline.svelte';
import { executeCommand, MoveClipCommand, ResizeClipCommand, DeleteClipCommand, clearHistory } from './undo-redo.svelte';

// Project detail state
export const projectDetail = $state({
  projectId: null as number | null,
  assets: [] as Asset[],
  isLoadingAssets: false,
  isLoadingClips: false,
  isGeneratingWaveform: false,
  waveformProgress: { assetId: 0, tier: 0, percent: 0, status: '' },
  exportFormats: [
    { id: 'fcpxml', name: 'FCPXML', description: 'Final Cut Pro', extension: '.fcpxml' },
    { id: 'json', name: 'JSON', description: 'Internal format', extension: '.json' },
    { id: 'edl', name: 'EDL', description: 'Edit Decision List', extension: '.edl' },
  ] as Array<{ id: string; name: string; description: string; extension: string }>,
});

// Load project data (assets, clips, timeline state)
export async function loadProjectDetail(projectId: number) {
  projectDetail.projectId = projectId;
  projectDetail.isLoadingAssets = true;
  projectDetail.isLoadingClips = true;
  
  try {
    // Load assets
    const assetsResult: GetAssetsResult = await ipcGetAssets(projectId);
    if (assetsResult.success && assetsResult.data) {
      projectDetail.assets = assetsResult.data;
    }
    
    // Load clips
    const clipsResult: GetClipsResult = await ipcGetClips(projectId);
    if (clipsResult.success && clipsResult.data) {
      setClips(clipsResult.data);
    }
    
    // Load timeline state
    const stateResult: TimelineStateResult = await ipcLoadTimelineState(projectId);
    if (stateResult.success && stateResult.data) {
      loadTimeline(projectId, clipsResult.data || [], stateResult.data);
    } else {
      loadTimeline(projectId, clipsResult.data || [], null);
    }
    
    // Clear undo history when loading new project
    clearHistory();
    
  } catch (error) {
    setError((error as Error).message);
  } finally {
    projectDetail.isLoadingAssets = false;
    projectDetail.isLoadingClips = false;
  }
}

// Add asset to project
export async function addAssetToProject(projectId: number, filePath: string): Promise<Asset | null> {
  try {
    const result: AddAssetResult = await ipcAddAsset(projectId, filePath);
    if (result.success && result.data) {
      projectDetail.assets = [result.data, ...projectDetail.assets];
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to add asset');
    }
  } catch (error) {
    setError((error as Error).message);
    return null;
  }
}

// Create clip from beat or manual selection
export async function createProjectClip(
  projectId: number,
  assetId: number,
  trackIndex: number,
  startTime: number,
  inPoint: number,
  outPoint: number,
  role?: string,
  description?: string,
  isEssential: boolean = true
): Promise<Clip | null> {
  try {
    const result: CreateClipResult = await ipcCreateClip({
      projectId,
      assetId,
      trackIndex,
      startTime,
      inPoint,
      outPoint,
      role: role as any,
      description,
      isEssential,
    });
    
    if (result.success && result.data) {
      createClip(result.data);
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to create clip');
    }
  } catch (error) {
    setError((error as Error).message);
    return null;
  }
}

// Update clip (save to backend)
export async function updateProjectClip(id: number, updates: Partial<Clip>): Promise<boolean> {
  try {
    const result = await ipcUpdateClip(id, updates);
    if (result.success) {
      updateClip(id, updates);
      return true;
    } else {
      throw new Error(result.error || 'Failed to update clip');
    }
  } catch (error) {
    setError((error as Error).message);
    return false;
  }
}

// Delete clip (save to backend)
export async function deleteProjectClip(id: number): Promise<boolean> {
  try {
    const result = await ipcDeleteClip(id);
    if (result.success) {
      deleteClip(id);
      return true;
    } else {
      throw new Error(result.error || 'Failed to delete clip');
    }
  } catch (error) {
    setError((error as Error).message);
    return false;
  }
}

// Execute move command and save to backend
export async function executeMoveClip(clipId: number, oldStartTime: number, newStartTime: number) {
  const command = new MoveClipCommand('Move clip', clipId, oldStartTime, newStartTime);
  executeCommand(command);
  
  // Save to backend
  await updateProjectClip(clipId, { start_time: newStartTime });
}

// Execute resize command and save to backend
export async function executeResizeClip(
  clipId: number,
  oldInPoint: number,
  oldOutPoint: number,
  newInPoint: number,
  newOutPoint: number
) {
  const command = new ResizeClipCommand('Resize clip', clipId, oldInPoint, oldOutPoint, newInPoint, newOutPoint);
  executeCommand(command);
  
  // Save to backend
  await updateProjectClip(clipId, { in_point: newInPoint, out_point: newOutPoint });
}

// Execute delete command and save to backend
export async function executeDeleteClip(clipId: number) {
  const command = new DeleteClipCommand('Delete clip', clipId);
  executeCommand(command);
  
  // Save to backend
  await deleteProjectClip(clipId);
}

// Save timeline state
export async function saveProjectTimelineState() {
  if (!projectDetail.projectId) return;
  
  const state = {
    project_id: projectDetail.projectId,
    zoom_level: timelineState.zoomLevel,
    scroll_position: timelineState.scrollPosition,
    playhead_time: timelineState.playheadTime,
    selected_clip_ids: Array.from(timelineState.selectedClipIds),
  };
  
  try {
    await ipcSaveTimelineState(state);
  } catch (error) {
    console.error('Failed to save timeline state:', error);
  }
}

// Generate waveform for asset
export async function generateAssetWaveform(assetId: number, trackIndex: number = 0) {
  projectDetail.isGeneratingWaveform = true;
  projectDetail.waveformProgress = { assetId, tier: 0, percent: 0, status: 'Starting...' };
  
  try {
    // Listen for progress events
    const progressHandler = (event: any, data: any) => {
      if (data.assetId === assetId) {
        projectDetail.waveformProgress = {
          assetId,
          tier: data.progress?.tier || 0,
          percent: data.progress?.percent || 0,
          status: data.progress?.status || 'Processing...',
        };
      }
    };
    
    // Start generation
    const result: WaveformGenerationResult = await ipcGenerateWaveform(assetId, trackIndex);
    
    if (result.success) {
      projectDetail.waveformProgress = { assetId, tier: 0, percent: 100, status: 'Complete' };
    } else {
      throw new Error(result.error || 'Failed to generate waveform');
    }
  } catch (error) {
    setError((error as Error).message);
  } finally {
    projectDetail.isGeneratingWaveform = false;
  }
}

// Get cached waveform
export async function getAssetWaveform(assetId: number, trackIndex: number, tierLevel: number) {
  try {
    const result = await ipcGetWaveform(assetId, trackIndex, tierLevel);
    if (result.success && result.data) {
      return result.data;
    }
    return null;
  } catch (error) {
    console.error('Failed to get waveform:', error);
    return null;
  }
}

// Export project
export async function exportProjectToFile(projectId: number, format: string, filePath: string): Promise<boolean> {
  try {
    const result: ExportResult = await ipcExportProject(projectId, format, filePath);
    if (result.success) {
      return true;
    } else {
      throw new Error(result.error || 'Export failed');
    }
  } catch (error) {
    setError((error as Error).message);
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
