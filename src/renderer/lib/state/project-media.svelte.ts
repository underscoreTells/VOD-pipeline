import { addAsset as ipcAddAsset, getAssetsByProject as ipcGetAssets, type AddAssetResult, type GetAssetsResult } from '../api/assets.js';
import {
  createClip as ipcCreateClip,
  deleteClip as ipcDeleteClip,
  getClipsByProject as ipcGetClips,
  updateClip as ipcUpdateClip,
  type CreateClipResult,
  type GetClipsResult,
} from '../api/clips.js';
import { loadTimelineState as ipcLoadTimelineState, saveTimelineState as ipcSaveTimelineState, type TimelineStateResult } from '../api/timeline.js';
import type { Asset, Clip, TimelineState } from '../../../shared/types/database';
import type { AssetAvailability, ProjectAsset } from '../../../shared/contracts/ipc.js';
import { timelineState, loadTimeline, setClips, createClip, updateClip, setError, clearTimeline, getClipById } from './timeline.svelte';
import {
  executeCommand,
  ResizeClipCommand,
  UpdateClipTimingCommand,
  DeleteClipCommand,
  SplitClipCommand,
  clearHistory,
} from './undo-redo.svelte';
import {
  clipOverlapsChapterSourceRange,
  splitClipAtSourceTime,
} from '../../../shared/utils/clip-timing.js';
import { chaptersState, getSelectedChapter } from './chapters.svelte';
import { settingsState } from './settings.svelte';
import { buildProviderConfig } from './settings-helpers.js';
import {
  configureClipAutoNameQueue,
  enqueueClipAutoName,
  enqueueUnnamedClips,
  hasClipDescription,
  processClipAutoNameQueue,
  resetClipAutoNameState,
} from './clip-auto-name.svelte.js';

// Project detail state
export const projectDetail = $state({
  projectId: null as number | null,
  assets: [] as ProjectAsset[],
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
const MIN_SPLIT_SEGMENT_DURATION = 0.05;

function createAssetAvailability(filePath: string): AssetAvailability {
  return {
    exists: true,
    issue: null,
    savedPath: filePath,
    nearestExistingAncestor: null,
    checkedAt: new Date().toISOString(),
  };
}

function toProjectAsset(asset: Asset): ProjectAsset {
  return {
    ...asset,
    availability: createAssetAvailability(asset.file_path),
  };
}

export function isAssetAvailable(assetId: number): boolean {
  const asset = projectDetail.assets.find((item) => item.id === assetId) ?? null;
  return asset?.availability.exists !== false;
}

export function getMissingProjectAssets(): ProjectAsset[] {
  return projectDetail.assets.filter((asset) => asset.availability.exists === false);
}

function resolveChapterForClip(clip: Clip) {
  for (const chapter of chaptersState.chapters) {
    const assetIds = chaptersState.chapterAssets.get(chapter.id) ?? [];
    if (!assetIds.includes(clip.asset_id)) continue;
    if (clipOverlapsChapterSourceRange(clip, chapter)) return chapter;
  }

  return getSelectedChapter();
}

configureClipAutoNameQueue(() => ({
  projectId: projectDetail.projectId,
  settings: {
    autoClipNamingEnabled: settingsState.settings.autoClipNamingEnabled,
    autoClipNamingModel: settingsState.settings.autoClipNamingModel,
    providerConfig: buildProviderConfig(settingsState.settings),
  },
  getClipById,
  resolveChapterForClip,
  applyGeneratedDescription: async (clipId, description) => {
    const result = await ipcUpdateClip(clipId, { description });
    if (!result.success) {
      setError(result.error || 'Failed to update clip');
      return false;
    }

    updateClip(clipId, { description });
    return true;
  },
}));

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
  resetClipAutoNameState();
  
  try {
    let loadedClips: Clip[] = [];

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
      loadedClips = clipsResult.data;
      setClips(loadedClips);
      enqueueUnnamedClips(loadedClips.filter((clip) => isAssetAvailable(clip.asset_id)));
    } else if (!clipsResult.success) {
      setError(clipsResult.error || 'Failed to load clips');
    }
    
    // Load timeline state
    const stateResult: TimelineStateResult = await ipcLoadTimelineState(projectId);
    if (stateResult.success && stateResult.data) {
      loadTimeline(projectId, loadedClips, stateResult.data);
    } else if (!stateResult.success) {
      setError(stateResult.error || 'Failed to load timeline state');
      loadTimeline(projectId, loadedClips, null);
    } else {
      loadTimeline(projectId, loadedClips, null);
    }
    
    // Clear undo history when loading new project
    clearHistory();
    void processClipAutoNameQueue();
    
  } catch (error) {
    setError((error as Error).message);
  } finally {
    projectDetail.isLoadingAssets = false;
    projectDetail.isLoadingClips = false;
  }
}

// Add asset to project
export async function addAssetToProject(projectId: number, filePath: string): Promise<ProjectAsset | null> {
  try {
    const result: AddAssetResult = await ipcAddAsset(projectId, filePath);
    if (result.success && result.data) {
      const projectAsset = toProjectAsset(result.data);
      projectDetail.assets = [projectAsset, ...projectDetail.assets];
      return projectAsset;
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
      inPoint,
      outPoint,
      role,
      description,
      isEssential,
    });
    
    if (result.success && result.data) {
      createClip(result.data);
      if (!hasClipDescription(result.data) && isAssetAvailable(result.data.asset_id)) {
        enqueueClipAutoName(result.data.id);
        void processClipAutoNameQueue();
      }
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

// Slide a clip's source window while preserving duration
export async function executeSlideClipWindow(
  clipId: number,
  oldInPoint: number,
  oldOutPoint: number,
  newInPoint: number,
  newOutPoint: number
) {
  const command = new UpdateClipTimingCommand(
    'Slide source window',
    clipId,
    oldInPoint,
    oldOutPoint,
    newInPoint,
    newOutPoint
  );
  const success = await executeCommand(command);
  if (!success) {
    setError('Failed to slide clip source window');
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
  oldInPoint: number,
  oldOutPoint: number,
  newInPoint: number,
  newOutPoint: number
) {
  const command = new UpdateClipTimingCommand(
    'Adjust clip window',
    clipId,
    oldInPoint,
    oldOutPoint,
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

export async function executeSplitClip(clipId: number, splitTime: number) {
  const clip = getClipById(clipId);
  if (!clip) return;
  const existingClipIds = new Set(timelineState.clips.map((item) => item.id));

  const splitWindow = splitClipAtSourceTime({
    inPoint: clip.in_point,
    outPoint: clip.out_point,
    splitTime,
    minDuration: MIN_SPLIT_SEGMENT_DURATION,
  });
  if (!splitWindow) {
    return;
  }

  const command = new SplitClipCommand('Split clip', { ...clip }, splitTime);
  const success = await executeCommand(command);
  if (!success) {
    setError('Failed to split clip');
    return;
  }

  for (const candidate of timelineState.clips) {
    if (existingClipIds.has(candidate.id)) continue;
    if (hasClipDescription(candidate)) continue;
    enqueueClipAutoName(candidate.id);
  }

  void processClipAutoNameQueue();
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

// Clear project detail
export function clearProjectDetail() {
  projectDetail.projectId = null;
  projectDetail.assets = [];
  projectDetail.isLoadingAssets = false;
  projectDetail.isLoadingClips = false;
  resetClipAutoNameState();
  clearTimeline();
  clearHistory();
}
