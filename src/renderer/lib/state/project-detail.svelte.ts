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
  suggestClipName,
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
  SplitClipCommand,
  clearHistory,
} from './undo-redo.svelte';
import { chaptersState, getSelectedChapter } from './chapters.svelte';
import { settingsState } from './settings.svelte';

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
const MIN_SPLIT_SEGMENT_DURATION = 0.05;
const AUTO_NAME_RETRY_DELAY_MS = 2000;
const AUTO_NAME_FAILED_RETRY_DELAY_MS = 8000;
const pendingAutoNameClipIds = new Set<number>();
const failedAutoNameClipIds = new Set<number>();
const inFlightAutoNameClipIds = new Set<number>();
let isProcessingAutoNameQueue = false;
let lastAutoNameConfigSignature = '';
let autoNameRetryTimerId: ReturnType<typeof setTimeout> | null = null;

function resolveChapterForClip(clip: Clip) {
  const epsilon = 0.01;
  for (const chapter of chaptersState.chapters) {
    const assetIds = chaptersState.chapterAssets.get(chapter.id) ?? [];
    if (!assetIds.includes(clip.asset_id)) continue;

    const clipIn = clip.in_point;
    const clipOut = clip.out_point;
    if (clipOut <= chapter.start_time + epsilon) continue;
    if (clipIn >= chapter.end_time - epsilon) continue;

    return chapter;
  }

  return getSelectedChapter();
}

function normalizeGeneratedClipDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value
    .replace(/\s+/g, ' ')
    .replace(/^"+|"+$/g, '')
    .trim();
  if (trimmed.length < 3) return null;
  return trimmed.slice(0, 80);
}

function hasClipDescription(clip: Pick<Clip, 'description'> | null | undefined): boolean {
  return typeof clip?.description === 'string' && clip.description.trim().length > 0;
}

type AutoNameClipResult = 'named' | 'deferred' | 'failed';

function getAutoNameConfigSignature(): string {
  return [
    settingsState.settings.autoClipNamingEnabled ? '1' : '0',
    settingsState.settings.autoClipNamingModel,
    settingsState.settings.openaiApiKey,
  ].join(':');
}

function clearAutoNameRetryTimer(): void {
  if (autoNameRetryTimerId === null) return;
  clearTimeout(autoNameRetryTimerId);
  autoNameRetryTimerId = null;
}

function scheduleAutoNameRetry(delayMs: number): void {
  if (autoNameRetryTimerId !== null) {
    return;
  }

  autoNameRetryTimerId = setTimeout(() => {
    autoNameRetryTimerId = null;
    void processAutoNameQueue();
  }, delayMs);
}

async function autoNameClipIfEnabled(clip: Clip): Promise<AutoNameClipResult> {
  if (!settingsState.settings.autoClipNamingEnabled) {
    return 'deferred';
  }

  if (hasClipDescription(clip)) {
    return 'named';
  }

  if (projectDetail.projectId !== null && clip.project_id !== projectDetail.projectId) {
    return 'deferred';
  }

  const apiKey = settingsState.settings.openaiApiKey.trim();
  if (!apiKey) {
    return 'deferred';
  }

  const chapter = resolveChapterForClip(clip);
  if (!chapter) {
    return 'deferred';
  }

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const localIn = Math.max(0, Math.min(chapterDuration, clip.in_point - chapter.start_time));
  const localOutRaw = Math.max(localIn + 0.01, clip.out_point - chapter.start_time);
  const localOut = Math.min(chapterDuration, localOutRaw);
  if (localOut <= localIn) return 'failed';

  const model = (settingsState.settings.autoClipNamingModel || 'gpt-5-nano').trim() || 'gpt-5-nano';

  try {
    const result = await suggestClipName({
      chapterId: chapter.id,
      inPoint: localIn,
      outPoint: localOut,
      model,
      apiKey,
      chapterTitle: chapter.title,
    });

    if (!result.success) {
      console.warn('[ProjectDetail] Auto clip naming request failed:', result.error || 'Unknown error');
      return 'failed';
    }

    if (!result.data?.name) {
      console.warn('[ProjectDetail] Auto clip naming returned empty result');
      return 'failed';
    }

    const generatedDescription = normalizeGeneratedClipDescription(result.data.name);
    if (!generatedDescription) return 'failed';

    const updated = await updateProjectClip(clip.id, { description: generatedDescription });
    return updated ? 'named' : 'failed';
  } catch (error) {
    console.warn('[ProjectDetail] Auto clip naming failed:', error);
    return 'failed';
  }
}

function enqueueAutoNameClip(clipId: number): void {
  if (!Number.isInteger(clipId) || clipId <= 0) return;
  pendingAutoNameClipIds.add(clipId);
  failedAutoNameClipIds.delete(clipId);
}

function pruneAutoNameQueue(): void {
  const clipsById = new Map(timelineState.clips.map((clip) => [clip.id, clip]));

  for (const clipId of Array.from(pendingAutoNameClipIds)) {
    const clip = clipsById.get(clipId);
    if (!clip || hasClipDescription(clip)) {
      pendingAutoNameClipIds.delete(clipId);
      failedAutoNameClipIds.delete(clipId);
    }
  }

  for (const clipId of Array.from(failedAutoNameClipIds)) {
    const clip = clipsById.get(clipId);
    if (!clip || hasClipDescription(clip)) {
      failedAutoNameClipIds.delete(clipId);
    }
  }
}

async function processAutoNameQueue(): Promise<void> {
  if (isProcessingAutoNameQueue) return;

  const configSignature = getAutoNameConfigSignature();
  if (configSignature !== lastAutoNameConfigSignature) {
    failedAutoNameClipIds.clear();
    lastAutoNameConfigSignature = configSignature;
  }

  if (!settingsState.settings.autoClipNamingEnabled) {
    pruneAutoNameQueue();
    if (pendingAutoNameClipIds.size > 0) {
      scheduleAutoNameRetry(AUTO_NAME_FAILED_RETRY_DELAY_MS);
    } else {
      clearAutoNameRetryTimer();
    }
    return;
  }

  isProcessingAutoNameQueue = true;
  const deferredThisPass = new Set<number>();

  try {
    while (true) {
      pruneAutoNameQueue();

      const nextClipId = Array.from(pendingAutoNameClipIds).find((clipId) => (
        !inFlightAutoNameClipIds.has(clipId) &&
        !failedAutoNameClipIds.has(clipId) &&
        !deferredThisPass.has(clipId)
      ));

      if (nextClipId === undefined) {
        break;
      }

      const clip = getClipById(nextClipId);
      if (!clip) {
        pendingAutoNameClipIds.delete(nextClipId);
        failedAutoNameClipIds.delete(nextClipId);
        continue;
      }

      inFlightAutoNameClipIds.add(nextClipId);
      let result: AutoNameClipResult = 'failed';
      try {
        result = await autoNameClipIfEnabled(clip);
      } finally {
        inFlightAutoNameClipIds.delete(nextClipId);
      }

      if (result === 'named') {
        pendingAutoNameClipIds.delete(nextClipId);
        failedAutoNameClipIds.delete(nextClipId);
        continue;
      }

      if (result === 'failed') {
        pendingAutoNameClipIds.delete(nextClipId);
        failedAutoNameClipIds.add(nextClipId);
        continue;
      }

      deferredThisPass.add(nextClipId);
    }
  } finally {
    isProcessingAutoNameQueue = false;
  }

  if (pendingAutoNameClipIds.size === 0) {
    clearAutoNameRetryTimer();
    return;
  }

  const hasRetryableClip = Array.from(pendingAutoNameClipIds).some(
    (clipId) => !failedAutoNameClipIds.has(clipId)
  );

  if (hasRetryableClip || deferredThisPass.size > 0) {
    scheduleAutoNameRetry(AUTO_NAME_RETRY_DELAY_MS);
  } else {
    scheduleAutoNameRetry(AUTO_NAME_FAILED_RETRY_DELAY_MS);
  }
}

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
  pendingAutoNameClipIds.clear();
  failedAutoNameClipIds.clear();
  inFlightAutoNameClipIds.clear();
  isProcessingAutoNameQueue = false;
  lastAutoNameConfigSignature = '';
  clearAutoNameRetryTimer();
  
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
      for (const clip of clipsResult.data) {
        if (!hasClipDescription(clip)) {
          enqueueAutoNameClip(clip.id);
        }
      }
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
    void processAutoNameQueue();
    
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
      if (!hasClipDescription(result.data)) {
        enqueueAutoNameClip(result.data.id);
        void processAutoNameQueue();
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

export async function executeSplitClip(clipId: number, splitTime: number) {
  const clip = getClipById(clipId);
  if (!clip) return;
  const existingClipIds = new Set(timelineState.clips.map((item) => item.id));

  const duration = clip.out_point - clip.in_point;
  if (!Number.isFinite(duration) || duration <= 0) return;

  const clipStart = clip.start_time;
  const clipEnd = clip.start_time + duration;

  if (
    splitTime <= clipStart + MIN_SPLIT_SEGMENT_DURATION ||
    splitTime >= clipEnd - MIN_SPLIT_SEGMENT_DURATION
  ) {
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
    enqueueAutoNameClip(candidate.id);
  }

  void processAutoNameQueue();
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
  pendingAutoNameClipIds.clear();
  failedAutoNameClipIds.clear();
  inFlightAutoNameClipIds.clear();
  isProcessingAutoNameQueue = false;
  lastAutoNameConfigSignature = '';
  clearAutoNameRetryTimer();
  clearTimeline();
  clearHistory();
}
