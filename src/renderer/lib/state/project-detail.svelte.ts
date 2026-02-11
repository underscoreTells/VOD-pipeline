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
  onWaveformProgress,
  type WaveformGenerateOptions,
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
import { timelineState, loadTimeline, setClips, createClip, updateClip, setError, clearTimeline, getClipById } from './timeline.svelte';
import {
  executeCommand,
  MoveClipCommand,
  ResizeClipCommand,
  UpdateClipTimingCommand,
  DeleteClipCommand,
  clearHistory,
} from './undo-redo.svelte';

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

const deletingClipIds = new Set<number>();
const MIX_WAVEFORM_TRACK_INDEX = -1;

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

async function reloadProjectClipsFromBackend(): Promise<boolean> {
  const projectId = projectDetail.projectId;
  if (!projectId) return false;

  try {
    const clipsResult: GetClipsResult = await ipcGetClips(projectId);
    if (clipsResult.success && clipsResult.data) {
      setClips(clipsResult.data);
      return true;
    }
  } catch (error) {
    console.warn('Failed to reload clips after delete failure:', error);
  }

  return false;
}

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
    } else if (!assetsResult.success) {
      setError(assetsResult.error || 'Failed to load assets');
    }
    
    // Load clips
    const clipsResult: GetClipsResult = await ipcGetClips(projectId);
    if (clipsResult.success && clipsResult.data) {
      setClips(clipsResult.data);
    } else if (!clipsResult.success) {
      setError(clipsResult.error || 'Failed to load clips');
    }
    
    // Load timeline state
    const stateResult: TimelineStateResult = await ipcLoadTimelineState(projectId);
    if (stateResult.success && stateResult.data) {
      loadTimeline(projectId, clipsResult.data || [], stateResult.data);
    } else if (!stateResult.success) {
      setError(stateResult.error || 'Failed to load timeline state');
      loadTimeline(projectId, clipsResult.data || [], null);
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
  role?: Clip['role'],
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
      role,
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

// Delete clip (backend only - local state handled by command)
export async function deleteProjectClip(id: number): Promise<boolean> {
  try {
    const result = await ipcDeleteClip(id);
    if (result.success) {
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
  const success = await executeCommand(command);
  if (!success) {
    setError('Failed to move clip');
  }
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
  const success = await executeCommand(command);
  if (!success) {
    setError('Failed to resize clip');
  }
}

export async function executeUpdateClipTiming(
  clipId: number,
  oldStartTime: number,
  oldInPoint: number,
  oldOutPoint: number,
  newStartTime: number,
  newInPoint: number,
  newOutPoint: number
) {
  const command = new UpdateClipTimingCommand(
    'Adjust clip timing',
    clipId,
    oldStartTime,
    oldInPoint,
    oldOutPoint,
    newStartTime,
    newInPoint,
    newOutPoint
  );
  const success = await executeCommand(command);
  if (!success) {
    setError('Failed to adjust clip timing');
  }
}

// Execute delete command and save to backend
export async function executeDeleteClip(clipId: number) {
  if (deletingClipIds.has(clipId)) return;

  // Capture clip data BEFORE deletion
  const clip = getClipById(clipId);
  if (!clip) return;

  deletingClipIds.add(clipId);

  try {
    let command: DeleteClipCommand;
    try {
      // Create command with captured snapshot
      command = new DeleteClipCommand('Delete clip', clipId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`Failed to prepare clip deletion: ${message}`);
      return;
    }

    const success = await executeCommand(command);
    if (success) {
      if (getClipById(clipId)) {
        const reloaded = await reloadProjectClipsFromBackend();
        if (!reloaded) {
          setError('Deleted clip but failed to refresh timeline');
        }
      }
      return;
    }

    const reloaded = await reloadProjectClipsFromBackend();
    if (!reloaded) {
      setError('Failed to delete clip');
    }
  } finally {
    deletingClipIds.delete(clipId);
  }
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
export async function generateAssetWaveform(
  assetId: number,
  trackIndex: number = 0,
  options: WaveformGenerateOptions = {}
) {
  const asset = projectDetail.assets.find((item) => item.id === assetId) ?? null;
  const audioTrackCount = (() => {
    const count = asset?.metadata?.audioTracks?.length;
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) {
      return count;
    }
    return 1;
  })();

  const isMkvMultiTrackMixRequest =
    trackIndex === MIX_WAVEFORM_TRACK_INDEX &&
    audioTrackCount > 1 &&
    Boolean(options.includeSourceTracks) &&
    Boolean(asset?.file_path?.toLowerCase().endsWith('.mkv'));

  const expectedTrackIndices = isMkvMultiTrackMixRequest
    ? [MIX_WAVEFORM_TRACK_INDEX, ...Array.from({ length: audioTrackCount }, (_, index) => index)]
    : [trackIndex];

  const perTrackTier1Progress = new Map<number, number>();
  let displayedPercent = 0;

  const updateProgress = (nextPercent: number, tier: number, status: string) => {
    const clampedPercent = clampPercent(nextPercent);
    const percent = Math.max(displayedPercent, clampedPercent);
    displayedPercent = percent;

    projectDetail.waveformProgress = {
      assetId,
      tier,
      percent,
      status,
    };
  };

  projectDetail.isGeneratingWaveform = true;
  projectDetail.waveformProgress = { assetId, tier: 0, percent: 0, status: 'Starting...' };
  const unsubscribe = onWaveformProgress((event) => {
    if (event.assetId !== assetId) return;
    const eventTrackIndex = event.trackIndex ?? event.progress.trackIndex ?? trackIndex;

    if (isMkvMultiTrackMixRequest) {
      if (event.progress.tier !== 1) {
        return;
      }

      if (event.progress.percent <= 10) {
        updateProgress(event.progress.percent, event.progress.tier, event.progress.status);
        return;
      }

      if (!expectedTrackIndices.includes(eventTrackIndex)) {
        return;
      }

      const previousTrackPercent = perTrackTier1Progress.get(eventTrackIndex) ?? 20;
      const nextTrackPercent = Math.max(previousTrackPercent, clampPercent(event.progress.percent));
      perTrackTier1Progress.set(eventTrackIndex, nextTrackPercent);

      const normalizedAverage = expectedTrackIndices.reduce((sum, currentTrackIndex) => {
        const trackPercent = perTrackTier1Progress.get(currentTrackIndex) ?? 20;
        const normalized = Math.max(0, Math.min(1, (trackPercent - 20) / 80));
        return sum + normalized;
      }, 0) / expectedTrackIndices.length;

      const aggregatedPercent = 10 + (normalizedAverage * 90);
      updateProgress(aggregatedPercent, event.progress.tier, event.progress.status);
      return;
    }

    if (eventTrackIndex !== trackIndex) return;

    updateProgress(event.progress.percent, event.progress.tier, event.progress.status);
  });
  
  try {
    // Start generation
    const result: WaveformGenerationResult = await ipcGenerateWaveform(assetId, trackIndex, options);
    
    if (result.success) {
      projectDetail.waveformProgress = { assetId, tier: 0, percent: 100, status: 'Complete' };
    } else {
      throw new Error(result.error || 'Failed to generate waveform');
    }
  } catch (error) {
    setError((error as Error).message);
  } finally {
    unsubscribe();
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
